import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/http/errors";
import { assertJobsRunnable, enqueue } from "@/lib/queue";
import { getAiAdapters } from "@/adapters/ai/providers";
import type { EngineKey } from "@/adapters/ai/types";
import { allowedEngines } from "@/modules/billing/plans";
import { ensureBucket, periodKey, reserve } from "@/modules/billing/quota";
import { assertCan, assertCanRunPaidJob, type BrandAccess } from "@/modules/tenancy/access";
import { createRun, unitsFor, MONITOR_CONFIG_VERSION, type RunPlan } from "./service";
import { estimate } from "./planner";
import { fixturesAllowed } from "@/lib/demo";

export interface StartRunInput {
  promptIds?: string[];
  engines: EngineKey[];
  locales: string[];
  repetitions: number;
  previewOnly?: boolean;
  idempotencyKey: string;
}

/** Bağlı ve pakete dahil motorlar. not_configured motorlar açıkça ayrı döner. */
export function engineAvailability(access: BrandAccess) {
  const adapters = getAiAdapters(undefined, { demo: fixturesAllowed(access) });
  const connected = (Object.keys(adapters) as EngineKey[]).filter((e) => ["ready", "demo"].includes(adapters[e].status()));
  const allowed = allowedEngines(access.entitlements, connected);
  return {
    allowed,
    all: (Object.keys(adapters) as EngineKey[]).map((e) => ({ engine: e, status: adapters[e].status(), reason: adapters[e].statusReason(), inPlan: allowedEngines(access.entitlements, [e]).length > 0, surface: adapters[e].surface })),
  };
}

/** Kalıcı sağlayıcı hataları (anahtar/kota/model): bu kodlarla düşen platform yeniden denense de yanıt vermez. */
const PERMANENT_ENGINE_ERRORS = ["auth", "insufficient_quota", "http_404", "not_configured", "search_unavailable"];

/**
 * Kredisi/anahtarı bozuk platformlar (ör. kotası biten Gemini): son kanıtların (hesap içi yanıtlar ve ücretsiz
 * ölçümler, 7 gün) en yenileri kalıcı hatadır ve o zamandan beri başarılı yanıt yoktur. Bu platformlar ölçüme
 * eklenmez; boşa başarısız yanıt ve "kısmen tamamlandı" üretmez. Son hata 24 saatten eskiyse platform bir kez
 * yeniden denenir (sağlayıcı düzelince kendiliğinden geri gelir). Yalnız durum kodları okunur, içerik okunmaz.
 */
export async function recentlyBrokenEngines(db: PrismaClient, engines: EngineKey[], now = Date.now()): Promise<EngineKey[]> {
  if (!engines.length) return [];
  const since = new Date(now - 7 * 86_400_000);
  const out: EngineKey[] = [];
  for (const engine of engines) {
    // Yalnız bu platformu kapsayan son ücretsiz ölçümler (genel son N kayıt başka platformlarla dolabilir).
    const audits = await db.audit.findMany({ where: { updatedAt: { gte: since }, status: { in: ["succeeded", "partial"] }, resultSummary: { path: ["scopeEngines"], array_contains: [engine] } }, orderBy: { updatedAt: "desc" }, take: 3, select: { updatedAt: true, resultSummary: true } });
    const obs = await db.observation.findMany({ where: { engine, status: { not: "pending" }, updatedAt: { gte: since } }, orderBy: { updatedAt: "desc" }, take: 3, select: { status: true, errorCode: true, updatedAt: true } });
    type Ev = { at: number; ok: boolean; permanent: boolean };
    const events: Ev[] = obs.map((o) => ({ at: o.updatedAt.getTime(), ok: o.status === "succeeded", permanent: o.status === "failed" && PERMANENT_ENGINE_ERRORS.includes(o.errorCode ?? "") }));
    for (const a of audits) {
      const sum = a.resultSummary as { scopeEngines?: string[]; failedCalls?: string[] } | null;
      if (!sum?.scopeEngines?.includes(engine)) continue;
      const codes = (sum.failedCalls ?? []).filter((f) => f.startsWith(`${engine}:`)).map((f) => f.slice(engine.length + 1));
      events.push({ at: a.updatedAt.getTime(), ok: codes.length === 0, permanent: codes.length > 0 && codes.every((c) => PERMANENT_ENGINE_ERRORS.includes(c)) });
    }
    // En yeniden geriye: son başarıdan (veya geçici hatadan) beri art arda en az 2 kalıcı hata.
    const sorted = events.sort((x, y) => y.at - x.at);
    let streak = 0;
    for (const e of sorted) {
      if (e.ok || !e.permanent) break;
      streak++;
    }
    if (streak >= 2 && now - sorted[0]!.at < 86_400_000) out.push(engine);
  }
  return out;
}

export async function startMonitoringRun(db: PrismaClient, access: BrandAccess, input: StartRunInput) {
  assertCan(access, "runs.start");
  const { allowed } = engineAvailability(access);
  const broken = await recentlyBrokenEngines(db, input.engines.filter((e) => allowed.includes(e)));
  // Hepsi bozuksa engellenmez (kullanıcı en azından hatayı görür); yoksa bozuk platformlar çıkarılır.
  const usable = input.engines.filter((e) => allowed.includes(e) && (!broken.includes(e) || input.engines.filter((x) => allowed.includes(x)).every((x) => broken.includes(x))));
  const engines = usable;
  const rejected = input.engines.filter((e) => !usable.includes(e));
  if (engines.length === 0) throw new AppError("unsupported", "Seçilen motorlar bağlı değil veya pakete dahil değil", { rejected });
  const prompts = await db.prompt.findMany({
    where: { brandId: access.brandId, workspaceId: access.workspaceId, active: true, archivedAt: null, ...(input.promptIds?.length ? { id: { in: input.promptIds } } : {}) },
    orderBy: [{ weight: "desc" }, { createdAt: "asc" }],
    select: { id: true, currentVersionId: true },
  });
  const withVersion = prompts.filter((p) => p.currentVersionId);
  const sub = await db.subscription.findUnique({ where: { workspaceId: access.workspaceId } });
  const period = periodKey(sub?.currentPeriodStart ?? new Date());
  const bucket = await ensureBucket(db, access.workspaceId, "answer_units", period, access.entitlements.answerUnits);
  const available = Math.max(0, bucket.limit - bucket.used - bucket.reserved);
  const est = estimate({ promptIds: withVersion.map((p) => p.id), engines, locales: input.locales, repetitions: input.repetitions, runsPerPeriod: 1, availableUnits: available });
  const selected = withVersion.filter((p) => est.selectedPromptIds.includes(p.id));
  const plan: RunPlan = { promptVersionIds: selected.map((p) => p.currentVersionId!), engines, locales: input.locales, repetitions: input.repetitions };
  const preview = { unitsRequested: est.unitsPerRun, unitsPlanned: unitsFor(plan), available, fits: est.fits, sampledFraction: est.sampledFraction, rejectedEngines: rejected, unavailableEngines: broken.filter((e) => rejected.includes(e)), promptCount: selected.length };
  if (input.previewOnly) return { preview, run: null, jobId: null };
  assertCanRunPaidJob(access);
  assertJobsRunnable();
  if (unitsFor(plan) === 0) throw new AppError("quota_exceeded", "Bu dönem için answer unit kotası doldu", { limit: bucket.limit, used: bucket.used, resetAt: sub?.currentPeriodEnd.toISOString() });
  const operationId = `run:${access.workspaceId}:${input.idempotencyKey}`;
  await reserve(db, { workspaceId: access.workspaceId, metric: "answer_units", period, limit: access.entitlements.answerUnits, amount: unitsFor(plan), operationId, ttlMs: 2 * 3600_000 });
  const run = await createRun(db, { workspaceId: access.workspaceId, brandId: access.brandId, plan, trigger: "manual", operationId });
  const job = await enqueue(db, {
    type: "monitor_run",
    operationId: `job:${operationId}`,
    workspaceId: access.workspaceId,
    brandId: access.brandId,
    configVersion: MONITOR_CONFIG_VERSION,
    payload: { runId: run.id, plan: { ...plan }, quotaOperationId: operationId },
  });
  return { preview, run, jobId: job.id };
}
