import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { normalizeDomain } from "@/modules/audit/crawler";

export const GET = brandRoute(async ({ access, requestId }) => {
  const rows = await db.competitor.findMany({ where: { brandId: access.brandId, workspaceId: access.workspaceId }, orderBy: { createdAt: "asc" } });
  return json(rows, { requestId });
});

const body = z.object({ name: z.string().trim().min(2).max(80), domain: z.string().trim().min(3).max(253), aliases: z.array(z.string().trim().min(1).max(60)).max(10).default([]), confirm: z.boolean().default(true) });

export const POST = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "prompts.write");
  const input = await readJson(req, body);
  let domain: string;
  try {
    domain = normalizeDomain(input.domain);
  } catch {
    throw new AppError("validation_error", "Geçersiz alan adı", { fieldErrors: { domain: ["Geçersiz alan adı"] } });
  }
  if (domain === access.brand.domain) throw new AppError("validation_error", "Kendi markanız rakip olarak eklenemez");
  const active = await db.competitor.count({ where: { brandId: access.brandId, archivedAt: null, confirmedAt: { not: null } } });
  if (input.confirm && active >= access.entitlements.competitorsPerBrand) throw new AppError("plan_required", `Paketiniz marka başına ${access.entitlements.competitorsPerBrand} rakip içerir`, { limit: access.entitlements.competitorsPerBrand, used: active });
  const c = await db.competitor.upsert({
    where: { brandId_domain: { brandId: access.brandId, domain } },
    update: { name: input.name, aliases: input.aliases, archivedAt: null, confirmedAt: input.confirm ? new Date() : null },
    create: { workspaceId: access.workspaceId, brandId: access.brandId, name: input.name, domain, aliases: input.aliases, confirmedAt: input.confirm ? new Date() : null },
  });
  return json(c, { status: 201, requestId });
});
