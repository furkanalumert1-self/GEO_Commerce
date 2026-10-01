import { Queue } from "bullmq";
import type { PrismaClient } from "@/generated/prisma/client";
import { config } from "@/lib/config";
import { log } from "@/lib/observability/log";

/**
 * İş kuyruğu: DB JobRecord + OutboxEvent (kaynak gerçeklik) → BullMQ.
 * Crash sonrası outbox relay yeniden enqueue eder; handler'lar operationId ile idempotenttir.
 * Uzun işler HTTP isteği içinde çalıştırılmaz.
 */
export const QUEUE_NAME = "geo-jobs";

export type JobType =
  | "audit"
  | "commerce_sync"
  | "crawl"
  | "monitor_run"
  | "generate_opportunities"
  | "generate_action"
  | "publish"
  | "sync_catalog"
  | "sync_orders"
  | "attribute"
  | "ads_sync"
  | "conversion_send"
  | "render_report"
  | "notify"
  | "retention"
  | "quota_cleanup"
  | "webhook_delivery";

export interface EnqueueInput {
  type: JobType;
  operationId: string;
  workspaceId?: string | null;
  brandId?: string | null;
  payload: Record<string, unknown>;
  correlationId?: string;
  configVersion?: string;
  maxAttempts?: number;
}

export function redisConnection() {
  const url = config().REDIS_URL;
  if (!url) return null;
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null as null,
  };
}

let queue: Queue | null = null;
export function getQueue(): Queue | null {
  const conn = redisConnection();
  if (!conn) return null;
  queue ??= new Queue(QUEUE_NAME, { connection: conn });
  return queue;
}

/** JobRecord oluşturur (operationId ile dedupe) ve outbox'a yazar; ardından en iyi çabayla kuyruğa iter. */
export async function enqueue(db: PrismaClient, input: EnqueueInput) {
  const record = await db.$transaction(async (tx) => {
    const existing = await tx.jobRecord.findUnique({ where: { operationId: input.operationId } });
    if (existing) return { job: existing, created: false };
    const job = await tx.jobRecord.create({
      data: {
        type: input.type,
        operationId: input.operationId,
        workspaceId: input.workspaceId ?? null,
        brandId: input.brandId ?? null,
        correlationId: input.correlationId ?? input.operationId,
        configVersion: input.configVersion,
        payloadRef: input.payload as object,
        maxAttempts: input.maxAttempts ?? 5,
      },
    });
    await tx.outboxEvent.create({ data: { workspaceId: input.workspaceId ?? null, eventType: "job.enqueue", payload: { jobId: job.id } } });
    return { job, created: true };
  });
  if (record.created) await relayOutbox(db, 20).catch((e) => log.warn("queue.relay_deferred", { error: e }));
  return record.job;
}

/** Outbox → BullMQ. Redis yoksa kayıtlar outbox'ta bekler (UI "kuyruk yapılandırılmamış" gösterir). */
export async function relayOutbox(db: PrismaClient, limit = 100): Promise<number> {
  const q = getQueue();
  if (!q) return 0;
  const events = await db.outboxEvent.findMany({ where: { deliveredAt: null, eventType: "job.enqueue" }, orderBy: { createdAt: "asc" }, take: limit });
  let n = 0;
  for (const e of events) {
    const jobId = (e.payload as { jobId: string }).jobId;
    const rec = await db.jobRecord.findUnique({ where: { id: jobId } });
    if (!rec) {
      await db.outboxEvent.update({ where: { id: e.id }, data: { deliveredAt: new Date() } });
      continue;
    }
    // BullMQ jobId = JobRecord.id → aynı iş iki kez kuyruğa girmez.
    await q.add(rec.type, { jobId: rec.id }, { jobId: rec.id, attempts: rec.maxAttempts, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 1000, removeOnFail: false });
    await db.outboxEvent.update({ where: { id: e.id }, data: { deliveredAt: new Date(), attempts: { increment: 1 } } });
    n++;
  }
  return n;
}

export async function jobStatus(db: PrismaClient, jobId: string, workspaceId: string | null) {
  const job = await db.jobRecord.findFirst({ where: { id: jobId, workspaceId } });
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: { done: job.progressDone, total: job.progressTotal },
    attempts: job.attempts,
    error: job.status === "failed" || job.status === "dead" ? (job.lastError ?? "Bilinmeyen hata") : null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}
