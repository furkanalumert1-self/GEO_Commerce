import { describe, expect, it } from "vitest";
import { blockingIssues, type ActionContent } from "@/modules/actions/workflow";
import { templateDraft } from "@/modules/actions/generator";

const base: ActionContent = { title: "Başlık", metaDescription: "Meta", bodyBlocks: [], internalLinks: [], faq: [], jsonLd: null, sources: [], changeSummary: "", placeholders: [] };

describe("zorunlu eksik tespiti", () => {
  it("doldurulmamış yer tutucuyu alanıyla bulur", () => {
    const c = { ...base, bodyBlocks: [{ heading: "Ürünler", markdown: "- **Serum** — [FİYAT]" }], faq: [{ q: "Uygun mu?", a: "Evet. [ONAYLI İDDİA EKLEYİN]" }] };
    const issues = blockingIssues(c);
    expect(issues.map((i) => [i.fieldId, i.token])).toEqual([
      ["a-block-0", "[FİYAT]"],
      ["a-faq-0-a", "[ONAYLI İDDİA EKLEYİN]"],
    ]);
  });

  it("[PLACEHOLDER: ...] ve [EKSİK: ...] biçimlerini de engel sayar", () => {
    const c = { ...base, metaDescription: "Keşfedin. [PLACEHOLDER: Doğrulanmış kategori bilgileri]", bodyBlocks: [{ markdown: "- [EKSİK: Ürün ölçüleri]\n- [ikea](https://ikea.com.tr) ve [not] kalabilir" }] };
    expect(blockingIssues(c).map((i) => i.token)).toEqual(["[PLACEHOLDER: Doğrulanmış kategori bilgileri]", "[EKSİK: Ürün ölçüleri]"]);
  });

  it("markdown bağlantısı ve bilgilendirici notlar engel değildir", () => {
    const c = { ...base, bodyBlocks: [{ markdown: "[Serum](https://x.example/serum) ve [ÜRÜN](https://x.example)" }], placeholders: ["İddia için kanıt ekleyin [NOT]"] };
    expect(blockingIssues(c)).toEqual([]);
  });

  it("şablon taslak onaylı iddia yoksa iddia uydurmaz; eksik fiyat zorunlu eksiktir", () => {
    const draft = templateDraft({
      type: "content", language: "tr", brand: { name: "Marka", domain: "marka.example" },
      opportunity: { title: "T", recommendedAction: null, clusterLabel: "Serum", gapType: "intent_content" },
      evidence: [], targetUrl: null, allowedClaims: [],
      catalog: [{ name: "A", url: null, priceMinor: 1000n, currency: "TRY", available: true }, { name: "B", url: null, priceMinor: null, currency: null, available: true }],
    });
    expect(JSON.stringify(draft.faq)).not.toContain("İDDİA");
    expect(blockingIssues(draft).map((i) => i.token)).toEqual(["[FİYAT]"]);
  });
});
