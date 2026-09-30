import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { json, workspaceRoute } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";

export const DELETE = workspaceRoute<{ w: string; id: string }>(async ({ params, access, requestId }) => {
  assertCan(access, "apikeys.manage");
  const k = await db.apiKey.findFirst({ where: { id: params.id, workspaceId: access.workspaceId } });
  if (!k) throw notFound("API anahtarı");
  await db.apiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() } });
  await db.auditLog.create({ data: { workspaceId: access.workspaceId, actorId: access.principal.userId, actorType: "user", scope: "apikeys", action: "apikey.revoked", target: k.id } });
  return json({ id: k.id, revoked: true }, { requestId });
});
