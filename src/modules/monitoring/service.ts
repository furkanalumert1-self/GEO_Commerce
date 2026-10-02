import type { PrismaClient } from "@/generated/prisma/client";
import { hashObject, sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/http/errors";
import { log } from "@/lib/observability/log";
import { ProviderError, type AiMonitorAdapter, type EngineKey } from "@/adapters/ai/types";
import { extract, type Entity } from "./extract";
import { sampleKey } from "./planner";
import { FORMULA_VERSION, aggregateScore, shareOfVoice, visibilityScore, type ScoredObservation } from "./metrics";
import { commit, release } from "@/modules/billing/quota";

export const MONITOR_CONFIG_VERSION = "monitor@1";

export interface RunPlan {
  promptVersionIds: string[];
  engines: EngineKey[];
  locales: string[]; // "tr-TR"
  repetitions: number;
}

export function unitsFor(plan: RunPlan): number {
  return plan.promptVersionIds.length * plan.engines.length * plan.locales.length * plan.repetitions;
}

export function cohortHash(input: { promptVersionIds: string[]; engines: string[]; locales: string[]; competitorIds: string[] }): string {
  return hashObject({
    p: [...input.promptVersionIds].sort(),
    e: [...input.engines].sort(),
    l: [...input.locales].sort(),
    c: [...input.competitorIds].sort(),
  }).slice(0, 16);
}

export async function brandEntities(db: PrismaClient, brandId: string): Promise<Entity[]> {
  const brand = await db.brand.findUniqueOrThrow({ where: { id: brandId } });
  const comps = await db.competitor.findMany({ where: { brandId, confirmedAt: { not: null }, archivedAt: null } });
  return [
    { id: brand.id, type: "brand", name: brand.name, aliases: brand.aliases, domain: brand.domain },
    ...comps.map((c) => ({ id: c.id, type: "competitor" as const, name: c.name, aliases: c.aliases, domain: c.domain })),
  ];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tek bir run'ı yürütür. İdempotent: sampleKey unique; başarılı gözlemler tekrar sorgulanmaz.
 * Başarısız yanıt kota tüketmez; her deneme CostLedger'a yazılır.
 */
export async function executeRun(
  db: PrismaClient,
  runId: string,
  plan: RunPlan,
  adapters: Record<EngineKey, AiMonitorAdapter>,
  opts: {
    maxAttempts?: number;
    now?: () => Date;
    onProgress?: (done: number, total: number) => Promise<void> | void;
    quotaOperationId?: string | null;
    /** Adım modu: bu zamandan sonra yeni sağlayıcı çağrısı başlatılmaz; ilerleme kalıcıdır, sonraki adım kaldığı yerden devam eder. */
    deadline?: number;
    /** Tek sağlayıcı çağrısı için zaman aşımı (adım modunda istek süresine sığmak için). */
    callTimeoutMs?: number;
  } = {},
): Promise<{ ok: number; failed: number; total: number; coverage: number | null; status: string; incomplete: boolean; done: number }> {
  const run = await db.monitoringRun.findUniqueOrThrow({ where: { id: runId } });
  const brand = await db.brand.findUniqueOrThrow({ where: { id: run.brandId } });
  const entities = await brandEntities(db, brand.id);
  const versions = await db.promptVersion.findMany({ where: { id: { in: plan.promptVersionIds }, workspaceId: run.workspaceId }, include: { prompt: true } });
  const now = opts.now ?? (() => new Date());
  const maxAttempts = opts.maxAttempts ?? 3;
  const total = unitsFor(plan);

  await db.monitoringRun.update({ where: { id: runId }, data: { status: "running", startedAt: run.startedAt ?? now() } });

  let done = 0;
  const overBudget = () => opts.deadline !== undefined && Date.now() > opts.deadline;
  // Kalıcı hata (anahtar/model/yapılandırma) alan platform bu çalıştırmada tekrar çağrılmaz (adımlar arası da).
  const PERMANENT = ["auth", "not_configured", "unsupported", "http_400", "http_404"];
  const deadEngines = new Map<string, string>(
    (await db.observation.findMany({ where: { runId, status: "failed", errorCode: { in: PERMANENT } }, distinct: ["engine"], select: { engine: true, errorCode: true } })).map((o) => [o.engine, o.errorCode!]),
  );
  for (const v of versions) {
    for (const engine of plan.engines) {
      const adapter = adapters[engine];
      for (const locale of plan.locales) {
        const [language, country] = locale.split("-");
        for (let rep = 1; rep <= plan.repetitions; rep++) {
          const key = sampleKey(runId, v.id, engine, locale, rep);
          const existing = await db.observation.findUnique({ where: { sampleKey: key } });
          if (existing?.status === "succeeded") {
            done++;
            continue;
          }
          const obs =
            existing ??
            (await db.observation.create({
              data: {
                workspaceId: run.workspaceId,
                brandId: run.brandId,
                runId,
                promptVersionId: v.id,
                provider: adapter.provider,
                engine,
                surface: adapter.surface,
                country: country ?? brand.country,
                language: language ?? brand.language,
                repetition: rep,
                weight: v.prompt.weight,
                sampleKey: key,
                sampledAt: now(),
              },
            }));
          let attempt = existing?.attempt ?? 0;
          let lastErr: ProviderError | null = null;
          const deadCode = deadEngines.get(engine);
          if (deadCode) {
            await db.observation.update({ where: { id: obs.id }, data: { status: "failed", attempt: maxAttempts, errorCode: deadCode } });
            done++;
            await opts.onProgress?.(done, total);
            continue;
          }
          while (attempt < maxAttempts) {
            if (overBudget()) {
              // Süre bütçesi doldu: gözlem ara durumda kalır, sonraki adım aynı sampleKey ile devam eder.
              await db.observation.update({ where: { id: obs.id }, data: { attempt } });
              return { incomplete: true, done, total, ok: 0, failed: 0, coverage: null, status: "running" };
            }
            attempt++;
            const attemptId = `${key}:${attempt}`;
            try {
              const answer = await adapter.ask({ prompt: v.text, country: country ?? brand.country, language: language ?? brand.language, signal: opts.callTimeoutMs ? AbortSignal.timeout(opts.callTimeoutMs) : undefined });
              await db.costLedger.upsert({
                where: { attemptId },
                update: {},
                create: { workspaceId: run.workspaceId, provider: answer.provider, model: answer.model, operation: "monitor", attemptId, costMicros: answer.costMicros ?? 0n, succeeded: true },
              });
              const ex = extract(answer.text, answer.urls, entities);
              await db.$transaction(async (tx) => {
                await tx.mention.deleteMany({ where: { observationId: obs.id } });
                await tx.citation.deleteMany({ where: { observationId: obs.id } });
                await tx.observation.update({
                  where: { id: obs.id },
                  data: {
                    status: "succeeded",
                    attempt,
                    model: answer.model,
                    provider: answer.provider,
                    surface: answer.surface,
                    rawText: answer.text,
                    listDetected: ex.listDetected,
                    latencyMs: answer.latencyMs,
                    costMicros: answer.costMicros,
                    parseVersion: ex.parseVersion,
                    errorCode: null,
                    sampledAt: now(),
                  },
                });
                if (ex.mentions.length) {
                  await tx.mention.createMany({
                    data: ex.mentions.map((m) => ({ workspaceId: run.workspaceId, observationId: obs.id, entityType: m.entityType, entityId: m.entityId, kind: m.kind, rank: m.rank, confidence: m.confidence, excerpt: m.excerpt, needsReview: m.needsReview })),
                    skipDuplicates: true,
                  });
                }
                if (ex.citations.length) {
                  await tx.citation.createMany({
                    data: ex.citations.map((c) => ({ workspaceId: run.workspaceId, observationId: obs.id, url: c.url, canonicalUrl: c.canonicalUrl, domain: c.domain, association: c.association, entityId: c.entityId, sourceType: c.sourceType })),
                    skipDuplicates: true,
                  });
                }
              });
              lastErr = null;
              break;
            } catch (e) {
              const pe = e instanceof ProviderError ? e : new ProviderError((e as Error).message, false);
              lastErr = pe;
              await db.costLedger.upsert({
                where: { attemptId },
                update: {},
                create: { workspaceId: run.workspaceId, provider: adapter.provider, model: null, operation: "monitor", attemptId, costMicros: 0n, succeeded: false },
              });
              if (!pe.retryable) break;
              if (attempt < maxAttempts) await sleep(Math.min(pe.retryAfterMs ?? 200 * 2 ** attempt, 5000) * (process.env.NODE_ENV === "test" ? 0 : 1));
            }
          }
          if (lastErr) {
            const permanent = PERMANENT.includes(lastErr.code);
            if (permanent) deadEngines.set(engine, lastErr.code);
            // Kalıcı/yeniden denenemez hata: deneme hakkı tükendi sayılır, sonraki adımlarda tekrar çağrılmaz.
            await db.observation.update({ where: { id: obs.id }, data: { status: lastErr.code === "parse_failed" ? "parse_failed" : "failed", attempt: lastErr.retryable ? attempt : maxAttempts, errorCode: lastErr.code } });
          }
          done++;
          await opts.onProgress?.(done, total);
        }
      }
    }
  }

  const [ok, failed] = await Promise.all([
    db.observation.count({ where: { runId, status: "succeeded" } }),
    db.observation.count({ where: { runId, status: { in: ["failed", "parse_failed"] } } }),
  ]);
  const coverage = total === 0 ? null : ok / total;
  const status = ok === total ? "succeeded" : ok > 0 ? "partial" : "failed";
  await db.monitoringRun.update({ where: { id: runId }, data: { status, completedCount: ok, failedCount: failed, coverage, finishedAt: now() } });
  if (opts.quotaOperationId) {
    // Yalnız başarılı answer unit'ler tüketilir.
    await commit(db, opts.quotaOperationId, ok).catch(async (e) => {
      log.warn("quota.commit_failed", { runId, error: e });
      await release(db, opts.quotaOperationId!);
    });
  }
  await writeRunSnapshots(db, runId);
  return { ok, failed, total, coverage, status, incomplete: false, done: total };
}

/** Run bitiminde immutable MetricSnapshot (formül sürümüyle). */
export async function writeRunSnapshots(db: PrismaClient, runId: string) {
  const run = await db.monitoringRun.findUniqueOrThrow({ where: { id: runId } });
  const observations = await db.observation.findMany({ where: { runId }, include: { mentions: true, citations: true } });
  const entities = await brandEntities(db, run.brandId);
  const competitorIds = entities.filter((e) => e.type === "competitor").map((e) => e.id);
  const pvIds = [...new Set(observations.map((o) => o.promptVersionId))];
  const cHash = cohortHash({ promptVersionIds: pvIds, engines: run.engines, locales: run.locales, competitorIds });
  const date = new Date(`${(run.finishedAt ?? new Date()).toISOString().slice(0, 10)}T00:00:00Z`);
  const perEngine = run.engines.map((engine) => {
    const list = observations.filter((o) => o.engine === engine);
    const scheduled = pvIds.length * run.locales.length * run.repetitions;
    return visibilityScore(list.map((o) => toScored(o, run.brandId)), scheduled);
  });
  const agg = aggregateScore(perEngine);
  const sov = shareOfVoice(
    observations.map((o) => ({ valid: o.status === "succeeded", weight: o.weight, mentionedEntityIds: o.mentions.filter((m) => m.kind !== "negative" && !m.needsReview).map((m) => m.entityId) })),
    entities.map((e) => e.id),
  );
  const rows = [
    ...perEngine.map((e) => ({ engine: e.engine, values: { score: e.score, M: e.M, R: e.R, C: e.C, smallSample: e.smallSample, profile: e.profile }, coverage: e.coverage, sampleCount: e.validObservations })),
    { engine: "all", values: { score: agg.score, partial: agg.partial, missingEngines: agg.missingEngines, smallSample: agg.smallSample, profile: agg.profile, sov }, coverage: run.coverage, sampleCount: agg.sampleCount },
  ];
  for (const r of rows) {
    await db.metricSnapshot.upsert({
      where: { brandId_date_cohortHash_engine_surface_formulaVersion: { brandId: run.brandId, date, cohortHash: cHash, engine: r.engine, surface: "api_grounded", formulaVersion: FORMULA_VERSION } },
      update: { values: r.values as object, coverage: r.coverage, sampleCount: r.sampleCount, numerator: { runId }, denominator: { runId } },
      create: { workspaceId: run.workspaceId, brandId: run.brandId, date, cohortHash: cHash, engine: r.engine, surface: "api_grounded", formulaVersion: FORMULA_VERSION, values: r.values as object, coverage: r.coverage, sampleCount: r.sampleCount, numerator: { runId }, denominator: { runId } },
    });
  }
  return { cohortHash: cHash, aggregate: agg };
}

type ObsWith = { status: string; weight: number; engine: string; surface: string; mentions: Array<{ entityId: string; kind: string; needsReview: boolean }>; citations: Array<{ association: string; entityId: string | null }> };

export function toScored(o: ObsWith, brandId: string): ScoredObservation {
  const brandMentions = o.mentions.filter((m) => m.entityId === brandId && !m.needsReview && m.kind !== "negative" && m.kind !== "incidental");
  return {
    engine: o.engine,
    surface: o.surface as ScoredObservation["surface"],
    valid: o.status === "succeeded",
    weight: o.weight,
    mentioned: brandMentions.length > 0,
    recommended: brandMentions.some((m) => m.kind === "recommendation"),
    ownCitation: o.citations.some((c) => c.association === "own"),
    supportsCitations: o.surface !== "licensed_ui",
  };
}

/** Run oluşturma: planı dondurur (sabit prompt version + engine + locale + settings). */
export async function createRun(db: PrismaClient, input: { workspaceId: string; brandId: string; plan: RunPlan; trigger: string; operationId: string }) {
  if (unitsFor(input.plan) === 0) throw new AppError("validation_error", "Ölçülecek prompt/motor seçilmedi");
  return db.monitoringRun.upsert({
    where: { operationId: input.operationId },
    update: {},
    create: {
      workspaceId: input.workspaceId,
      brandId: input.brandId,
      trigger: input.trigger,
      configVersion: MONITOR_CONFIG_VERSION,
      engines: input.plan.engines,
      locales: input.plan.locales,
      repetitions: input.plan.repetitions,
      scheduledCount: unitsFor(input.plan),
      operationId: input.operationId,
      scheduledAt: new Date(),
    },
  });
}

export const runOperationId = (brandId: string, key: string) => `run:${brandId}:${sha256(key).slice(0, 24)}`;
