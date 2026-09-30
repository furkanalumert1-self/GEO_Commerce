import type { PrismaClient } from "@/generated/prisma/client";
import { log } from "@/lib/observability/log";

/**
 * Retention (§10/§13): ham yanıt/crawl payload 30 gün; anonim audit 7 gün (claim edilmemiş);
 * idempotency kayıtları 7 gün. Aggregate snapshot'lar paket süresince korunur.
 */
export const RAW_TTL_DAYS = 30;
export const AUDIT_ANON_TTL_DAYS = 7;

export async function runRetention(db: PrismaClient, now = new Date()) {
  const rawCutoff = new Date(now.getTime() - RAW_TTL_DAYS * 86_400_000);
  const raw = await db.observation.updateMany({ where: { sampledAt: { lt: rawCutoff }, rawText: { not: null } }, data: { rawText: null, rawStorageKey: null } });
  const audits = await db.audit.deleteMany({ where: { claimedAt: null, expiresAt: { lt: now } } });
  const idem = await db.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
  const outbox = await db.outboxEvent.deleteMany({ where: { deliveredAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
  log.info("retention.done", { raw: raw.count, audits: audits.count, idem: idem.count, outbox: outbox.count });
  return { raw: raw.count, audits: audits.count, idempotency: idem.count, outbox: outbox.count };
}
