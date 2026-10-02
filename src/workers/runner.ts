import type { PrismaClient } from "@/generated/prisma/client";
import { log } from "@/lib/observability/log";
import { handlers, NonRetryableError } from "./handlers";
import { ProviderError } from "@/adapters/ai/types";
import { isAppError } from "@/lib/http/errors";
import { release } from "@/modules/billing/quota";

/**
 * Tek bir JobRecord'u yürütür (BullMQ worker ve testler bu fonksiyonu çağırır).
 * - Lease (lockedUntil) ile aynı işin iki worker'da eşzamanlı yürümesi engellenir.
 * - Geçici hata: yeniden denenir (max attempts); auth/validation: retry yok → dead (DLQ) + neden.
 */
export type RunOutcome = "succeeded" | "partial" | "continue" | "retry" | "dead" | "skipped";

const LEASE_MS = 15 * 60_000;
/** Adım modunda kilit: istek süresinden (maxDuration) uzun; çöken adımın kilidi bu süre sonunda düşer. */
const STEP_LEASE_MS = 2 * 60_000;

export interface RunOptions {
  /**
   * Adım modu (JOB_EXECUTION_MODE=inline): handler bu zamandan sonra yeni dış çağrı başlatmaz, ilerlemeyi
   * kaydedip "continue" döner. Verilmezse (worker) iş sonuna kadar yürür.
   */
  deadline?: number;
}

function isRetryable(e: unknown): boolean {
  if (e instanceof NonRetryableError) return false;
  if (e instanceof ProviderError) return e.retryable;
  if (isAppError(e)) return Boolean(e.details.retryable);
  return true;
}

export async function runJob(db: PrismaClient, jobId: string, workerId = "local", opts: RunOptions = {}): Promise<RunOutcome> {
  const now = new Date();
  const leaseMs = opts.deadline ? STEP_LEASE_MS : LEASE_MS;
  // Atomik lease alma: yalnız kilitsiz veya süresi dolmuş kilitte. Paralel/çift istek → "skipped".
  const claimed = await db.jobRecord.updateMany({
    where: { id: jobId, status: { in: ["queued", "running", "failed"] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { status: "running", lockedUntil: new Date(now.getTime() + leaseMs), attempts: { increment: 1 }, startedAt: now },
  });
  if (claimed.count === 0) return "skipped";
  const job = await db.jobRecord.findUniqueOrThrow({ where: { id: jobId } });
  const handler = handlers[job.type];
  if (!handler) {
    await db.jobRecord.update({ where: { id: jobId }, data: { status: "dead", deadReason: `unknown_type:${job.type}`, lockedUntil: null, finishedAt: new Date() } });
    return "dead";
  }
  const baseCursor = (job.cursor ?? {}) as Record<string, unknown>;
  try {
    const result = await handler({
      db,
      job,
      deadline: opts.deadline,
      step: baseCursor.step,
      saveStep: async (step) => {
        await db.jobRecord.update({ where: { id: jobId }, data: { cursor: { ...baseCursor, step } as object } });
      },
      progress: async (done, total) => {
        await db.jobRecord.update({ where: { id: jobId }, data: { progressDone: done, progressTotal: total, lockedUntil: new Date(Date.now() + leaseMs) } });
      },
    });
    if (result === "continue") {
      // Adım tamam, iş sürüyor: "devam bekliyor" (queued) — deneme sayılmaz.
      await db.jobRecord.update({ where: { id: jobId }, data: { status: "queued", lockedUntil: null, attempts: { decrement: 1 }, lastError: null } });
      return "continue";
    }
    const status = result === "partial" ? "partial" : "succeeded";
    await db.jobRecord.update({ where: { id: jobId }, data: { status, lockedUntil: null, finishedAt: new Date(), lastError: null } });
    return status;
  } catch (e) {
    const message = (e as Error).message?.slice(0, 500) ?? "error";
    const retry = isRetryable(e) && job.attempts < job.maxAttempts;
    log.warn("job.failed", { jobId, type: job.type, attempt: job.attempts, retry, workerId, error: message });
    await db.jobRecord.update({
      where: { id: jobId },
      data: retry
        ? { status: "failed", lastError: message, lockedUntil: null }
        : { status: "dead", lastError: message, deadReason: isRetryable(e) ? "max_attempts" : "non_retryable", lockedUntil: null, finishedAt: new Date() },
    });
    if (job.type === "audit" && !retry) {
      const { auditId } = job.payloadRef as { auditId: string };
      await db.audit.update({ where: { id: auditId }, data: { status: "failed", errorCode: "audit_failed", stage: "failed" } }).catch(() => undefined);
    }
    if (job.type === "monitor_run" && !retry) {
      // Terminal hata: çalıştırma "sürüyor" görünmesin; ayrılmış kota serbest bırakılır.
      const { runId, quotaOperationId } = job.payloadRef as { runId: string; quotaOperationId?: string | null };
      await db.monitoringRun.updateMany({ where: { id: runId, status: { in: ["queued", "running"] } }, data: { status: "failed", finishedAt: new Date() } }).catch(() => undefined);
      if (quotaOperationId) await release(db, quotaOperationId).catch(() => undefined);
    }
    return retry ? "retry" : "dead";
  }
}

/** DLQ replay (admin): dead işi yeniden kuyruğa alınabilir hale getirir. */
export async function replayDeadJob(db: PrismaClient, jobId: string) {
  return db.jobRecord.update({ where: { id: jobId }, data: { status: "queued", attempts: 0, deadReason: null, lastError: null, lockedUntil: null } });
}
