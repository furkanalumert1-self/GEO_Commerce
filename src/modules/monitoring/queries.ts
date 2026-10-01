import type { PrismaClient } from "@/generated/prisma/client";
import { aggregateScore, shareOfVoice, visibilityScore, FORMULA_VERSION } from "./metrics";
import { brandEntities, cohortHash, toScored } from "./service";

/**
 * Dashboard/visibility sorguları — seçili tarih/motor/locale cohort'u için metrikleri gözlemlerden
 * formülle hesaplar (sayı hardcode edilmez). Başarısız gözlemler formüle girmez ama coverage'ı düşürür.
 */
export interface MetricFilters {
  from: Date;
  to: Date;
  engines?: string[];
  locale?: string;
  /** Yalnız bu prompt'ların gözlemleri (ör. bir fırsatın soru kümesi için önce/sonra ölçümü). */
  promptIds?: string[];
}

export async function loadObservations(db: PrismaClient, workspaceId: string, brandId: string, f: MetricFilters) {
  return db.observation.findMany({
    where: {
      workspaceId,
      brandId,
      sampledAt: { gte: f.from, lte: f.to },
      ...(f.engines?.length ? { engine: { in: f.engines } } : {}),
      ...(f.locale ? { language: f.locale.split("-")[0], country: f.locale.split("-")[1] } : {}),
      ...(f.promptIds ? { promptVersion: { promptId: { in: f.promptIds } } } : {}),
    },
    include: { mentions: true, citations: true, promptVersion: { select: { id: true, promptId: true } } },
    orderBy: { sampledAt: "asc" },
  });
}

export async function brandMetrics(db: PrismaClient, workspaceId: string, brandId: string, f: MetricFilters) {
  const [obs, entities, runs] = await Promise.all([
    loadObservations(db, workspaceId, brandId, f),
    brandEntities(db, brandId),
    db.monitoringRun.findMany({ where: { workspaceId, brandId, scheduledAt: { gte: f.from, lte: f.to } }, select: { engines: true, scheduledCount: true } }),
  ]);
  const engines = [...new Set(obs.map((o) => o.engine))].sort();
  const perEngine = engines.map((engine) => {
    const list = obs.filter((o) => o.engine === engine);
    return visibilityScore(list.map((o) => toScored(o, brandId)), list.length);
  });
  const agg = aggregateScore(perEngine);
  const sov = shareOfVoice(
    obs.map((o) => ({ valid: o.status === "succeeded", weight: o.weight, mentionedEntityIds: o.mentions.filter((m) => m.kind !== "negative" && !m.needsReview).map((m) => m.entityId) })),
    entities.map((e) => e.id),
  );
  const scheduled = runs.reduce((s, r) => s + r.scheduledCount, 0);
  const valid = obs.filter((o) => o.status === "succeeded").length;
  const pvIds = [...new Set(obs.map((o) => o.promptVersionId))];
  const models = [...new Set(obs.filter((o) => o.model).map((o) => `${o.provider}/${o.model}`))];
  const surfaces = [...new Set(obs.map((o) => o.surface))];
  const lastSampledAt = obs.length ? obs[obs.length - 1]!.sampledAt : null;
  return {
    formulaVersion: FORMULA_VERSION,
    cohortHash: cohortHash({ promptVersionIds: pvIds, engines, locales: [f.locale ?? "all"], competitorIds: entities.filter((e) => e.type === "competitor").map((e) => e.id) }),
    aggregate: agg,
    perEngine,
    sov: entities.map((e) => ({ id: e.id, name: e.name, type: e.type, value: sov[e.id] ?? null })),
    coverage: scheduled > 0 ? valid / scheduled : null,
    sampleCount: valid,
    failedCount: obs.length - valid,
    scheduledCount: scheduled,
    provenance: { models, surfaces, lastSampledAt },
  };
}

/** Günlük trend: her gün için aynı formül; gün başına motor profili korunur. */
export async function dailyTrend(db: PrismaClient, workspaceId: string, brandId: string, f: MetricFilters, timeZone: string) {
  const obs = await loadObservations(db, workspaceId, brandId, f);
  const byDay = new Map<string, typeof obs>();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  for (const o of obs) {
    const k = fmt.format(o.sampledAt);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(o);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => {
      const engines = [...new Set(list.map((o) => o.engine))];
      const per = engines.map((e) => {
        const l = list.filter((o) => o.engine === e);
        return visibilityScore(l.map((o) => toScored(o, brandId)), l.length);
      });
      const agg = aggregateScore(per);
      return { day, score: agg.score, partial: agg.partial, smallSample: agg.smallSample, sampleCount: agg.sampleCount, perEngine: Object.fromEntries(per.map((p) => [p.engine, p.score])) };
    });
}

export function parseRange(sp: { range?: string; from?: string; to?: string }, now = new Date()) {
  const days = sp.range === "7" ? 7 : sp.range === "90" ? 90 : 30;
  if (sp.range === "custom" && sp.from && sp.to) {
    const from = new Date(sp.from);
    const to = new Date(sp.to);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to) return { from, to, label: "custom" as const, days: Math.ceil((to.getTime() - from.getTime()) / 86_400_000) };
  }
  return { from: new Date(now.getTime() - days * 86_400_000), to: now, label: String(days) as "7" | "30" | "90", days };
}
