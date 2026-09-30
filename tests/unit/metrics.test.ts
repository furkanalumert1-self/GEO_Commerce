import { describe, expect, it } from "vitest";
import { aggregateScore, compareScores, coverage, isSignificantDrop, shareOfVoice, visibilityScore, type ScoredObservation } from "@/modules/monitoring/metrics";

const obs = (p: Partial<ScoredObservation>): ScoredObservation => ({
  engine: "chatgpt", surface: "api_grounded", valid: true, weight: 1, mentioned: false, recommended: false, ownCitation: false, supportsCitations: true, ...p,
});

describe("AI Visibility Score", () => {
  it("formülü uygular: round(100*(.5M+.3R+.2C))", () => {
    const list = [obs({ mentioned: true, recommended: true, ownCitation: true }), obs({ mentioned: true }), obs({}), obs({})];
    const s = visibilityScore(list, 4);
    expect(s.M).toBe(0.5);
    expect(s.R).toBe(0.25);
    expect(s.C).toBe(0.25);
    expect(s.score).toBe(Math.round(100 * (0.5 * 0.5 + 0.3 * 0.25 + 0.2 * 0.25)));
  });

  it("Σw=0 → null (sıfır değil)", () => {
    const s = visibilityScore([obs({ weight: 0, mentioned: true })], 1);
    expect(s.score).toBeNull();
    expect(s.M).toBeNull();
  });

  it("geçersiz gözlemler formüle girmez ve düşüş sayılmaz", () => {
    const s = visibilityScore([obs({ mentioned: true }), obs({ valid: false })], 2);
    expect(s.M).toBe(1);
    expect(s.coverage).toBe(0.5);
  });

  it("ağırlıkları uygular", () => {
    const s = visibilityScore([obs({ weight: 3, mentioned: true }), obs({ weight: 1 })], 2);
    expect(s.M).toBe(0.75);
  });

  it("citation desteklemeyen surface ayrı profile ve M/R normalize", () => {
    const s = visibilityScore([obs({ supportsCitations: false, mentioned: true, recommended: true })], 1);
    expect(s.profile).toBe("no_citations");
    expect(s.C).toBeNull();
    expect(s.score).toBe(100);
  });

  it("20'den az gözlem küçük örneklem etiketi alır", () => {
    expect(visibilityScore(Array.from({ length: 10 }, () => obs({})), 10).smallSample).toBe(true);
    expect(visibilityScore(Array.from({ length: 20 }, () => obs({})), 20).smallSample).toBe(false);
  });

  it("coverage scheduled=0 → null", () => {
    expect(coverage(0, 0)).toBeNull();
  });
});

describe("aggregateScore", () => {
  const e = (engine: string, score: number | null, cov: number, profile: "with_citations" | "no_citations" = "with_citations") => ({
    engine, profile, M: 0, R: 0, C: 0, score, validObservations: 30, scheduledObservations: 30, coverage: cov, smallSample: false,
  });

  it("motor başına eşit ağırlık", () => {
    expect(aggregateScore([e("a", 40, 1), e("b", 60, 0.9)]).score).toBe(50);
  });

  it("coverage < %80 motor dışarıda, kısmi etiket", () => {
    const r = aggregateScore([e("a", 40, 1), e("b", 90, 0.5)]);
    expect(r.score).toBe(40);
    expect(r.partial).toBe(true);
    expect(r.missingEngines).toEqual(["b"]);
  });

  it("farklı profiller tek toplamda birleştirilmez", () => {
    const r = aggregateScore([e("a", 40, 1), e("b", 60, 1, "no_citations")]);
    expect(r.score).toBeNull();
    expect(r.profile).toBe("mixed");
  });
});

describe("SOV", () => {
  it("yanıt başına marka başına bir mention sayar", () => {
    const sov = shareOfVoice(
      [
        { valid: true, weight: 1, mentionedEntityIds: ["a", "a", "b"] },
        { valid: true, weight: 1, mentionedEntityIds: ["a"] },
      ],
      ["a", "b"],
    );
    expect(sov.a).toBeCloseTo((2 / 3) * 100);
    expect(sov.b).toBeCloseTo((1 / 3) * 100);
  });

  it("denominator=0 → null", () => {
    const sov = shareOfVoice([{ valid: true, weight: 1, mentionedEntityIds: [] }], ["a"]);
    expect(sov.a).toBeNull();
  });
});

describe("karşılaştırma ve düşüş", () => {
  it("farklı cohort karşılaştırılamaz; puan ve yüzde ayrı", () => {
    expect(compareScores({ score: 50, cohortHash: "x" }, { score: 40, cohortHash: "y" }).comparable).toBe(false);
    const c = compareScores({ score: 50, cohortHash: "x" }, { score: 40, cohortHash: "x" });
    expect(c.pointDelta).toBe(10);
    expect(c.percentDelta).toBe(25);
  });

  it("anlamlı düşüş: iki run, aynı cohort, min 20 örnek, ≥10 puan", () => {
    const base = { score: 60, cohortHash: "c" };
    expect(isSignificantDrop([{ score: 45, cohortHash: "c", sampleCount: 30 }, { score: 48, cohortHash: "c", sampleCount: 30 }], base)).toBe(true);
    expect(isSignificantDrop([{ score: 45, cohortHash: "c", sampleCount: 30 }], base)).toBe(false);
    expect(isSignificantDrop([{ score: 45, cohortHash: "c", sampleCount: 10 }, { score: 45, cohortHash: "c", sampleCount: 30 }], base)).toBe(false);
  });
});
