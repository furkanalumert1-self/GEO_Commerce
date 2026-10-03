import { z } from "zod";
import { db } from "@/lib/db";
import { json, rateLimit, readJson, route } from "@/lib/http/api";
import { startAudit } from "@/modules/audit/service";
import { auth } from "@/auth";
import { config } from "@/lib/config";
import { log } from "@/lib/observability/log";

/** Oturumdaki kullanıcı PLATFORM_ADMIN_ALLOWLIST'teyse (test amaçlı) 30 gün kuralı atlanır. */
async function platformAdminEmail(): Promise<string | null> {
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

const body = z.object({
  domain: z.string().trim().min(3).max(253),
  locale: z.enum(["tr-TR", "en-US"]).default("tr-TR"),
  fingerprint: z.string().min(8).max(200),
  captchaToken: z.string().max(4000).optional(),
});

/** POST /audits → job + gizli token. Public; IP bazlı rate limit + domain/fingerprint 30 gün kuralı. */
export const POST = route(async ({ req, requestId }) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  rateLimit(`audit:${ip}`, 5, 60 * 60_000);
  const input = await readJson(req, body);
  const admin = await platformAdminEmail();
  const out = await startAudit(db, { domain: input.domain, locale: input.locale, fingerprint: `${input.fingerprint}|${ip}`, adminBypass: Boolean(admin) });
  if (admin) log.info("audit.admin_bypass", { domain: input.domain, requestId });
  return json({ jobId: out.jobId, status: "queued", token: out.token, statusUrl: `/api/v1/audits/${out.token}` }, { status: 202, requestId });
});
