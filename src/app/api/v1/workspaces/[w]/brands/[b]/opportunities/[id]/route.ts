import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { assertOpportunityUnlocked } from "@/modules/opportunities/access";
import { canMarkWon, canTransitionOpportunity, type OpportunityStatus } from "@/modules/opportunities/scoring";

type P = { w: string; b: string; id: string };

export const GET = brandRoute<P>(async ({ params, access, requestId }) => {
  const o = await db.opportunity.findFirst({ where: { id: params.id, workspaceId: access.workspaceId, brandId: access.brandId }, include: { evidence: true, cluster: true } });
  if (!o) throw notFound("Fırsat");
  await assertOpportunityUnlocked(db, access, o.id);
  return json(o, { requestId });
});

const body = z.object({
  status: z.enum(["new", "triaged", "in_progress", "measuring", "won", "dismissed"]).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  humanApprovedWin: z.boolean().optional(),
});

export const PATCH = brandRoute<P>(async ({ req, params, access, requestId }) => {
  assertCan(access, "opportunities.write");
  const input = await readJson(req, body);
  const o = await db.opportunity.findFirst({ where: { id: params.id, workspaceId: access.workspaceId, brandId: access.brandId } });
  if (!o) throw notFound("Fırsat");
  await assertOpportunityUnlocked(db, access, o.id);
  if (input.status && input.status !== o.status) {
    if (!canTransitionOpportunity(o.status as OpportunityStatus, input.status)) throw new AppError("conflict", `${o.status} → ${input.status} geçişi geçersiz`);
    if (input.status === "won" && !canMarkWon({ humanApproved: Boolean(input.humanApprovedWin), pointDelta: null, sampleCount: 0 })) {
      throw new AppError("validation_error", "Kazanıldı işareti için insan onayı veya eşik+örneklem gerekir");
    }
  }
  if (input.ownerId) {
    const m = await db.membership.findFirst({ where: { workspaceId: access.workspaceId, userId: input.ownerId } });
    if (!m) throw new AppError("validation_error", "Sahip bu çalışma alanının üyesi değil");
  }
  const updated = await db.opportunity.update({
    where: { id: o.id },
    data: { ...(input.status ? { status: input.status } : {}), ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}) },
  });
  return json({ id: updated.id, status: updated.status }, { requestId });
});
