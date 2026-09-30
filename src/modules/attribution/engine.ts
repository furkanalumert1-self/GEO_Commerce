/**
 * Attribution (§7.2). Varsayılan: 30 günlük last non-direct observed touch; first-touch ikincil.
 * - Direct, önceki gözlemlenmiş non-direct'i silmez.
 * - Consent yok / eşleşme yok → unattributed; tahminle AI'a yazılmaz.
 * - Order başına model başına tek allocation.
 */
export const LAST_NON_DIRECT = "last_non_direct_30d@1";
export const FIRST_TOUCH = "first_touch_30d@1";
export const WINDOW_DAYS = 30;
export const SESSION_TIMEOUT_MIN = 30;

export type Channel = string; // "ai_organic:chatgpt" | "paid:chatgpt_ads" | "organic_search" | "referral" | "direct" | "unattributed"

const AI_REFERRERS: Array<[RegExp, string]> = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, "chatgpt"],
  [/(^|\.)gemini\.google\.com$|(^|\.)bard\.google\.com$/, "gemini"],
  [/(^|\.)perplexity\.ai$/, "perplexity"],
  [/(^|\.)copilot\.microsoft\.com$/, "copilot"],
  [/(^|\.)claude\.ai$/, "claude"],
];
const AI_UTM_SOURCES: Record<string, string> = {
  chatgpt: "chatgpt",
  "chatgpt.com": "chatgpt",
  openai: "chatgpt",
  gemini: "gemini",
  perplexity: "perplexity",
  copilot: "copilot",
};
const SEARCH = /(^|\.)(google|bing|yandex|duckduckgo)\.[a-z.]+$/;
const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsocial", "display", "ads"]);
const CLICK_IDS = ["gclid", "fbclid", "ttclid", "msclkid", "oai_click_id"];

export interface TouchInput {
  referrerHost?: string | null;
  utm?: { source?: string; medium?: string; campaign?: string } | null;
  clickIds?: string[];
  ownHost?: string;
}

export function classifyChannel(t: TouchInput): Channel {
  const src = t.utm?.source?.toLowerCase();
  const medium = t.utm?.medium?.toLowerCase();
  const paid = (medium && PAID_MEDIUMS.has(medium)) || (t.clickIds ?? []).some((c) => CLICK_IDS.includes(c));
  const aiFromUtm = src ? AI_UTM_SOURCES[src] : undefined;
  const host = t.referrerHost?.toLowerCase().replace(/^www\./, "") ?? null;
  const aiFromRef = host ? AI_REFERRERS.find(([re]) => re.test(host))?.[1] : undefined;
  const ai = aiFromUtm ?? aiFromRef;
  if (ai) return paid ? `paid:${ai}_ads` : `ai_organic:${ai}`;
  if (paid) return `paid:${src ?? "unknown"}`;
  if (src) return `campaign:${src}`;
  if (!host || (t.ownHost && host === t.ownHost.replace(/^www\./, ""))) return "direct";
  if (SEARCH.test(host)) return "organic_search";
  return "referral";
}

export const isAiChannel = (c: Channel) => c.startsWith("ai_organic:") || /^paid:(chatgpt|gemini|perplexity|copilot|claude)_ads$/.test(c);

export interface Touch {
  id: string;
  occurredAt: Date;
  channel: Channel;
  consent: boolean;
}

export interface OrderForAttribution {
  id: string;
  paidAt: Date;
  netMinor: bigint;
  currency: string;
  /** İzinli pseudonymous eşleme ile bulunan touchpoint'ler (cross-device fingerprinting yok). */
  touches: Touch[];
}

export interface AttributionResult {
  orderId: string;
  modelVersion: string;
  touchpointId: string | null;
  channel: Channel;
  windowDays: number;
  netMinor: bigint;
  currency: string;
}

function eligibleTouches(order: OrderForAttribution): Touch[] {
  const start = order.paidAt.getTime() - WINDOW_DAYS * 86_400_000;
  return order.touches
    .filter((t) => t.consent && t.occurredAt.getTime() <= order.paidAt.getTime() && t.occurredAt.getTime() >= start)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

export function attributeLastNonDirect(order: OrderForAttribution): AttributionResult {
  const touches = eligibleTouches(order);
  const nonDirect = touches.filter((t) => t.channel !== "direct");
  const pick = nonDirect[nonDirect.length - 1] ?? null;
  return {
    orderId: order.id,
    modelVersion: LAST_NON_DIRECT,
    touchpointId: pick?.id ?? null,
    channel: pick?.channel ?? (touches.length > 0 ? "direct" : "unattributed"),
    windowDays: WINDOW_DAYS,
    netMinor: order.netMinor,
    currency: order.currency,
  };
}

export function attributeFirstTouch(order: OrderForAttribution): AttributionResult {
  const touches = eligibleTouches(order);
  const pick = touches[0] ?? null;
  return {
    orderId: order.id,
    modelVersion: FIRST_TOUCH,
    touchpointId: pick?.id ?? null,
    channel: pick?.channel ?? "unattributed",
    windowDays: WINDOW_DAYS,
    netMinor: order.netMinor,
    currency: order.currency,
  };
}

/** Assisted: AI touch zincirde var ama allocation başka kanala gitti. Toplama dahil edilmez. */
export function isAiAssisted(order: OrderForAttribution, result: AttributionResult): boolean {
  return !isAiChannel(result.channel) && eligibleTouches(order).some((t) => isAiChannel(t.channel));
}

// ── Net revenue ──

export interface OrderAmounts {
  itemsMinor: bigint; // ürün toplamı (indirim öncesi)
  discountMinor: bigint;
  refundedItemsMinor: bigint;
  status: string;
}

/** Net = indirim sonrası ürün toplamı − ürün iadeleri; vergi/kargo hariç. İptal/tam iade → 0. */
export function netRevenueMinor(o: OrderAmounts): bigint {
  if (o.status === "canceled") return 0n;
  const net = o.itemsMinor - o.discountMinor - o.refundedItemsMinor;
  return net > 0n ? net : 0n;
}

export interface Money {
  minor: bigint;
  currency: string;
}

/** Farklı para birimleri körlemesine toplanmaz: currency başına ayrı toplam. */
export function sumByCurrency(items: Money[]): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const i of items) out[i.currency] = (out[i.currency] ?? 0n) + i.minor;
  return out;
}

export interface FxRate {
  from: string;
  to: string;
  rate: number;
  source: string;
  asOf: string;
  version: string;
}

/** FX isteğe bağlı; kur yoksa null döner (dönüştürülmez), UI currency'leri ayrı gösterir. */
export function convert(m: Money, to: string, rates: FxRate[]): { minor: bigint; rate: FxRate | null } | null {
  if (m.currency === to) return { minor: m.minor, rate: null };
  const r = rates.find((x) => x.from === m.currency && x.to === to);
  if (!r) return null;
  return { minor: BigInt(Math.round(Number(m.minor) * r.rate)), rate: r };
}

/** CVR yalnız ölçülebilen eşleşen session cohort'unda; denominator yoksa null. */
export function conversionRate(orders: number, sessions: number | null): number | null {
  if (!sessions) return null;
  return orders / sessions;
}

export function roas(revenueMinor: bigint | null, spendMinor: bigint | null): number | null {
  if (revenueMinor === null || spendMinor === null || spendMinor === 0n) return null;
  return Number(revenueMinor) / Number(spendMinor);
}

/** 30 dk inactivity ile session sınırı. */
export function isNewSession(lastSeenAt: Date | null, now: Date): boolean {
  return !lastSeenAt || now.getTime() - lastSeenAt.getTime() > SESSION_TIMEOUT_MIN * 60_000;
}
