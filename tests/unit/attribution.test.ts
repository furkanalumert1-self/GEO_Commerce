import { describe, expect, it } from "vitest";
import { attributeFirstTouch, attributeLastNonDirect, classifyChannel, convert, conversionRate, isAiAssisted, isNewSession, netRevenueMinor, roas, sumByCurrency, type OrderForAttribution } from "@/modules/attribution/engine";

const d = (s: string) => new Date(s);
const order = (touches: OrderForAttribution["touches"]): OrderForAttribution => ({ id: "o1", paidAt: d("2026-09-20T12:00:00Z"), netMinor: 10000n, currency: "TRY", touches });

describe("kanal sınıflandırma", () => {
  it("AI referrer ve UTM", () => {
    expect(classifyChannel({ referrerHost: "chatgpt.com" })).toBe("ai_organic:chatgpt");
    expect(classifyChannel({ utm: { source: "perplexity" } })).toBe("ai_organic:perplexity");
    expect(classifyChannel({ utm: { source: "chatgpt", medium: "cpc" } })).toBe("paid:chatgpt_ads");
    expect(classifyChannel({ referrerHost: "www.google.com" })).toBe("organic_search");
    expect(classifyChannel({ referrerHost: null })).toBe("direct");
    expect(classifyChannel({ referrerHost: "shop.example", ownHost: "shop.example" })).toBe("direct");
  });
});

describe("last non-direct 30g", () => {
  it("direct önceki non-direct'i silmez", () => {
    const r = attributeLastNonDirect(order([
      { id: "t1", occurredAt: d("2026-09-10T00:00:00Z"), channel: "ai_organic:chatgpt", consent: true },
      { id: "t2", occurredAt: d("2026-09-19T00:00:00Z"), channel: "direct", consent: true },
    ]));
    expect(r.channel).toBe("ai_organic:chatgpt");
    expect(r.touchpointId).toBe("t1");
  });
  it("pencere dışı dokunuş sayılmaz → unattributed", () => {
    const r = attributeLastNonDirect(order([{ id: "t1", occurredAt: d("2026-08-01T00:00:00Z"), channel: "ai_organic:chatgpt", consent: true }]));
    expect(r.channel).toBe("unattributed");
  });
  it("consent yoksa AI'a yazılmaz", () => {
    const r = attributeLastNonDirect(order([{ id: "t1", occurredAt: d("2026-09-15T00:00:00Z"), channel: "ai_organic:gemini", consent: false }]));
    expect(r.channel).toBe("unattributed");
  });
  it("sipariş sonrası dokunuş sayılmaz", () => {
    const r = attributeLastNonDirect(order([{ id: "t1", occurredAt: d("2026-09-21T00:00:00Z"), channel: "referral", consent: true }]));
    expect(r.channel).toBe("unattributed");
  });
  it("first-touch ikincil görünüm ve assisted ayrı", () => {
    const o = order([
      { id: "t1", occurredAt: d("2026-09-01T00:00:00Z"), channel: "ai_organic:chatgpt", consent: true },
      { id: "t2", occurredAt: d("2026-09-18T00:00:00Z"), channel: "organic_search", consent: true },
    ]);
    expect(attributeFirstTouch(o).channel).toBe("ai_organic:chatgpt");
    const last = attributeLastNonDirect(o);
    expect(last.channel).toBe("organic_search");
    expect(isAiAssisted(o, last)).toBe(true);
  });
});

describe("gelir", () => {
  it("net = ürün − indirim − ürün iadesi; vergi/kargo hariç", () => {
    expect(netRevenueMinor({ itemsMinor: 10000n, discountMinor: 1000n, refundedItemsMinor: 0n, status: "paid" })).toBe(9000n);
  });
  it("kısmi iade", () => {
    expect(netRevenueMinor({ itemsMinor: 10000n, discountMinor: 0n, refundedItemsMinor: 4000n, status: "partially_refunded" })).toBe(6000n);
  });
  it("tam iade ve iptal → 0", () => {
    expect(netRevenueMinor({ itemsMinor: 10000n, discountMinor: 0n, refundedItemsMinor: 10000n, status: "refunded" })).toBe(0n);
    expect(netRevenueMinor({ itemsMinor: 10000n, discountMinor: 0n, refundedItemsMinor: 0n, status: "canceled" })).toBe(0n);
  });
  it("para birimleri körlemesine toplanmaz", () => {
    expect(sumByCurrency([{ minor: 100n, currency: "TRY" }, { minor: 5n, currency: "USD" }, { minor: 50n, currency: "TRY" }])).toEqual({ TRY: 150n, USD: 5n });
  });
  it("FX yoksa dönüştürmez (null)", () => {
    expect(convert({ minor: 100n, currency: "TRY" }, "USD", [])).toBeNull();
    const r = convert({ minor: 1000n, currency: "TRY" }, "USD", [{ from: "TRY", to: "USD", rate: 0.03, source: "test", asOf: "2026-09-01", version: "1" }]);
    expect(r?.minor).toBe(30n);
  });
  it("CVR ve ROAS denominator yoksa null", () => {
    expect(conversionRate(3, null)).toBeNull();
    expect(conversionRate(3, 0)).toBeNull();
    expect(roas(1000n, 0n)).toBeNull();
    expect(roas(3000n, 1000n)).toBe(3);
  });
});

describe("session / timezone", () => {
  it("30 dk inactivity yeni session", () => {
    expect(isNewSession(d("2026-09-20T10:00:00Z"), d("2026-09-20T10:29:00Z"))).toBe(false);
    expect(isNewSession(d("2026-09-20T10:00:00Z"), d("2026-09-20T10:31:00Z"))).toBe(true);
  });
  it("DST geçişinde UTC süre hesabı doğru (Europe/Berlin 2026-10-25)", () => {
    // 01:50 UTC → 02:10 UTC gerçek 20 dk; yerel saat geri alınsa da session devam eder.
    expect(isNewSession(d("2026-10-25T00:50:00Z"), d("2026-10-25T01:10:00Z"))).toBe(false);
  });
});
