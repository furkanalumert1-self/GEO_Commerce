import type { PrismaClient } from "@/generated/prisma/client";
import { runAudit, type AuditWork } from "@/modules/audit/service";
import { INLINE_AUDIT_CRAWL_PAGES, INLINE_CALL_TIMEOUT_MS, INLINE_CRAWL_MAX_PAGES } from "@/lib/queue/inline";
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
import { syncIntegration } from "@/modules/commerce/connect";
import { ShopifyAuthError } from "@/adapters/commerce/shopify";
import { fixturesAllowed, isDemoDomain } from "@/lib/demo";

/**
 * Job handler'ları. Yürütmeden önce tenant, abonelik ve (varsa) onay yeniden kontrol edilir:
 * silinmiş tenant / eski entitlement ile iş yürütülmez.
 */
export class NonRetryableError extends Error {}

export interface JobContext {
  db: PrismaClient;
  job: { id: string; type: string; workspaceId: string | null; brandId: string | null; payloadRef: unknown; operationId: string };
  progress: (done: number, total: number) => Promise<void>;
  /** Adım modunda süre bütçesi (epoch ms); yoksa iş sonuna kadar yürür. */
  deadline?: number;
  /** Adımlar arası kalıcı ara durum (JobRecord.cursor.step). */
  step?: unknown;
  saveStep?: (step: unknown) => Promise<void>;
}

/** void/"done": tamamlandı · "partial": kısmi sonuçla tamamlandı · "continue": adım bitti, iş sürüyor. */
export type HandlerResult = void | "done" | "partial" | "continue";

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

export const handlers: Record<string, (ctx: JobContext) => Promise<HandlerResult>> = {
  async audit(ctx) {
    const { auditId } = ctx.job.payloadRef as { auditId: string };
    const stepMode = ctx.deadline !== undefined;
    return runAudit(ctx.db, auditId, {}, {
      deadline: ctx.deadline,
      callTimeoutMs: stepMode ? INLINE_CALL_TIMEOUT_MS : undefined,
      crawlMaxPages: stepMode ? INLINE_AUDIT_CRAWL_PAGES : undefined,
      load: () => (ctx.step as AuditWork | undefined) ?? null,
      save: async (w) => {
        await ctx.saveStep?.(w);
        await ctx.progress(w.answers.length, (w.prompts?.length ?? 5) * 2);
      },
    });
  },

  async crawl(ctx) {
    await assertTenantActive(ctx, true);
    const { crawlRunId, maxPages } = ctx.job.payloadRef as { crawlRunId: string; maxPages: number };
    const run = await ctx.db.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId }, include: { brand: true } });
    await ctx.db.crawlRun.update({ where: { id: crawlRunId }, data: { status: "running", startedAt: new Date() } });
    const prev = await ctx.db.pageSnapshot.findMany({ where: { brandId: run.brandId }, orderBy: { sampledAt: "desc" }, take: 2000, select: { url: true, etag: true, contentHash: true } });
    const ws = await ctx.db.workspace.findUniqueOrThrow({ where: { id: run.workspaceId }, select: { isDemo: true } });
    const demo = fixturesAllowed(ws) && isDemoDomain(run.brand.domain);
    // Adım modunda tarama tek sınırlı adımdır (sayfa ve süre üst sınırı); kesilirse "kısmi" olarak tamamlanır.
    const stepMode = ctx.deadline !== undefined;
    const crawl = await crawlSite({
      domain: run.brand.domain,
      maxPages: stepMode ? Math.min(maxPages, INLINE_CRAWL_MAX_PAGES) : maxPages,
      fetcher: demo ? fixtureFetcher : liveFetcher,
      delayMs: demo ? 0 : 300,
      deadline: ctx.deadline,
      onProgress: (d, t) => ctx.progress(d, t),
      previous: new Map(prev.map((p) => [p.url, { etag: p.etag, contentHash: p.contentHash ?? "" }])),
    });
    await persistCrawl(ctx.db, { workspaceId: run.workspaceId, brandId: run.brandId, crawlRunId }, crawl);
    return stepMode && (crawl.truncated || maxPages > INLINE_CRAWL_MAX_PAGES) ? "partial" : "done";
  },

  async commerce_sync(ctx) {
    await assertTenantActive(ctx, true);
    const { integrationId } = ctx.job.payloadRef as { integrationId: string };
    try {
      await syncIntegration(ctx.db, integrationId);
    } catch (e) {
      // Yetki hatası yeniden denemeyle düzelmez; kullanıcı yeniden bağlanmalı.
      if (e instanceof ShopifyAuthError) throw new NonRetryableError("auth_rejected");
      throw e;
    }
  },

  async monitor_run(ctx) {
    await assertTenantActive(ctx, true);
    const { runId, plan, quotaOperationId } = ctx.job.payloadRef as { runId: string; plan: RunPlan; quotaOperationId: string | null };
    const ws = ctx.job.workspaceId ? await ctx.db.workspace.findUnique({ where: { id: ctx.job.workspaceId }, select: { isDemo: true } }) : null;
    const step = (ctx.step ?? {}) as { executed?: boolean };
    if (!step.executed) {
      const r = await executeRun(ctx.db, runId, plan, getAiAdapters(undefined, { demo: ws ? fixturesAllowed(ws) : false }), {
        quotaOperationId,
        onProgress: ctx.progress,
        deadline: ctx.deadline,
        callTimeoutMs: ctx.deadline !== undefined ? INLINE_CALL_TIMEOUT_MS : undefined,
      });
      if (r.incomplete) return "continue";
      // Çalıştırma kapandı (kota commit edildi); sonraki adım tekrar kapatmaz.
      await ctx.saveStep?.({ executed: true });
      if (ctx.deadline !== undefined && Date.now() > ctx.deadline) return "continue";
    }
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
