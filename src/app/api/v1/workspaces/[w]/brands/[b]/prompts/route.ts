import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json, parseQuery, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { dedupePrompts, promptHash, scoreCommercialIntent, classifyIntentType } from "@/modules/prompts/intent";

const q = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(25), active: z.enum(["true", "false"]).optional() });

export const GET = brandRoute(async ({ req, access, requestId }) => {
  const { cursor, limit, active } = parseQuery(req, q);
  const rows = await db.prompt.findMany({
    where: { workspaceId: access.workspaceId, brandId: access.brandId, ...(active ? { active: active === "true" } : {}) },
    include: { cluster: { select: { label: true, type: true, locale: true } }, versions: { orderBy: { version: "desc" }, take: 1 } },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const next = rows.length > limit ? rows[limit - 1]!.id : null;
  return json(rows.slice(0, limit), { requestId, nextCursor: next });
});

const body = z.object({
  text: z.string().trim().min(5).max(500),
  clusterId: z.string().uuid().optional(),
  clusterLabel: z.string().trim().min(2).max(120).optional(),
  category: z.string().trim().max(120).optional(),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/).default("tr-TR"),
  weight: z.number().min(0.1).max(5).default(1),
  targetPage: z.string().url().max(500).optional(),
});

export const POST = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "prompts.write");
  const input = await readJson(req, body);
  const activeCount = await db.prompt.count({ where: { workspaceId: access.workspaceId, active: true } });
  if (activeCount >= access.entitlements.activePrompts) throw new AppError("quota_exceeded", "Aktif prompt limiti doldu", { limit: access.entitlements.activePrompts, used: activeCount });
  const existing = await db.promptVersion.findMany({ where: { workspaceId: access.workspaceId, prompt: { brandId: access.brandId, active: true } }, select: { text: true } });
  const dd = dedupePrompts([{ text: input.text }], existing);
  if (dd.duplicates.length) throw new AppError("conflict", dd.duplicates[0]!.reason === "exact" ? "Bu prompt zaten var" : "Çok benzer bir prompt zaten var", { similarTo: dd.duplicates[0]!.of.text });
  let clusterId = input.clusterId;
  if (clusterId) {
    const c = await db.intentCluster.findFirst({ where: { id: clusterId, brandId: access.brandId } });
    if (!c) throw new AppError("validation_error", "Geçersiz cluster");
  } else {
    const label = input.clusterLabel ?? input.text.slice(0, 60);
    const c = await db.intentCluster.upsert({ where: { brandId_label_locale: { brandId: access.brandId, label, locale: input.locale } }, update: {}, create: { workspaceId: access.workspaceId, brandId: access.brandId, label, locale: input.locale, type: classifyIntentType(input.text), category: input.category ?? null } });
    clusterId = c.id;
  }
  const catalogTerms = (await db.category.findMany({ where: { brandId: access.brandId }, select: { name: true } })).map((c) => c.name);
  const rubric = scoreCommercialIntent(input.text, catalogTerms);
  const prompt = await db.$transaction(async (tx) => {
    const p = await tx.prompt.create({ data: { workspaceId: access.workspaceId, brandId: access.brandId, clusterId: clusterId!, weight: input.weight, targetPage: input.targetPage, branded: access.brand.name.split(" ").some((w) => input.text.toLocaleLowerCase("tr-TR").includes(w.toLocaleLowerCase("tr-TR"))) } });
    const v = await tx.promptVersion.create({ data: { workspaceId: access.workspaceId, promptId: p.id, version: 1, text: input.text, normalizedHash: promptHash(input.text), commercialScore: rubric.total, commercialRubric: rubric as object, rationale: rubric.reasons.join("; ") } });
    return tx.prompt.update({ where: { id: p.id }, data: { currentVersionId: v.id } });
  });
  return json({ id: prompt.id, commercialScore: rubric.total, rubric }, { status: 201, requestId });
});
