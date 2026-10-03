import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { classifyIntentType, dedupePrompts, promptHash, scoreCommercialIntent } from "./intent";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Soruları aktif prompt olarak ekler: mevcutlarla (ve kendi aralarında) tekilleştirir, paket limitini aşmaz.
 * Her kategori kendi niyet kümesine (cluster) bağlanır. Eklenen soru sayısını döner.
 */
export async function seedPrompts(
  db: Db,
  p: { workspaceId: string; brandId: string; brandName: string; texts: Array<{ text: string; category?: string }>; locale: string; source: "audit" | "generated"; activeLimit: number },
): Promise<number> {
  const activeCount = await db.prompt.count({ where: { workspaceId: p.workspaceId, active: true } });
  const room = Math.max(0, p.activeLimit - activeCount);
  if (!room) return 0;
  const existing = await db.promptVersion.findMany({ where: { workspaceId: p.workspaceId, prompt: { brandId: p.brandId, active: true } }, select: { text: true } });
  const { kept: unique } = dedupePrompts<{ text: string; category?: string }>(p.texts.filter((t) => t.text.trim().length >= 5), existing);
  const terms = [...new Set(p.texts.map((t) => t.category).filter((c): c is string => Boolean(c)))];
  const nameWords = p.brandName.toLocaleLowerCase("tr-TR").split(/\s+/).filter((w) => w.length > 2);
  let added = 0;
  for (const item of unique.slice(0, room)) {
    const label = item.category ?? "Genel";
    const cluster = await db.intentCluster.upsert({
      where: { brandId_label_locale: { brandId: p.brandId, label, locale: p.locale } },
      update: {},
      create: { workspaceId: p.workspaceId, brandId: p.brandId, label, locale: p.locale, type: classifyIntentType(item.text), category: item.category ?? null },
    });
    const rubric = scoreCommercialIntent(item.text, terms);
    const lower = item.text.toLocaleLowerCase("tr-TR");
    const prompt = await db.prompt.create({ data: { workspaceId: p.workspaceId, brandId: p.brandId, clusterId: cluster.id, source: p.source, branded: nameWords.some((w) => lower.includes(w)) } });
    const v = await db.promptVersion.create({ data: { workspaceId: p.workspaceId, promptId: prompt.id, version: 1, text: item.text, normalizedHash: promptHash(item.text), commercialScore: rubric.total, commercialRubric: rubric as object, rationale: rubric.reasons.join("; ") } });
    await db.prompt.update({ where: { id: prompt.id }, data: { currentVersionId: v.id } });
    added++;
  }
  return added;
}
