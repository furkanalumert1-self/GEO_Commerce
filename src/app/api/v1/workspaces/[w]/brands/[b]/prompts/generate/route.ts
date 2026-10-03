import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { categoryPrompts } from "@/modules/audit/service";
import { seedPrompts } from "@/modules/prompts/seed";

/** POST: markanın ürün kategorilerinden ticari niyetli sorular üretir (tekilleştirilir, paket limitine kadar). */
export const POST = brandRoute(async ({ access, requestId }) => {
  assertCan(access, "prompts.write");
  const brand = await db.brand.findUniqueOrThrow({ where: { id: access.brandId }, select: { name: true, categories: true, country: true, language: true } });
  if (!brand.categories.length) throw new AppError("validation_error", "Önce ürün kategorilerini girin (Kurulum adım 2)");
  const limit = access.entitlements.activePrompts;
  const texts = categoryPrompts(brand.categories, brand.country, limit).map((text) => ({
    text,
    category: brand.categories.find((c) => text.toLocaleLowerCase("tr-TR").includes(c.toLocaleLowerCase("tr-TR"))),
  }));
  const added = await seedPrompts(db, { workspaceId: access.workspaceId, brandId: access.brandId, brandName: brand.name, texts, locale: `${brand.language}-${brand.country}`, source: "generated", activeLimit: limit });
  if (!added) throw new AppError("quota_exceeded", "Yeni soru eklenemedi: aktif prompt limiti dolu veya sorular zaten mevcut", { limit });
  return json({ added }, { status: 201, requestId });
});
