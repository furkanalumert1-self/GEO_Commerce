import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { json, route } from "@/lib/http/api";
import { getAuditByToken, publicAuditView } from "@/modules/audit/service";
import { platformAdminEmail } from "@/lib/platform-admin";

export const GET = route<{ token: string }>(async ({ params, requestId }) => {
  const a = await getAuditByToken(db, params.token);
  if (!a) throw notFound("Audit");
  return json(publicAuditView(a, { admin: Boolean(await platformAdminEmail()) }), { requestId, headers: { "x-robots-tag": "noindex", "cache-control": "no-store" } });
});
