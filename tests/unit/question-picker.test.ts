import { describe, expect, it } from "vitest";
import { buildPickerGroups } from "@/modules/prompts/picker";

const v = (text: string) => [{ text }];

describe("ürün grubu → soru seçimi verisi", () => {
  const clusters = [
    { id: "c1", label: "Bebek Yatağı", category: "Bebek Yatağı", prompts: [
      { id: "p1", active: true, archivedAt: null, versions: v("Türkiye'de en iyi bebek yatağı markaları hangileri?") },
      { id: "p2", active: false, archivedAt: new Date(), versions: v("Ucuz bebek yatağı nereden alınır?") },
    ] },
    { id: "c2", label: "Yastık", category: "Yastık", prompts: [] },
  ];
  const groups = buildPickerGroups(clusters, ["Yastık", "Nevresim Takımı"], "TR");

  it("takipteki ve arşivdeki sorular kendi kimlikleriyle ayrılır", () => {
    const g = groups.find((x) => x.key === "c1")!;
    expect(g.tracked).toEqual([{ id: "p1", text: "Türkiye'de en iyi bebek yatağı markaları hangileri?" }]);
    expect(g.archived.map((q) => q.id)).toEqual(["p2"]);
  });

  it("öneriler yalnız grubun ürünüyle ilgilidir ve mevcut sorular tekrar önerilmez", () => {
    const g = groups.find((x) => x.key === "c1")!;
    expect(g.suggested.length).toBeGreaterThan(0);
    expect(g.suggested.every((q) => q.id === null && /bebek yatağı/i.test(q.text))).toBe(true);
    expect(g.suggested.some((q) => q.text === g.tracked[0]!.text)).toBe(false);
    expect(groups.find((x) => x.key === "c2")!.suggested.every((q) => /yastık/i.test(q.text) && !/bebek/i.test(q.text))).toBe(true);
  });

  it("soru grubu olmayan ürün kategorisi seçilebilir grup olur; mevcut grupla çakışan eklenmez", () => {
    expect(groups.filter((g) => g.label === "Yastık")).toHaveLength(1);
    const nev = groups.find((g) => g.label === "Nevresim Takımı")!;
    expect(nev.clusterId).toBeNull();
    expect(nev.category).toBe("Nevresim Takımı");
  });
});
