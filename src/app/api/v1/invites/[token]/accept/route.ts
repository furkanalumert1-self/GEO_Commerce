import { db } from "@/lib/db";
import { hashToken } from "@/lib/crypto";
import { AppError } from "@/lib/http/errors";
import { getPrincipal, json, route } from "@/lib/http/api";

export const POST = route<{ token: string }>(async ({ req, params, requestId }) => {
  const p = await getPrincipal(req);
  if (p.kind !== "user" || !p.userId) throw new AppError("unauthenticated", "Oturum gerekli");
  const user = await db.user.findUniqueOrThrow({ where: { id: p.userId } });
  const out = await db.$transaction(async (tx) => {
    const inv = await tx.invite.findUnique({ where: { tokenHash: hashToken(params.token) } });
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) throw new AppError("not_found", "Davet geçersiz");
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new AppError("forbidden", "Davet başka bir e-posta adresine gönderildi");
    const consumed = await tx.invite.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (consumed.count === 0) throw new AppError("conflict", "Davet zaten kullanıldı");
    const m = await tx.membership.upsert({ where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } }, update: {}, create: { workspaceId: inv.workspaceId, userId: user.id, role: inv.role } });
    for (const brandId of inv.brandIds) {
      await tx.brandGrant.upsert({ where: { membershipId_brandId: { membershipId: m.id, brandId } }, update: {}, create: { workspaceId: inv.workspaceId, membershipId: m.id, brandId, role: inv.role } });
    }
    await tx.auditLog.create({ data: { workspaceId: inv.workspaceId, actorId: user.id, actorType: "user", scope: "members", action: "invite.accepted", target: inv.id } });
    return { workspaceId: inv.workspaceId };
  });
  return json(out, { requestId });
});
