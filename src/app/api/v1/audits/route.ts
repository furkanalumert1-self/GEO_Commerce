import { z } from "zod";
import { db } from "@/lib/db";
import { json, rateLimit, readJson, route } from "@/lib/http/api";
import { startAudit } from "@/modules/audit/service";

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
  const out = await startAudit(db, { domain: input.domain, locale: input.locale, fingerprint: `${input.fingerprint}|${ip}` });
  return json({ jobId: out.jobId, status: "queued", token: out.token, statusUrl: `/api/v1/audits/${out.token}` }, { status: 202, requestId });
});
