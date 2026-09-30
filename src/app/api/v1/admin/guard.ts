import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { assertSameOrigin } from "@/lib/http/api";

/** Platform admin: ayrı allowlist (+ IdP tarafında MFA zorunluluğu runbook'ta). */
export async function requirePlatformAdmin(req: NextRequest) {
  const s = await auth();
  if (!s?.user?.id) throw new AppError("unauthenticated", "Oturum gerekli");
  const user = await db.user.findUnique({ where: { id: s.user.id } });
  if (!user || !config().platformAdmins.includes(user.email.toLowerCase())) throw new AppError("not_found", "Bulunamadı");
  assertSameOrigin(req);
  return user;
}
