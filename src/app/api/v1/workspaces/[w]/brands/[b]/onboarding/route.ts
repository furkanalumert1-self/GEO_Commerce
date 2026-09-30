import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";

export const GET = brandRoute(async ({ access, requestId }) => {
  const b = await db.brand.findUniqueOrThrow({ where: { id: access.brandId }, select: { onboarding: true, country: true, language: true, timezone: true, currency: true, aliases: true, categories: true } });
  return json(b, { requestId });
});

const body = z.object({
  step: z.number().int().min(1).max(7),
  country: z.string().length(2).optional(),
  language: z.string().min(2).max(5).optional(),
  timezone: z.string().max(60).optional(),
  currency: z.string().length(3).optional(),
  aliases: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  categories: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  completed: z.boolean().optional(),
});

/** Wizard autosave: her adım kaydedilir; kaldığı yerden devam. */
export const PATCH = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "brand.manage");
  const input = await readJson(req, body);
  const { step, completed, ...fields } = input;
  const b = await db.brand.findUniqueOrThrow({ where: { id: access.brandId } });
  const prev = (b.onboarding ?? {}) as Record<string, unknown>;
  const updated = await db.brand.update({
    where: { id: access.brandId },
    data: { ...fields, ...(fields.country ? { country: fields.country.toUpperCase() } : {}), ...(fields.currency ? { currency: fields.currency.toUpperCase() } : {}), onboarding: { ...prev, step: Math.max(Number(prev.step ?? 1), step), completed: completed ?? prev.completed ?? false, savedAt: new Date().toISOString() } },
  });
  return json({ onboarding: updated.onboarding }, { requestId });
});
