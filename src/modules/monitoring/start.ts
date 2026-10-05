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
 * Son 6 saatte en son yanıtlarının hepsi (en az 3) kalıcı hatayla düşen platformlar (ör. kredisi biten Gemini).
 * Bu platformlar yeni ölçüme eklenmez; boşa başarısız yanıt ve "kısmen tamamlandı" üretmez. Sağlayıcı düzelince
 * (yeni başarılı yanıt veya 6 saat) yeniden eklenir. Yalnız durum kodu okunur, içerik okunmaz.
 */
export async function recentlyBrokenEngines(db: PrismaClient, engines: EngineKey[], now = Date.now()): Promise<EngineKey[]> {
  const out: EngineKey[] = [];
  for (const engine of engines) {
    const last = await db.observation.findMany({ where: { engine, status: { not: "pending" }, updatedAt: { gte: new Date(now - 6 * 3600_000) } }, orderBy: { updatedAt: "desc" }, take: 3, select: { status: true, errorCode: true } });
    if (last.length >= 3 && last.every((o) => o.status === "failed" && PERMANENT_ENGINE_ERRORS.includes(o.errorCode ?? ""))) out.push(engine);
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
