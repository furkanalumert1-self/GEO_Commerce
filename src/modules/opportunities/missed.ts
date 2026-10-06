import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Fırsat çıkmadığında kullanıcıya yol göstermek için: son ölçümlerde markanın hiç anılmadığı sorular ve bu
 * sorularda kaynak gösterilen siteler. Fırsat motoru yalnız onaylı rakiplere karşı açık üretir; burada onaylı
 * rakip şartı yoktur (yalnız bilgi ve rakip önerisi). Yanıt metni okunmaz; yalnız anılma ve kaynak kayıtları.
 */
export async function missedQuestions(db: PrismaClient, workspaceId: string, brandId: string, opts: { days?: number; ownDomain?: string } = {}) {
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000);
  const obs = await db.observation.findMany({
    where: { workspaceId, brandId, status: "succeeded", sampledAt: { gte: since } },
    select: { promptVersion: { select: { text: true } }, mentions: { select: { entityId: true, kind: true } }, citations: { select: { domain: true, association: true } } },
    orderBy: { sampledAt: "desc" },
    take: 500,
  });
  const own = (opts.ownDomain ?? "").replace(/^www\./, "");
  const byQuestion = new Map<string, { answers: number; mentioned: number; domains: Map<string, number> }>();
  for (const o of obs) {
    const g = byQuestion.get(o.promptVersion.text) ?? { answers: 0, mentioned: 0, domains: new Map() };
    g.answers++;
    if (o.mentions.some((m) => m.entityId === brandId && m.kind !== "negative")) g.mentioned++;
    for (const c of o.citations) {
      const d = c.domain.replace(/^www\./, "");
      if (c.association === "own" || (own && (d === own || d.endsWith(`.${own}`)))) continue;
      g.domains.set(d, (g.domains.get(d) ?? 0) + 1);
    }
    byQuestion.set(o.promptVersion.text, g);
  }
  const missed = [...byQuestion.entries()].filter(([, g]) => g.mentioned === 0).sort((a, b) => b[1].answers - a[1].answers);
  const domains = new Map<string, number>();
  for (const [, g] of missed) for (const [d, n] of g.domains) domains.set(d, (domains.get(d) ?? 0) + n);
  return {
    answers: obs.length,
    questions: byQuestion.size,
    mentionedQuestions: byQuestion.size - missed.length,
    missed: missed.slice(0, 3).map(([text, g]) => ({ text, answers: g.answers })),
    missedCount: missed.length,
    domains: [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([domain, count]) => ({ domain, count })),
  };
}
