import "dotenv/config";
import { UnrecoverableError, Worker } from "bullmq";
import { createPrismaClient } from "@/lib/db";
import { config } from "@/lib/config";
import { enqueue, getQueue, QUEUE_NAME, redisConnection, relayOutbox } from "@/lib/queue";
import { log } from "@/lib/observability/log";
import { runJob } from "./runner";

/**
 * Kalıcı worker process (web'den ayrı). Outbox relay, stale lock recovery, lease cleanup ve
 * zamanlanmış işler (retention). Graceful shutdown.
 */
async function main() {
  const cfg = config();
  const conn = redisConnection();
  if (!conn) {
    log.error("worker.redis_not_configured", {});
    process.exit(1);
  }
  const db = createPrismaClient();
  const workerId = `w-${process.pid}`;

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const jobId = (job.data as { jobId: string }).jobId;
      const outcome = await runJob(db, jobId, workerId);
      if (outcome === "retry") throw new Error("retry");
      if (outcome === "dead") throw new UnrecoverableError("dead");
    },
    { connection: conn, concurrency: 4, lockDuration: 5 * 60_000 },
  );
  worker.on("failed", (job, err) => log.warn("worker.job_failed", { jobId: job?.id, error: err.message }));

  // Periyodik bakım: outbox relay, stale "running" (süresi dolmuş lease) kurtarma, kota lease cleanup.
  const tick = async () => {
    try {
      await relayOutbox(db);
      const stale = await db.jobRecord.findMany({ where: { status: { in: ["running", "failed"] }, lockedUntil: { lt: new Date() } }, take: 50 });
      const q = getQueue();
      for (const j of stale) await q?.add(j.type, { jobId: j.id }, { jobId: `${j.id}:r${j.attempts}`, attempts: 1 });
      const day = new Date().toISOString().slice(0, 10);
      await enqueue(db, { type: "quota_cleanup", operationId: `quota_cleanup:${new Date().toISOString().slice(0, 13)}`, payload: {} });
      await enqueue(db, { type: "retention", operationId: `retention:${day}`, payload: {} });
    } catch (e) {
      log.warn("worker.tick_failed", { error: e });
    }
  };
  const interval = setInterval(tick, 30_000);
  await tick();
  log.info("worker.started", { workerId, demo: cfg.DEMO_MODE });

  const shutdown = async (signal: string) => {
    log.info("worker.shutdown", { signal });
    clearInterval(interval);
    await worker.close();
    await getQueue()?.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
