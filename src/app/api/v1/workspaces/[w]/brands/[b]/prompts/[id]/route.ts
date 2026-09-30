import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { promptHash, scoreCommercialIntent, validateRubric } from "@/modules/prompts/intent";

const body = z.object({
  text: z.string().trim().min(5).max(500).optional(),
  active: z.boolean().optional(),
  archived: z.boolean().optional(),
  weight: z.number().min(0.1).max(5).optional(),
  rubricOverride: z.object({ purchase: z.number(), specificity: z.number(), constraints: z.number(), comparison: z.number() }).optional(),
});

/** Metin değişimi yeni PromptVersion (yeni cohort) üretir; arşiv tarihsel ölçümü silmez. */
export const PATCH = brandRoute<{ w: string; b: string; id: string }>(async ({ req, params, access, requestId }) => {
  assertCan(access, "prompts.write");
  const input = await readJson(req, body);
  const p = await db.prompt.findFirst({ where: { id: params.id, brandId: access.brandId, workspaceId: access.workspaceId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!p) throw notFound("Prompt");
  const current = p.versions[0];
  if (input.active === true && !p.active) {
    const n = await db.prompt.count({ where: { workspaceId: access.workspaceId, active: true } });
    if (n >= access.entitlements.activePrompts) throw new AppError("quota_exceeded", "Aktif prompt limiti doldu", { limit: access.entitlements.activePrompts, used: n });
  }
  const out = await db.$transaction(async (tx) => {
    let currentVersionId = p.currentVersionId;
    if ((input.text && input.text !== current?.text) || input.rubricOverride) {
      const text = input.text ?? current!.text;
      const rubric = input.rubricOverride ? validateRubric(input.rubricOverride) : scoreCommercialIntent(text);
      const v = await tx.promptVersion.create({ data: { workspaceId: access.workspaceId, promptId: p.id, version: (current?.version ?? 0) + 1, text, normalizedHash: promptHash(text), commercialScore: rubric.total, commercialRubric: rubric as object, rationale: rubric.reasons.join("; "), scoreOverridden: Boolean(input.rubricOverride) } });
      currentVersionId = v.id;
    }
    return tx.prompt.update({
      where: { id: p.id },
      data: {
        currentVersionId,
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null, active: input.archived ? false : p.active } : {}),
      },
    });
  });
  return json({ id: out.id, active: out.active, archivedAt: out.archivedAt, currentVersionId: out.currentVersionId }, { requestId });
});
