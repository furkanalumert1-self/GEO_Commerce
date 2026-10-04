import type { PrismaClient } from "@/generated/prisma/client";
import { hasFeature, type Entitlements } from "@/modules/billing/plans";

/**
 * Gelir ölçümünün bu markadaki kullanılabilirliği:
 * - not_in_plan: paket gelir ölçümünü içermiyor
 * - inactive: paket içeriyor ama sipariş kaynağı yok (mağaza bağlantısı veya sipariş dosyası)
 * - active: sipariş verisi okunuyor (dönemde sipariş olmasa da; o durumda gerçek 0 gösterilir)
 * - error: kaynak var ama son eşitleme sorunlu; son başarılı veriler korunur
 * Yalnız ürün dosyası yüklemek gelir ölçümünü etkin saymaz (csv bağlantısı sipariş yoksa sayılmaz).
 */
export type RevenueState = "not_in_plan" | "inactive" | "active" | "error";

export interface RevenueAvailability {
  state: RevenueState;
  lastSyncAt: Date | null;
}

const ERROR_STATUSES = new Set(["degraded", "reauth_required"]);

export function revenueStateFrom(input: { inPlan: boolean; orderCount: number; integrations: Array<{ provider: string; status: string; lastSyncAt: Date | null; ordersRead: boolean }> }): RevenueAvailability {
  if (!input.inPlan) return { state: "not_in_plan", lastSyncAt: null };
  const sources = input.integrations.filter((i) => i.ordersRead && (i.provider !== "csv_feed" || input.orderCount > 0));
  const lastSyncAt = sources.reduce<Date | null>((a, i) => (i.lastSyncAt && (!a || i.lastSyncAt > a) ? i.lastSyncAt : a), null);
  const live = sources.filter((i) => i.provider !== "csv_feed");
  if (live.some((i) => ERROR_STATUSES.has(i.status))) return { state: "error", lastSyncAt };
  if (input.orderCount > 0 || live.some((i) => i.status === "healthy" || i.status === "syncing")) return { state: "active", lastSyncAt };
  return { state: "inactive", lastSyncAt: null };
}

export async function revenueAvailability(db: PrismaClient, ids: { workspaceId: string; brandId: string }, entitlements: Entitlements): Promise<RevenueAvailability> {
  if (!hasFeature(entitlements, "revenue")) return { state: "not_in_plan", lastSyncAt: null };
  const [orderCount, integrations] = await Promise.all([
    db.order.count({ where: { workspaceId: ids.workspaceId, brandId: ids.brandId } }),
    db.integration.findMany({ where: { workspaceId: ids.workspaceId, brandId: ids.brandId }, select: { provider: true, status: true, lastSyncAt: true, capabilities: true } }),
  ]);
  return revenueStateFrom({
    inPlan: true,
    orderCount,
    integrations: integrations.map((i) => ({ provider: i.provider, status: i.status, lastSyncAt: i.lastSyncAt, ordersRead: (i.capabilities as { ordersRead?: boolean } | null)?.ordersRead === true })),
  });
}

/** Gelir menüde/panoda/raporda gösterilir mi: yalnız gerçekten ölçülüyorsa (etkin veya geçici hata). */
export const revenueVisible = (a: RevenueAvailability) => a.state === "active" || a.state === "error";
