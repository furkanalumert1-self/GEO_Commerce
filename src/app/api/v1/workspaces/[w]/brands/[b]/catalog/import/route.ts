import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { productsFromCsv, ordersFromCsv } from "@/adapters/commerce/csv";
import { upsertProducts } from "@/modules/catalog/service";
import { upsertOrder } from "@/modules/commerce/service";

/** CSV import (katalog veya sipariş) — açık etiketli fallback; maks 2 MB metin. */
const body = z.object({
  kind: z.enum(["products", "orders"]),
  csv: z.string().min(1).max(2_000_000),
  mapping: z.record(z.string(), z.string().max(120)),
});

export const POST = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "brand.manage");
  const input = await readJson(req, body);
  const integration = await db.integration.upsert({
    where: { brandId_provider_storeId: { brandId: access.brandId, provider: "csv_feed", storeId: "manual" } },
    update: { lastSyncAt: new Date(), status: "healthy" },
    create: { workspaceId: access.workspaceId, brandId: access.brandId, provider: "csv_feed", storeId: "manual", capabilities: { catalogRead: true, ordersRead: true, refundsRead: true, contentWrite: false }, scopes: [], status: "healthy", lastSyncAt: new Date() },
  });
  if (input.kind === "products") {
    const products = productsFromCsv(input.csv, input.mapping, access.brand.currency);
    const total = await db.product.count({ where: { brandId: access.brandId, active: true } });
    if (total + products.length > access.entitlements.catalogProducts) throw new AppError("quota_exceeded", "Aktif katalog ürünü limiti aşılıyor", { limit: access.entitlements.catalogProducts, used: total });
    const n = await upsertProducts(db, { workspaceId: access.workspaceId, brandId: access.brandId }, products, "csv", integration.id);
    return json({ imported: n, skipped: 0 }, { requestId });
  }
  const orders = ordersFromCsv(input.csv, input.mapping);
  let applied = 0;
  for (const o of orders) if ((await upsertOrder(db, { workspaceId: access.workspaceId, brandId: access.brandId, connectorId: integration.id }, o)).applied) applied++;
  return json({ imported: applied, skipped: orders.length - applied }, { requestId });
});
