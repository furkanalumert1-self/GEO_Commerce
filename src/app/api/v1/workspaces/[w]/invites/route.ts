import { z } from "zod";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import { hashToken, randomToken } from "@/lib/crypto";
import { json, readJson, workspaceRoute } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { getEmailAdapter } from "@/adapters/email";

const body = z.object({ email: z.string().email().max(200), role: z.enum(["admin", "editor", "analyst", "viewer", "client", "billing"]), brandIds: z.array(z.string().uuid()).max(50).default([]) });

export const POST = workspaceRoute(async ({ req, access, requestId }) => {
  assertCan(access, "members.manage");
  const input = await readJson(req, body);
  const seats = await db.membership.count({ where: { workspaceId: access.workspaceId } });
  if (seats >= access.entitlements.seats) throw new AppError("plan_required", `Paketiniz en fazla ${access.entitlements.seats} koltuk içerir`, { limit: access.entitlements.seats, used: seats });
  if (input.brandIds.length) {
    const n = await db.brand.count({ where: { id: { in: input.brandIds }, workspaceId: access.workspaceId } });
    if (n !== input.brandIds.length) throw new AppError("validation_error", "Geçersiz marka seçimi");
  }
  if ((input.role === "client" || input.role === "viewer") && input.brandIds.length === 0) throw new AppError("validation_error", "Müşteri/görüntüleyici için en az bir marka seçin");
  const token = randomToken();
  const inv = await db.invite.create({ data: { workspaceId: access.workspaceId, email: input.email.toLowerCase(), role: input.role, brandIds: input.brandIds, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  const email = getEmailAdapter();
  let delivered = false;
  if (email.status() === "ready") {
    await email.send({ to: input.email, subject: "Çalışma alanı daveti", text: `Davet bağlantınız (7 gün geçerli): ${config().APP_URL}/invite/${token}` });
    delivered = true;
  }
  await db.auditLog.create({ data: { workspaceId: access.workspaceId, actorId: access.principal.userId, actorType: "user", scope: "members", action: "invite.created", target: inv.id } });
  return json({ id: inv.id, delivered, emailStatus: email.status(), inviteUrl: delivered ? null : `${config().APP_URL}/invite/${token}` }, { status: 201, requestId });
});
