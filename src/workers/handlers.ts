import type { PrismaClient } from "@/generated/prisma/client";
import { runAudit } from "@/modules/audit/service";
import { crawlSite, liveFetcher } from "@/modules/audit/crawler";
import { fixtureFetcher } from "@/modules/audit/fixture-site";
import { persistCrawl } from "@/modules/catalog/service";
import { executeRun, type RunPlan } from "@/modules/monitoring/service";
import { generateOpportunities } from "@/modules/opportunities/engine";
import { attributeOrders } from "@/modules/commerce/service";
import { releaseExpired } from "@/modules/billing/quota";
import { getAiAdapters } from "@/adapters/ai/providers";
import { config } from "@/lib/config";
import { resolveEntitlements, type PlanKey } from "@/modules/billing/plans";
import { runRetention } from "./retention";

/**
 * Job handler'ları. Yürütmeden önce tenant, abonelik ve (varsa) onay yeniden kontrol edilir:
 * silinmiş tenant / eski entitlement ile iş yürütülmez.
 */
export class NonRetryableError extends Error {}

export interface JobContext {
  db: PrismaClient;
  job: { id: string; type: string; workspaceId: string | null; brandId: string | null; payloadRef: unknown; operationId: string };
  progress: (done: number, total: number) => Promise<void>;
}

async function assertTenantActive(ctx: JobContext, paid: boolean) {
  if (!ctx.job.workspaceId) return;
  const ws = await ctx.db.workspace.findUnique({ where: { id: ctx.job.workspaceId }, include: { subscription: true } });
  if (!ws || ws.status !== "active") throw new NonRetryableError("tenant_inactive");
  if (paid) {
    const s = ws.subscription;
    const ent = resolveEntitlements(s ? { planKey: s.planKey as PlanKey, status: s.status, pastDueSince: s.pastDueSince } : null);
    if (!ent.canRunPaidJobs) throw new NonRetryableError(`entitlement:${ent.readOnlyReason}`);
  }
  if (ctx.job.brandId) {
    const b = await ctx.db.brand.findFirst({ where: { id: ctx.job.brandId, workspaceId: ctx.job.workspaceId, archivedAt: null } });
    if (!b) throw new NonRetryableError("brand_missing");
  }
}

export const handlers: Record<string, (ctx: JobContext) => Promise<void>> = {
  async audit(ctx) {
    const { auditId } = ctx.job.payloadRef as { auditId: string };
    await runAudit(ctx.db, auditId);
  },

  async crawl(ctx) {
    await assertTenantActive(ctx, true);
    const { crawlRunId, maxPages } = ctx.job.payloadRef as { crawlRunId: string; maxPages: number };
    const run = await ctx.db.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId }, include: { brand: true } });
    await ctx.db.crawlRun.update({ where: { id: crawlRunId }, data: { status: "running", startedAt: new Date() } });
    const prev = await ctx.db.pageSnapshot.findMany({ where: { brandId: run.brandId }, orderBy: { sampledAt: "desc" }, take: 2000, select: { url: true, etag: true, contentHash: true } });
    const crawl = await crawlSite({
      domain: run.brand.domain,
      maxPages,
      fetcher: config().DEMO_MODE ? fixtureFetcher : liveFetcher,
      delayMs: config().DEMO_MODE ? 0 : 300,
      onProgress: (d, t) => ctx.progress(d, t),
      previous: new Map(prev.map((p) => [p.url, { etag: p.etag, contentHash: p.contentHash ?? "" }])),
    });
    await persistCrawl(ctx.db, { workspaceId: run.workspaceId, brandId: run.brandId, crawlRunId }, crawl);
  },

  async monitor_run(ctx) {
    await assertTenantActive(ctx, true);
    const { runId, plan, quotaOperationId } = ctx.job.payloadRef as { runId: string; plan: RunPlan; quotaOperationId: string | null };
    await executeRun(ctx.db, runId, plan, getAiAdapters(), { quotaOperationId, onProgress: ctx.progress });
    if (ctx.job.workspaceId && ctx.job.brandId) await generateOpportunities(ctx.db, ctx.job.workspaceId, ctx.job.brandId);
  },

  async generate_opportunities(ctx) {
    await assertTenantActive(ctx, false);
    await generateOpportunities(ctx.db, ctx.job.workspaceId!, ctx.job.brandId!);
  },

  async attribute(ctx) {
    await assertTenantActive(ctx, false);
    await attributeOrders(ctx.db, ctx.job.workspaceId!, ctx.job.brandId!);
  },

  async quota_cleanup(ctx) {
    await releaseExpired(ctx.db);
  },

  async retention(ctx) {
    await runRetention(ctx.db);
  },
};
