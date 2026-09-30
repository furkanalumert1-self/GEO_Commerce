import { describe, expect, it } from "vitest";
import { classifyIntentType, dedupePrompts, normalizePrompt, scoreCommercialIntent, validateRubric } from "@/modules/prompts/intent";
import { canMarkWon, canTransitionOpportunity, evidenceStrength, lostRevenueScenario, opportunityDedupeKey, opportunityScore, visibilityGap } from "@/modules/opportunities/scoring";

describe("prompt normalize/dedupe", () => {
  it("Türkçe büyük/küçük harf ve noktalama normalize", () => {
    expect(normalizePrompt("  İYİ  Nemlendirici?  ")).toBe("iyi nemlendirici");
  });
  it("exact ve benzer tekrarları eler", () => {
    const r = dedupePrompts([{ text: "Hassas cilt için en iyi nemlendirici?" }, { text: "hassas cilt için en iyi nemlendirici" }, { text: "Kuru cilt serum önerisi" }]);
    expect(r.kept).toHaveLength(2);
    expect(r.duplicates[0]?.reason).toBe("exact");
  });
});

describe("Commercial Intent", () => {
  it("0–100 sınırında kalır ve bileşen sınırlarına uyar", () => {
    const samples = ["nedir", "500 TL altı en iyi vegan parfümsüz SPF 50 güneş kremi öner, X vs Y karşılaştır alternatif", ""];
    for (const s of samples) {
      const r = scoreCommercialIntent(s, ["güneş kremi", "spf", "vegan"]);
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBeLessThanOrEqual(100);
      expect(r.purchase).toBeLessThanOrEqual(40);
      expect(r.specificity).toBeLessThanOrEqual(25);
      expect(r.constraints).toBeLessThanOrEqual(20);
      expect(r.comparison).toBeLessThanOrEqual(15);
    }
  });
  it("bilgi sorusu satın alma sorusundan düşük", () => {
    expect(scoreCommercialIntent("hyaluronik asit nedir").total).toBeLessThan(scoreCommercialIntent("hassas cilt için en iyi nemlendirici öner").total);
  });
  it("override sınırlara clamp edilir", () => {
    expect(validateRubric({ purchase: 99, specificity: -5, constraints: 20, comparison: 15 }).total).toBe(75);
  });
  it("intent tipi sınıflandırma", () => {
    expect(classifyIntentType("X yerine ne kullanabilirim")).toBe("alternative");
    expect(classifyIntentType("A vs B hangisi")).toBe("comparison");
  });
});

describe("Opportunity Score", () => {
  const comp = (v: Partial<Record<string, number | null>>) => ({
    intent: { value: v.intent ?? 80, rationale: "" },
    visibilityGap: { value: v.visibilityGap === undefined ? 60 : v.visibilityGap, rationale: "" },
    catalogFit: { value: v.catalogFit ?? 100, rationale: "" },
    evidenceStrength: { value: v.evidenceStrength === undefined ? 50 : v.evidenceStrength, rationale: "" },
    actionability: { value: v.actionability ?? 70, rationale: "" },
  });
  it("ağırlıklı toplam", () => {
    expect(opportunityScore(comp({})).score).toBe(Math.round(0.3 * 80 + 0.25 * 60 + 0.2 * 100 + 0.15 * 50 + 0.1 * 70));
  });
  it("sınırlar 0–100", () => {
    expect(opportunityScore(comp({ intent: 500, visibilityGap: 500, catalogFit: 500, evidenceStrength: 500, actionability: 500 })).score).toBe(100);
    expect(opportunityScore(comp({ intent: -5, visibilityGap: 0, catalogFit: 0, evidenceStrength: 0, actionability: 0 })).score).toBe(0);
  });
  it("zorunlu bileşen eksikse no-score/provisional", () => {
    const r = opportunityScore(comp({ visibilityGap: null }));
    expect(r.score).toBeNull();
    expect(r.provisional).toBe(true);
  });
  it("opsiyonel bileşen eksikse provisional skor", () => {
    const r = opportunityScore(comp({ evidenceStrength: null }));
    expect(r.score).not.toBeNull();
    expect(r.provisional).toBe(true);
  });
  it("gap = max(0, best competitor − brand) × 100", () => {
    expect(visibilityGap(0.2, [0.5, 0.3])).toBe(30);
    expect(visibilityGap(0.8, [0.5])).toBe(0);
    expect(visibilityGap(null, [0.5])).toBeNull();
  });
  it("evidence başarılı tekrar yoksa null", () => {
    expect(evidenceStrength({ successfulRepeats: 0, distinctSources: 3, newestAgeDays: 1 })).toBeNull();
  });
  it("dedupe anahtarı deterministik", () => {
    expect(opportunityDedupeKey("c", "tr-TR", "citation_gap")).toBe(opportunityDedupeKey("c", "tr-TR", "citation_gap"));
  });
  it("durum makinesi ve yeniden açma", () => {
    expect(canTransitionOpportunity("new", "won")).toBe(false);
    expect(canTransitionOpportunity("dismissed", "new")).toBe(true);
  });
  it("won eşik+örneklem veya insan onayı", () => {
    expect(canMarkWon({ humanApproved: false, pointDelta: 12, sampleCount: 10 })).toBe(false);
    expect(canMarkWon({ humanApproved: false, pointDelta: 12, sampleCount: 30 })).toBe(true);
    expect(canMarkWon({ humanApproved: true, pointDelta: null, sampleCount: 0 })).toBe(true);
  });
  it("kayıp gelir girdisiz gizli", () => {
    expect(lostRevenueScenario({ monthlyTraffic: null, aiShareLow: 0.01, aiShareHigh: 0.05, cvr: 0.02, aovMinor: 50000, visibilityGap: 30 })).toBeNull();
  });
});
