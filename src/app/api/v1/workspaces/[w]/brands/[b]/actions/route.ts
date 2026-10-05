import { after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, json, readJson, withIdempotency } from "@/lib/http/api";
import { startActionDraft } from "@/modules/actions/service";
import { executionMode } from "@/lib/queue";
import { log } from "@/lib/observability/log";
import { runJob } from "@/workers/runner";
import { assertOpportunityUnlocked } from "@/modules/opportunities/access";
import { ACTION_TYPES } from "@/modules/actions/workflow";

/**
 * Fix with AI taslağı arka planda üretilir: istek iş kimliğiyle hemen döner (202). Redis'siz (inline) dağıtımda iş,
 * yanıt gönderildikten sonra aynı fonksiyonda (after) yürür; 30–90 sn süren üretim bu sınırın (180 sn) altında kalır.
 */
export const maxDuration = 180;

const body = z.object({ opportunityId: z.string().uuid(), type: z.enum(ACTION_TYPES), targetURL: z.string().url().max(500).nullable().optional() });

export const GET = brandRoute(async ({ access, requestId }) => {
  const rows = await db.action.findMany({ where: { workspaceId: access.workspaceId, brandId: access.brandId }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true, type: true, status: true, targetUrl: true, updatedAt: true, opportunityId: true } });
  return json(rows, { requestId });
});

/** Fix with AI: server-side plan kapısı + fix unit kotası; Idempotency-Key zorunlu (çift üretim yok). */
export const POST = brandRoute(async ({ req, access, requestId }) => {
  const input = await readJson(req, body);
  await assertOpportunityUnlocked(db, access, input.opportunityId);
  const key = req.headers.get("idempotency-key") ?? "";
  return withIdempotency(req, access.workspaceId, `actions:${access.brandId}`, input, requestId, async () => {
    const job = await startActionDraft(db, access, { opportunityId: input.opportunityId, type: input.type, targetUrl: input.targetURL, operationId: `fix:${access.workspaceId}:${key}` });
    if (executionMode() === "inline" && job.status === "queued") {
      after(() => runJob(db, job.id, "after").then(() => undefined, (e) => log.warn("action.generate_after_failed", { jobId: job.id, error: e })));
    }
    return { status: 202, data: { jobId: job.id, status: job.status } };
  });
});
