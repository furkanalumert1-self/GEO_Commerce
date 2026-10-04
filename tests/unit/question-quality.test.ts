import { describe, expect, it } from "vitest";
import { catalogMatchCount, classifyPurpose, purposeTemplates, questionQuality } from "@/modules/prompts/quality";
import { buildPickerGroups } from "@/modules/prompts/picker";

describe("soru kalitesi", () => {
  it("şablonlar tek amaçlıdır; iki amacı birleştiren kalıp yok", () => {
    const t = purposeTemplates("Visco yastık", "TR");
    expect(t).toHaveLength(5);
    expect(t.map((x) => x.text).join(" ")).not.toMatch(/,\s*hangi (modelleri|markaları)/);
    expect(new Set(t.map((x) => x.purpose)).size).toBeGreaterThanOrEqual(4);
  });
  it("belirsiz ürün türleri düzenleme ister: bebek yatağı, yastık, katlanır koltuk", () => {
    const ctx = { group: "g", catalogTerms: [], catalogMatches: null };
    expect(questionQuality("Uygun fiyatlı ve kaliteli bebek yatağı nereden alabilirim?", ctx)).toMatchObject({ status: "edit", suggestion: expect.stringMatching(/bebek şiltesi/) });
    expect(questionQuality("Küçük ev için yastık önerir misin?", ctx).status).toBe("edit");
    expect(questionQuality("Yan yatanlar için uyku yastığı seçerken nelere dikkat etmeli?", ctx).status).toBe("ok");
    expect(questionQuality("Katlanır koltuk modelleri hangileri?", ctx).status).toBe("edit");
    expect(questionQuality("Ev içi misafir için yataklı katlanır koltuk önerir misin?", ctx).status).toBe("ok");
  });
  it("katalogda grup yoksa önerilmez; katalog yoksa doğrulanmadı denir (varmış gibi değil)", () => {
    expect(questionQuality("Türkiye'de en iyi şilte markaları hangileri?", { group: "Şilte", catalogTerms: ["Yastık"], catalogMatches: 0 }).status).toBe("edit");
    expect(questionQuality("Türkiye'de en iyi şilte markaları hangileri?", { group: "Şilte", catalogTerms: [], catalogMatches: null }).reason).toMatch(/doğrulanmadı/);
    expect(catalogMatchCount("Bebek Şiltesi", [{ name: "Bebek Şiltesi 70x110", categories: [] }, { name: "Visco Yastık", categories: ["Yastık"] }])).toBe(1);
    expect(catalogMatchCount("Yastık", [])).toBeNull();
  });
  it("amaç sınıflandırması", () => {
    expect(classifyPurpose("Visco ve lateks yastık arasındaki farklar nelerdir?")).toBe("comparison");
    expect(classifyPurpose("Kaliteli şilte nereden alabilirim?")).toBe("purchase");
    expect(classifyPurpose("Yan yatan biri yastık seçerken nelere dikkat etmeli?")).toBe("need_based");
  });
});

describe("seçim listesinde aktif + arşiv aynı soru", () => {
  it("aktif eşdeğeri olan arşiv sorusu tekrar sunulmaz", () => {
    const v = (text: string) => [{ text }];
    const g = buildPickerGroups([{ id: "c1", label: "Bebek Yatağı", category: "Bebek Yatağı", prompts: [
      { id: "p1", active: true, archivedAt: null, versions: v("Bebek yatağı alırken nelere dikkat etmeliyim?") },
      { id: "p2", active: false, archivedAt: new Date(), versions: v("Bebek yatağı alırken nelere dikkat etmeliyim?") },
      { id: "p3", active: false, archivedAt: new Date(), versions: v("Ucuz bebek yatağı nereden alınır?") },
    ] }], [], "TR")[0]!;
    expect(g.archived.map((q) => q.id)).toEqual(["p3"]);
    // Bebek yatağı belirsiz: öneriler varsayılan listede değil, "Düzenleme gerekli" grubunda
    expect(g.suggested).toHaveLength(0);
    expect(g.needsEdit.length).toBeGreaterThan(0);
  });
});
