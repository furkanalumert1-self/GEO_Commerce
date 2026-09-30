import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/http/errors";

/**
 * Kota: atomik reserve → commit/release (§3).
 * - Aynı operationId ile tekrar reserve → mevcut rezervasyon döner (retry'da çift borç yok).
 * - Başarısız yanıt kota tüketmez: commit yalnız başarılı birim sayısıyla yapılır, kalan release edilir.
 * - Süresi dolan rezervasyonlar cleanup ile release edilir (job iptal/timeout).
 */
export type Metric = "answer_units" | "fix_units" | "crawl_urls" | "commerce_events" | "free_audit";

export interface ReserveInput {
  workspaceId: string;
  metric: Metric;
  period: string;
  limit: number;
  amount: number;
  operationId: string;
  ttlMs?: number;
}

export interface ReservationView {
  id: string;
  operationId: string;
  amount: number;
  committed: number;
  state: "reserved" | "committed" | "released";
  reused: boolean;
}

export async function ensureBucket(db: PrismaClient, workspaceId: string, metric: Metric, period: string, limit: number) {
  return db.usageBucket.upsert({
    where: { workspaceId_metric_period: { workspaceId, metric, period } },
    update: { limit },
    create: { workspaceId, metric, period, limit },
  });
}

export async function reserve(db: PrismaClient, input: ReserveInput): Promise<ReservationView> {
  if (input.amount <= 0 || !Number.isInteger(input.amount)) throw new AppError("validation_error", "Geçersiz kota miktarı");
  const existing = await db.usageReservation.findUnique({ where: { operationId: input.operationId } });
  if (existing) {
    if (existing.workspaceId !== input.workspaceId) throw new AppError("conflict", "operationId çakışması");
    return { ...pick(existing), reused: true };
  }
  const bucket = await ensureBucket(db, input.workspaceId, input.metric, input.period, input.limit);
  try {
    return await db.$transaction(async (tx) => {
      // Koşullu atomik artış: yarış durumunda limit aşılamaz.
      const updated = await tx.$executeRaw`
        UPDATE "UsageBucket" SET "reserved" = "reserved" + ${input.amount}, "updatedAt" = now()
        WHERE "id" = ${bucket.id}::uuid AND "used" + "reserved" + ${input.amount} <= "limit"`;
      if (updated === 0) {
        const b = await tx.usageBucket.findUniqueOrThrow({ where: { id: bucket.id } });
        throw new AppError("quota_exceeded", "Kota yetersiz", {
          limit: b.limit,
          used: b.used,
          reserved: b.reserved,
          resetAt: nextPeriodHint(input.period),
        });
      }
      const r = await tx.usageReservation.create({
        data: {
          workspaceId: input.workspaceId,
          bucketId: bucket.id,
          operationId: input.operationId,
          amount: input.amount,
          expiresAt: new Date(Date.now() + (input.ttlMs ?? 30 * 60_000)),
        },
      });
      return { ...pick(r), reused: false };
    });
  } catch (e) {
    // Eşzamanlı aynı operationId: unique ihlali → mevcut rezervasyonu döndür.
    if (isUniqueViolation(e)) {
      const r = await db.usageReservation.findUniqueOrThrow({ where: { operationId: input.operationId } });
      return { ...pick(r), reused: true };
    }
    throw e;
  }
}

/** Başarılı birim sayısı kadar used'a aktarır, kalan rezervi serbest bırakır. İdempotent. */
export async function commit(db: PrismaClient, operationId: string, successfulUnits: number): Promise<ReservationView> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "UsageReservation" WHERE "operationId" = ${operationId} FOR UPDATE`;
    if (rows.length === 0) throw new AppError("not_found", "Rezervasyon bulunamadı");
    const r = await tx.usageReservation.findUniqueOrThrow({ where: { operationId } });
    if (r.state !== "reserved") return { ...pick(r), reused: true };
    const units = Math.max(0, Math.min(r.amount, Math.floor(successfulUnits)));
    await tx.$executeRaw`
      UPDATE "UsageBucket" SET "reserved" = GREATEST(0, "reserved" - ${r.amount}), "used" = "used" + ${units}, "updatedAt" = now()
      WHERE "id" = ${r.bucketId}::uuid`;
    const done = await tx.usageReservation.update({ where: { id: r.id }, data: { state: "committed", committed: units } });
    return { ...pick(done), reused: false };
  });
}

export async function release(db: PrismaClient, operationId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "UsageReservation" WHERE "operationId" = ${operationId} FOR UPDATE`;
    if (rows.length === 0) return;
    const r = await tx.usageReservation.findUniqueOrThrow({ where: { operationId } });
    if (r.state !== "reserved") return;
    await tx.$executeRaw`
      UPDATE "UsageBucket" SET "reserved" = GREATEST(0, "reserved" - ${r.amount}), "updatedAt" = now()
      WHERE "id" = ${r.bucketId}::uuid`;
    await tx.usageReservation.update({ where: { id: r.id }, data: { state: "released" } });
  });
}

/** Lease cleanup: süresi dolan rezervasyonları release eder. */
export async function releaseExpired(db: PrismaClient, now = new Date()): Promise<number> {
  const expired = await db.usageReservation.findMany({ where: { state: "reserved", expiresAt: { lt: now } }, select: { operationId: true }, take: 500 });
  for (const r of expired) await release(db, r.operationId);
  return expired.length;
}

export async function usageSummary(db: PrismaClient, workspaceId: string, period: string) {
  const buckets = await db.usageBucket.findMany({ where: { workspaceId, period } });
  return buckets.map((b) => ({
    metric: b.metric,
    limit: b.limit,
    used: b.used,
    reserved: b.reserved,
    pct: b.limit === 0 ? null : Math.round(((b.used + b.reserved) / b.limit) * 100),
  }));
}

/** %80 / %100 eşik geçişlerini bir kez raporlar. */
export async function thresholdCrossings(db: PrismaClient, workspaceId: string, metric: Metric, period: string): Promise<Array<80 | 100>> {
  const b = await db.usageBucket.findUnique({ where: { workspaceId_metric_period: { workspaceId, metric, period } } });
  if (!b || b.limit === 0) return [];
  const pct = (b.used / b.limit) * 100;
  const out: Array<80 | 100> = [];
  if (pct >= 80 && !b.notified80) out.push(80);
  if (pct >= 100 && !b.notified100) out.push(100);
  if (out.length) {
    await db.usageBucket.update({
      where: { id: b.id },
      data: { notified80: b.notified80 || pct >= 80, notified100: b.notified100 || pct >= 100 },
    });
  }
  return out;
}

/** Subscription cycle (UTC) — period anahtarı dönem başlangıcı. */
export function periodKey(periodStart: Date): string {
  return periodStart.toISOString().slice(0, 10);
}

function nextPeriodHint(period: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return period;
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

function pick(r: { id: string; operationId: string; amount: number; committed: number; state: "reserved" | "committed" | "released" }) {
  return { id: r.id, operationId: r.operationId, amount: r.amount, committed: r.committed, state: r.state };
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
}
