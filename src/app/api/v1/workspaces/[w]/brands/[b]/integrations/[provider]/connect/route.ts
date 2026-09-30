import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { hasFeature } from "@/modules/billing/plans";
import { getCommerceAdapters } from "@/adapters/commerce";

const body = z.object({ shopDomain: z.string().trim().min(3).max(253) });

/** Bağlantı başlatma: adapter erişilebilir değilse 422 + açık neden; sahte "connected" yok. */
export const POST = brandRoute<{ w: string; b: string; provider: string }>(async ({ req, params, access, requestId }) => {
  assertCan(access, "integrations.manage");
  if (!hasFeature(access.entitlements, "commerce")) throw new AppError("plan_required", "Mağaza entegrasyonları Commerce ve üzeri paketlerde", { requiredPlan: "commerce" });
  const adapter = getCommerceAdapters()[params.provider];
  if (!adapter) throw new AppError("not_found", "Sağlayıcı bulunamadı");
  const av = adapter.availability();
  if (av.state !== "available") throw new AppError("unsupported", av.reason ?? "Bu bağlantı henüz kullanılamıyor", { alternative: "csv_import" });
  await readJson(req, body);
  throw new AppError("unsupported", "Canlı OAuth bağlantısı partner mağaza acceptance testi tamamlanınca açılacak. Şimdilik CSV/feed importu kullanın.", { alternative: "csv_import" });
});
