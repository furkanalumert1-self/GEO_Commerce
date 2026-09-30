import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { json, route } from "@/lib/http/api";
import { getAuditByToken, publicAuditView } from "@/modules/audit/service";

export const GET = route<{ token: string }>(async ({ params, requestId }) => {
  const a = await getAuditByToken(db, params.token);
  if (!a) throw notFound("Audit");
  return json(publicAuditView(a), { requestId, headers: { "x-robots-tag": "noindex", "cache-control": "no-store" } });
});
