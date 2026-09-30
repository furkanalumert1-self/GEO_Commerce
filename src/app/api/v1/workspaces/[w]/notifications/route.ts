import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { json, readJson, workspaceRoute } from "@/lib/http/api";

export const GET = workspaceRoute(async ({ access, requestId }) => {
  if (!access.principal.userId) throw new AppError("forbidden", "Yalnız kullanıcı bildirimleri");
  const rows = await db.notification.findMany({ where: { workspaceId: access.workspaceId, userId: access.principal.userId }, orderBy: { createdAt: "desc" }, take: 50 });
  return json(rows, { requestId });
});

const body = z.object({ markAllRead: z.boolean().optional(), ids: z.array(z.string().uuid()).max(100).optional() });

export const PATCH = workspaceRoute(async ({ req, access, requestId }) => {
  if (!access.principal.userId) throw new AppError("forbidden", "Yalnız kullanıcı bildirimleri");
  const input = await readJson(req, body);
  const n = await db.notification.updateMany({ where: { workspaceId: access.workspaceId, userId: access.principal.userId, readAt: null, ...(input.markAllRead ? {} : { id: { in: input.ids ?? [] } }) }, data: { readAt: new Date() } });
  return json({ updated: n.count }, { requestId });
});
