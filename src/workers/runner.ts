import type { PrismaClient } from "@/generated/prisma/client";
import { log } from "@/lib/observability/log";
import { handlers, NonRetryableError } from "./handlers";
import { ProviderError } from "@/adapters/ai/types";
import { isAppError } from "@/lib/http/errors";

/**
 * Tek bir JobRecord'u yürütür (BullMQ worker ve testler bu fonksiyonu çağırır).
 * - Lease (lockedUntil) ile aynı işin iki worker'da eşzamanlı yürümesi engellenir.
 * - Geçici hata: yeniden denenir (max attempts); auth/validation: retry yok → dead (DLQ) + neden.
 */
export type RunOutcome = "succeeded" | "retry" | "dead" | "skipped";

const LEASE_MS = 15 * 60_000;

function isRetryable(e: unknown): boolean {
  if (e instanceof NonRetryableError) return false;
  if (e instanceof ProviderError) return e.retryable;
  if (isAppError(e)) return Boolean(e.details.retryable);
  return true;
}

export async function runJob(db: PrismaClient, jobId: string, workerId = "local"): Promise<RunOutcome> {
  const now = new Date();
  // Atomik lease alma: yalnız kilitsiz veya süresi dolmuş kilitte.
  const claimed = await db.jobRecord.updateMany({
    where: { id: jobId, status: { in: ["queued", "running", "failed"] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { status: "running", lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 }, startedAt: now },
  });
  if (claimed.count === 0) return "skipped";
  const job = await db.jobRecord.findUniqueOrThrow({ where: { id: jobId } });
  const handler = handlers[job.type];
  if (!handler) {
    await db.jobRecord.update({ where: { id: jobId }, data: { status: "dead", deadReason: `unknown_type:${job.type}`, lockedUntil: null, finishedAt: new Date() } });
    return "dead";
  }
  try {
    await handler({
      db,
      job,
      progress: async (done, total) => {
        await db.jobRecord.update({ where: { id: jobId }, data: { progressDone: done, progressTotal: total, lockedUntil: new Date(Date.now() + LEASE_MS) } });
      },
    });
    await db.jobRecord.update({ where: { id: jobId }, data: { status: "succeeded", lockedUntil: null, finishedAt: new Date(), lastError: null } });
    return "succeeded";
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
    return retry ? "retry" : "dead";
  }
}

/** DLQ replay (admin): dead işi yeniden kuyruğa alınabilir hale getirir. */
export async function replayDeadJob(db: PrismaClient, jobId: string) {
  return db.jobRecord.update({ where: { id: jobId }, data: { status: "queued", attempts: 0, deadReason: null, lastError: null, lockedUntil: null } });
}
