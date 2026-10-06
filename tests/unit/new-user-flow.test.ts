import { describe, expect, it } from "vitest";
import { nextStep } from "@/lib/view-models";
import { catalogGroupCategories } from "@/modules/prompts/picker";
import { purposeTemplates } from "@/modules/prompts/quality";

const base = { productCount: 5, pendingCandidates: 0, promptCount: 8, hasRun: true, continuing: null, topOpportunity: null };

describe("yeni kullanıcı akışı", () => {
  it("yarım kalan ölçüm varsa sıradaki adım onu sürdürmek; fırsat yokken anılmayan sorular gösterilir", () => {
    expect(nextStep({ ...base, runInProgress: { href: "/runs/r1" } })).toMatchObject({ title: "Yarım kalan ölçümü sürdürün", href: "/runs/r1" });
    expect(nextStep({ ...base, missedCount: 3 })).toMatchObject({ title: "Markanızın anılmadığı 3 soruyu inceleyin", href: "/opportunities" });
    expect(nextStep(base).title).toBe("Yeni ölçüm başlatın");
  });

  it("taramada bulunan kategoriler soru grubu olur (en az 2 ürün, ürün sayısına göre)", () => {
    const catalog = [{ categories: ["Çarşaflar"] }, { categories: ["Çarşaflar", "Nevresim"] }, { categories: ["Termos"] }, { categories: ["Nevresim"] }, { categories: ["Nevresim"] }];
    expect(catalogGroupCategories(catalog)).toEqual(["Nevresim", "Çarşaflar"]);
  });

  it("soru önerilerinde tamlama tekil: “yemek takımı markaları”", () => {
    const t = purposeTemplates("Yemek Takımları", "TR").map((x) => x.text);
    expect(t).toContain("Türkiye'de en iyi yemek takımı markaları hangileri?");
    expect(t).toContain("Yemek takımı türleri arasındaki farklar nelerdir?");
    expect(t.join(" ")).not.toContain("takımları markaları");
  });
});
