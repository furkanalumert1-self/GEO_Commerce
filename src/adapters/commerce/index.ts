import { createHmac } from "node:crypto";
import { config, type AppConfig } from "@/lib/config";
import { safeEqual } from "@/lib/crypto";
import { ConnectorUnavailableError, type CommerceAdapter, type CommerceCapability, type NormalizedOrder } from "./types";
import { csvFeedAdapter } from "./csv";

/**
 * Platform adapter'ları. Shopify ilk referans; ikas/Ticimax/IdeaSoft resmi doküman + partner hesabı ile
 * doğrulanana kadar "unsupported/not_configured" döner ve uydurma endpoint çağırmaz.
 * Ayrıntı ve engeller: docs/provider-capabilities.md
 */

function unavailable(provider: string, label: string, caps: CommerceCapability[], reason: string, state: "not_configured" | "unsupported"): CommerceAdapter {
  const fail = async (): Promise<never> => {
    throw new ConnectorUnavailableError(provider, reason);
  };
  return {
    provider,
    label,
    capabilities: () => caps,
    availability: () => ({ state, reason }),
    connect: fail,
    validate: async () => ({ ok: false, reason }),
    syncCatalog: fail,
    syncOrders: fail,
    verifyWebhook: () => false,
    normalizeEvent: () => null,
    publishPatch: fail,
    rollback: fail,
    disconnect: async () => undefined,
  };
}

/** Shopify webhook imzası: X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256(raw body, app secret)). */
export function verifyShopifyHmac(raw: string, headerValue: string | undefined, secret: string): boolean {
  if (!headerValue) return false;
  const digest = createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  return safeEqual(digest, headerValue);
}

export function toMinor(amount: unknown): bigint {
  const s = String(amount ?? "0");
  const [i, f = ""] = s.split(".");
  return BigInt(i || "0") * 100n + BigInt((f + "00").slice(0, 2)) * (s.startsWith("-") ? -1n : 1n);
}

/** Shopify order webhook payload → normalize (contract fixture ile test edilir). */
export function normalizeShopifyOrder(p: Record<string, unknown>): NormalizedOrder | null {
  if (!p || p.id === undefined) return null;
  const refunds = ((p.refunds as Array<Record<string, unknown>>) ?? []).map((r) => ({
    externalId: String(r.id),
    amountMinor: ((r.refund_line_items as Array<Record<string, unknown>>) ?? []).reduce((s, li) => s + toMinor(li.subtotal), 0n),
    refundedAt: new Date(String(r.created_at)),
  }));
  const fin = String(p.financial_status ?? "pending");
  const status: NormalizedOrder["status"] = p.cancelled_at
    ? "canceled"
    : fin === "refunded"
      ? "refunded"
      : fin === "partially_refunded"
        ? "partially_refunded"
        : fin === "paid"
          ? "paid"
          : "pending";
  return {
    externalOrderId: String(p.id),
    status,
    paidAt: p.processed_at ? new Date(String(p.processed_at)) : null,
    currency: String(p.currency ?? "USD"),
    items: ((p.line_items as Array<Record<string, unknown>>) ?? []).map((li) => ({
      productExternalId: li.product_id ? String(li.product_id) : null,
      variantExternalId: li.variant_id ? String(li.variant_id) : null,
      name: li.title ? String(li.title) : null,
      quantity: Number(li.quantity ?? 1),
      unitPriceMinor: toMinor(li.price),
      discountMinor: toMinor(li.total_discount),
    })),
    discountMinor: 0n, // satır bazlı indirim items içinde
    taxMinor: toMinor(p.total_tax),
    shippingMinor: toMinor((p.total_shipping_price_set as Record<string, Record<string, unknown>> | undefined)?.shop_money?.amount),
    refunds,
    anonymousId: null,
    sessionRef: typeof p.cart_token === "string" ? p.cart_token : null,
    updatedAt: new Date(String(p.updated_at ?? p.created_at ?? Date.now())),
  };
}

function shopifyAdapter(cfg: AppConfig): CommerceAdapter {
  // İçerik yazma (contentWrite) bu sürümde istenmez/iddia edilmez; yayın export + manuel bildirimle.
  const caps: CommerceCapability[] = ["catalogRead", "ordersRead", "refundsRead", "oauth"];
  if (!cfg.SHOPIFY_CLIENT_ID || !cfg.SHOPIFY_CLIENT_SECRET) {
    return unavailable("shopify", "Shopify", caps, "SHOPIFY_CLIENT_ID/SECRET yapılandırılmamış", "not_configured");
  }
  const base = unavailable("shopify", "Shopify", caps, "Shopify bağlantısı OAuth ile kurulur", "not_configured");
  return {
    ...base,
    availability: () => ({ state: "available", reason: "OAuth ile bağlanır; yalnız okuma izni (ürün, stok, sipariş). Bağlı durumu gerçek API kontrolünden sonra gösterilir. İçerik yayınlama desteklenmez." }),
    verifyWebhook: (raw, headers, secret) => verifyShopifyHmac(raw, headers["x-shopify-hmac-sha256"], secret),
    normalizeEvent: (payload) => normalizeShopifyOrder(payload as Record<string, unknown>),
  };
}

export function getCommerceAdapters(cfg: AppConfig = config()): Record<string, CommerceAdapter> {
  return {
    shopify: shopifyAdapter(cfg),
    ikas: unavailable("ikas", "ikas", ["catalogRead", "ordersRead"], cfg.IKAS_APP_CLIENT_ID ? "ikas resmi API erişimi ve partner mağaza testi bekleniyor" : "IKAS_APP_CLIENT_ID/SECRET yapılandırılmamış", cfg.IKAS_APP_CLIENT_ID ? "unsupported" : "not_configured"),
    ticimax: unavailable("ticimax", "Ticimax", ["catalogRead", "ordersRead"], cfg.TICIMAX_APP_CLIENT_ID ? "Ticimax resmi API erişimi ve partner mağaza testi bekleniyor" : "TICIMAX_APP_CLIENT_ID/SECRET yapılandırılmamış", cfg.TICIMAX_APP_CLIENT_ID ? "unsupported" : "not_configured"),
    ideasoft: unavailable("ideasoft", "IdeaSoft", ["catalogRead", "ordersRead"], cfg.IDEASOFT_APP_CLIENT_ID ? "IdeaSoft resmi API erişimi ve partner mağaza testi bekleniyor" : "IDEASOFT_APP_CLIENT_ID/SECRET yapılandırılmamış", cfg.IDEASOFT_APP_CLIENT_ID ? "unsupported" : "not_configured"),
    csv_feed: csvFeedAdapter,
  };
}
