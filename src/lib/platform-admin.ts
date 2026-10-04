import { auth } from "@/auth";
import { config } from "@/lib/config";
import { db } from "@/lib/db";

/** Oturumdaki kullanıcı PLATFORM_ADMIN_ALLOWLIST'teyse e-postası; değilse (veya oturum yoksa) null. */
export async function platformAdminEmail(): Promise<string | null> {
  try {
    const s = await auth();
    if (!s?.user?.id) return null;
    const user = await db.user.findUnique({ where: { id: s.user.id }, select: { email: true } });
    const email = user?.email.toLowerCase();
    return email && config().platformAdmins.includes(email) ? email : null;
  } catch {
    return null;
  }
}
