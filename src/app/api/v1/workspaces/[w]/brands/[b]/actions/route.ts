import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, json, readJson, withIdempotency } from "@/lib/http/api";
import { createActionDraft } from "@/modules/actions/service";
import { assertOpportunityUnlocked } from "@/modules/opportunities/access";
import { ACTION_TYPES } from "@/modules/actions/workflow";

/** Fix with AI taslak üretimi istek içinde çalışır; üretim zaman aşımı (inline: 50 sn) bu sınırın altında. */
export const maxDuration = 60;

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
    const a = await createActionDraft(db, access, { opportunityId: input.opportunityId, type: input.type, targetUrl: input.targetURL, operationId: `fix:${access.workspaceId}:${key}`, userId: access.principal.userId });
    return { status: 201, data: { id: a.id, status: a.status, versionId: a.currentVersionId } };
  });
});
