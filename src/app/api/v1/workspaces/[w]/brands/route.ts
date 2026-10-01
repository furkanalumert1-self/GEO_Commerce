import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { json, readJson, workspaceRoute } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { normalizeDomain } from "@/modules/audit/crawler";
import { isDemoDomain } from "@/lib/demo";
import { assertPublicUrl } from "@/lib/http/safe-fetch";

export const GET = workspaceRoute(async ({ access, requestId }) => {
  const brands = await db.brand.findMany({
    where: { workspaceId: access.workspaceId, archivedAt: null, ...(access.brandIds === "all" ? {} : { id: { in: access.brandIds } }) },
    select: { id: true, name: true, domain: true, country: true, language: true, currency: true, verifiedAt: true, readOnly: true },
    orderBy: { createdAt: "asc" },
  });
  return json(brands, { requestId });
});

const body = z.object({
  name: z.string().trim().min(2).max(80),
  domain: z.string().trim().min(3).max(253),
  country: z.string().length(2).default("TR"),
  language: z.string().min(2).max(5).default("tr"),
  timezone: z.string().max(60).default("Europe/Istanbul"),
  currency: z.string().length(3).default("TRY"),
  aliases: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
});

export const POST = workspaceRoute(async ({ req, access, requestId }) => {
  assertCan(access, "brand.manage");
  const input = await readJson(req, body);
  const count = await db.brand.count({ where: { workspaceId: access.workspaceId, archivedAt: null } });
  if (count >= access.entitlements.brands) throw new AppError("plan_required", `Paketiniz en fazla ${access.entitlements.brands} marka içerir`, { limit: access.entitlements.brands, used: count });
  let domain: string;
  try {
    domain = normalizeDomain(input.domain);
  } catch {
    throw new AppError("validation_error", "Geçersiz alan adı", { fieldErrors: { domain: ["Geçersiz alan adı"] } });
  }
  // `.example` örnek alan adları yalnız demo workspace'te; demo workspace'e gerçek alan adı eklenmez.
  if (isDemoDomain(domain) !== access.isDemo) {
    throw new AppError("validation_error", access.isDemo ? "Demo çalışma alanında yalnız örnek (.example) alan adı kullanılabilir" : "Gerçek bir alan adı girin; .example yalnız demo içindir", { fieldErrors: { domain: [access.isDemo ? "Örnek alan adı kullanın" : "Gerçek alan adı girin"] } });
  }
  if (!access.isDemo) {
    await assertPublicUrl(`https://${domain}/`).catch(() => {
      throw new AppError("validation_error", "Alan adı herkese açık bir adrese çözümlenmiyor", { fieldErrors: { domain: ["Herkese açık bir alan adı girin"] } });
    });
  }
  const existing = await db.brand.findFirst({ where: { workspaceId: access.workspaceId, domain } });
  if (existing) throw new AppError("conflict", "Bu alan adı zaten ekli");
  const brand = await db.brand.create({ data: { ...input, domain, country: input.country.toUpperCase(), currency: input.currency.toUpperCase(), workspaceId: access.workspaceId, onboarding: { step: 2 } } });
  return json({ id: brand.id, name: brand.name, domain: brand.domain }, { status: 201, requestId });
});
