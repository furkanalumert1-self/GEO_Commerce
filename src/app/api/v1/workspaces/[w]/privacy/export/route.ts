import { db } from "@/lib/db";
import { json, workspaceRoute } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";

/** Veri dışa aktarma talebi — kapsamlı job; talep kaydı ve son tarih (30 gün). */
export const POST = workspaceRoute(async ({ access, requestId }) => {
  assertCan(access, "privacy.manage");
  const r = await db.privacyRequest.create({ data: { workspaceId: access.workspaceId, requestedBy: access.principal.userId!, kind: "export", dueAt: new Date(Date.now() + 30 * 86_400_000) } });
  await db.auditLog.create({ data: { workspaceId: access.workspaceId, actorId: access.principal.userId, actorType: "user", scope: "privacy", action: "privacy.export_requested", target: r.id } });
  return json({ id: r.id, status: r.status, dueAt: r.dueAt }, { status: 202, requestId });
});
