import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { json, rateLimit, route } from "@/lib/http/api";
import { advanceJob } from "@/lib/queue/advance";
import { getAuditByToken, publicAuditView } from "@/modules/audit/service";

export const maxDuration = 120;

/**
 * Anonim ücretsiz audit'in sonraki adımı. Yetki: tahmin edilemeyen, süreli audit bağlantısı (token); yalnız bu
 * audit'in işi ilerler. Toplam ücretli çağrı sayısı audit başında sabittir (sorular × motorlar); tekrar
 * çağrılar tamamlanmış adımları yeniden çalıştırmaz.
 */
export const POST = route<{ token: string }>(async ({ params, requestId }) => {
  const a = await getAuditByToken(db, params.token);
  if (!a) throw notFound("Audit");
  rateLimit(`audit-advance:${a.id}`, 40, 60_000);
  const job = await db.jobRecord.findUnique({ where: { operationId: `audit:${a.id}` }, select: { id: true } });
  if (!job) throw notFound("Audit işi");
  const r = await advanceJob(db, job.id, null);
  const fresh = await db.audit.findUniqueOrThrow({ where: { id: a.id } });
  return json({ ...publicAuditView(fresh), step: { outcome: r.outcome, progress: r.job?.progress ?? null, resumable: r.job?.resumable ?? false, error: r.job?.error ?? null } }, { requestId, headers: { "x-robots-tag": "noindex", "cache-control": "no-store" } });
});
