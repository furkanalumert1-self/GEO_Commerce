import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { randomToken } from "@/lib/crypto";
import { getPrincipal, json, readJson, route } from "@/lib/http/api";

const body = z.object({ name: z.string().trim().min(2).max(80), timezone: z.string().max(60).default("Europe/Istanbul") });

export const POST = route(async ({ req, requestId }) => {
  const p = await getPrincipal(req);
  if (p.kind !== "user" || !p.userId) throw new AppError("unauthenticated", "Oturum gerekli");
  const input = await readJson(req, body);
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    throw new AppError("validation_error", "Geçersiz saat dilimi", { fieldErrors: { timezone: ["Geçersiz saat dilimi"] } });
  }
  const slug = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${randomToken(4).toLowerCase()}`;
  const ws = await db.workspace.create({ data: { name: input.name, slug, ownerId: p.userId, timezone: input.timezone, memberships: { create: { userId: p.userId, role: "owner", isApprover: true } } } });
  return json({ id: ws.id, name: ws.name, timezone: ws.timezone }, { status: 201, requestId });
});
