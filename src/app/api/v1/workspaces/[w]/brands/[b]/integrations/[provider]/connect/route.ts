import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { hasFeature } from "@/modules/billing/plans";
import { getCommerceAdapters } from "@/adapters/commerce";
import { startShopifyConnect } from "@/modules/commerce/connect";

const body = z.object({ shopDomain: z.string().trim().min(3).max(253) });

/**
 * Bağlantı başlatma. Shopify: OAuth yetkilendirme adresi döner; "Bağlı" durumu yalnız callback'te gerçek
 * API kontrolünden sonra yazılır. Diğer sağlayıcılar resmi erişim doğrulanana kadar 422 + açık neden.
 */
export const POST = brandRoute<{ w: string; b: string; provider: string }>(async ({ req, params, access, requestId }) => {
  assertCan(access, "integrations.manage");
  if (!hasFeature(access.entitlements, "commerce")) throw new AppError("plan_required", "Mağaza entegrasyonları Commerce ve üzeri paketlerde", { requiredPlan: "commerce" });
  const adapter = getCommerceAdapters()[params.provider];
  if (!adapter) throw new AppError("not_found", "Sağlayıcı bulunamadı");
  const av = adapter.availability();
  if (av.state !== "available") throw new AppError("unsupported", av.reason ?? "Bu bağlantı henüz kullanılamıyor", { alternative: "csv_import" });
  const input = await readJson(req, body);
  if (params.provider === "shopify") {
    const { authUrl } = await startShopifyConnect(db, access, input.shopDomain, access.principal.userId ?? "");
    return json({ authUrl }, { requestId });
  }
  throw new AppError("unsupported", "Bu sağlayıcı için canlı bağlantı henüz yok. CSV/feed importu kullanın.", { alternative: "csv_import" });
});
