import { z } from "zod";
import { db } from "@/lib/db";
import { json, readJson, workspaceRoute } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";

export const GET = workspaceRoute(async ({ access, requestId }) => {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: access.workspaceId }, select: { id: true, name: true, timezone: true, billingCurrency: true, isDemo: true } });
  return json({ ...ws, role: access.role, plan: access.entitlements.planKey, trial: access.entitlements.trial }, { requestId });
});

const patch = z.object({ name: z.string().trim().min(2).max(80).optional(), timezone: z.string().max(60).optional() });

export const PATCH = workspaceRoute(async ({ req, access, requestId }) => {
  assertCan(access, "workspace.update");
  const input = await readJson(req, patch);
  const ws = await db.workspace.update({ where: { id: access.workspaceId }, data: input });
  await db.auditLog.create({ data: { workspaceId: access.workspaceId, actorId: access.principal.userId, actorType: access.principal.kind, scope: "workspace", action: "workspace.updated", target: ws.id, beforeAfter: input } });
  return json({ id: ws.id, name: ws.name, timezone: ws.timezone }, { requestId });
});
