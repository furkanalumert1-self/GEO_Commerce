import { z } from "zod";
import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { json, rateLimit, readJson, route } from "@/lib/http/api";
import { confirmAudit, getAuditByToken, publicAuditView } from "@/modules/audit/service";
import { platformAdminEmail } from "@/lib/platform-admin";

const body = z.object({
  questions: z.array(z.string().max(300)).min(1).max(5),
  topics: z.array(z.string().trim().max(40)).max(2).optional(),
  businessType: z.enum(["manufacturer", "retailer", "brand_store", "marketplace", "service", "saas", "service_saas", "unknown"]).optional(),
});

/** Soruları onaylar ve AI platformlarına soru sorma adımını başlatır. Tekrar gönderim yeni iş/kota oluşturmaz. */
export const POST = route<{ token: string }>(async ({ req, params, requestId }) => {
  const a = await getAuditByToken(db, params.token);
  if (!a) throw notFound("Audit");
  rateLimit(`audit-confirm:${a.id}`, 10, 60_000);
  const input = await readJson(req, body);
  const out = await confirmAudit(db, a.id, input);
  const fresh = await db.audit.findUniqueOrThrow({ where: { id: a.id } });
  return json({ ...publicAuditView(fresh, { admin: Boolean(await platformAdminEmail()) }), jobId: out.jobId }, { requestId, headers: { "cache-control": "no-store" } });
});
