import { describe, expect, it } from "vitest";
import { allowedEngines, hasFeature, PLANS, resolveEntitlements } from "@/modules/billing/plans";
import { estimate } from "@/modules/monitoring/planner";
import { ordersFromCsv, parseCsv, parseMoneyMinor } from "@/adapters/commerce/csv";
import { normalizeShopifyOrder, verifyShopifyHmac } from "@/adapters/commerce";
import { createHmac } from "node:crypto";

describe("entitlements", () => {
  it("sabit fiyatlar", () => {
    expect([PLANS.starter, PLANS.growth, PLANS.commerce, PLANS.agency].map((p) => p.monthlyPriceUsdCents)).toEqual([7900, 19900, 49900, 99900]);
    expect(PLANS.enterprise.monthlyPriceUsdCents).toBeNull();
  });
  it("Starter Fix with AI yok (server gate kaynağı)", () => {
    expect(hasFeature(resolveEntitlements({ planKey: "starter", status: "active" }), "fix_with_ai")).toBe(false);
    expect(hasFeature(resolveEntitlements({ planKey: "growth", status: "active" }), "fix_with_ai")).toBe(true);
  });
  it("trial limitleri", () => {
    const e = resolveEntitlements({ planKey: "starter", status: "trialing" });
    expect([e.answerUnits, e.activePrompts, e.brands, e.trial]).toEqual([100, 10, 1, true]);
  });
  it("past_due 7 gün grace sonra ücretli job durur", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    expect(resolveEntitlements({ planKey: "growth", status: "past_due", pastDueSince: new Date("2026-09-27T00:00:00Z") }, now).canRunPaidJobs).toBe(true);
    expect(resolveEntitlements({ planKey: "growth", status: "past_due", pastDueSince: new Date("2026-09-20T00:00:00Z") }, now).canRunPaidJobs).toBe(false);
  });
  it("süresi dolan enterprise override uygulanmaz", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    const e = resolveEntitlements({ planKey: "enterprise", status: "active", overrideLimits: { answerUnits: 50000 }, overrideExpiresAt: new Date("2026-09-01T00:00:00Z") }, now);
    expect(e.answerUnits).toBe(10000);
  });
  it("motor kısıtı", () => {
    expect(allowedEngines(resolveEntitlements({ planKey: "starter", status: "active" }), ["chatgpt", "gemini", "perplexity"])).toEqual(["chatgpt", "gemini"]);
  });
});

describe("planlayıcı", () => {
  it("kota yetmezse cohort döndürerek örnekler", () => {
    const ids = ["a", "b", "c", "d"];
    const e1 = estimate({ promptIds: ids, engines: ["x", "y"], locales: ["tr"], repetitions: 1, runsPerPeriod: 1, availableUnits: 4 });
    expect(e1.fits).toBe(false);
    expect(e1.selectedPromptIds).toEqual(["a", "b"]);
    const e2 = estimate({ promptIds: ids, engines: ["x", "y"], locales: ["tr"], repetitions: 1, runsPerPeriod: 1, availableUnits: 4, cohortCursor: e1.nextCursor });
    expect(e2.selectedPromptIds).toEqual(["c", "d"]);
  });
  it("tahmin prompts × engines × locales × reps × runs", () => {
    expect(estimate({ promptIds: ["a", "b"], engines: ["x", "y"], locales: ["tr", "en"], repetitions: 3, runsPerPeriod: 4, availableUnits: 1e6 }).unitsPerPeriod).toBe(2 * 2 * 2 * 3 * 4);
  });
});

describe("CSV / commerce contract", () => {
  it("tırnaklı CSV", () => {
    expect(parseCsv('a,b\n"x, y","z ""q"""\n')).toEqual([["a", "b"], ["x, y", 'z "q"']]);
  });
  it("para ayrıştırma; geçersiz → null", () => {
    expect(parseMoneyMinor("129,90")).toBe(12990n);
    expect(parseMoneyMinor("1.299,90")).toBe(129990n);
    expect(parseMoneyMinor("abc")).toBeNull();
  });
  it("sipariş + iade importu tekrar satırlarını birleştirir", () => {
    const csv = "order,cur,price,qty,refund_id,refund\nA1,try,100,1,R1,40\nA1,try,50,2,R1,40\n";
    const o = ordersFromCsv(csv, { orderId: "order", currency: "cur", unitPrice: "price", quantity: "qty", refundId: "refund_id", refundAmount: "refund" });
    expect(o).toHaveLength(1);
    expect(o[0]!.items).toHaveLength(2);
    expect(o[0]!.refunds).toHaveLength(1);
  });
  it("Shopify HMAC doğrulama", () => {
    const raw = '{"id":1}';
    const sig = createHmac("sha256", "sec").update(raw).digest("base64");
    expect(verifyShopifyHmac(raw, sig, "sec")).toBe(true);
    expect(verifyShopifyHmac(raw, sig, "other")).toBe(false);
    expect(verifyShopifyHmac(raw, undefined, "sec")).toBe(false);
  });
  it("Shopify order fixture normalize", () => {
    const o = normalizeShopifyOrder({ id: 5, financial_status: "partially_refunded", currency: "TRY", processed_at: "2026-09-01T10:00:00Z", line_items: [{ product_id: 1, variant_id: 2, title: "Serum", quantity: 2, price: "249.90", total_discount: "0.00" }], refunds: [{ id: 9, created_at: "2026-09-03T10:00:00Z", refund_line_items: [{ subtotal: "249.90" }] }], total_tax: "45.00" });
    expect(o?.status).toBe("partially_refunded");
    expect(o?.items[0]?.unitPriceMinor).toBe(24990n);
    expect(o?.refunds[0]?.amountMinor).toBe(24990n);
  });
});
