import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { getPrincipal, json, route } from "@/lib/http/api";
import { claimAudit } from "@/modules/audit/service";

export const POST = route<{ token: string }>(async ({ req, params, requestId }) => {
  const p = await getPrincipal(req);
  if (p.kind !== "user" || !p.userId) throw new AppError("unauthenticated", "Doğrulanmış oturum gerekli");
  const user = await db.user.findUnique({ where: { id: p.userId } });
  if (!user?.emailVerified) throw new AppError("forbidden", "Raporu kaydetmek için e-postanızı doğrulayın");
  const out = await claimAudit(db, params.token, p.userId);
  return json(out, { requestId });
});
