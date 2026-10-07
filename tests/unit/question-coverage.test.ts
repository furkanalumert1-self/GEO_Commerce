import { describe, expect, it } from "vitest";
import { menuCategories, preferMenuGroups, type TopicGroup } from "@/modules/audit/business";
import { buildPickerGroups } from "@/modules/prompts/picker";
import { groupAttributes, purposeTemplates, questionPattern } from "@/modules/prompts/quality";

const menu = [
  { url: "https://www.example.com/c-yatak-odasi/nevresim-takimi", text: "Nevresim Takımı" },
  { url: "https://www.example.com/c-banyo/havlu", text: "Havlu" },
  { url: "https://www.example.com/c-yatak-odasi/yastik", text: "Yastık" },
  { url: "https://www.example.com/c-banyo", text: "Banyo" },
  { url: "https://www.example.com/hakkimizda", text: "Hakkımızda" },
  { url: "https://www.example.com/siparis-takibi", text: "Sipariş Takibi" },
];
const page = (url: string, pageType: string, extra: Array<{ url: string; text: string }> = []) =>
  ({ url, pageType, facts: { title: null, h1: null, ogSiteName: null, metaDescription: null, schemaTypes: [], products: [], links: [], breadcrumbs: [], lang: "tr", anchors: [...menu, ...extra] } }) as never;

describe("ana menü kategorileri", () => {
  it("sayfaların çoğunda tekrar eden menü bağlantılarından ürün kategorilerini alır; alan adı ve kurumsal bağlantıları eler", () => {
    const pages = [page("https://www.example.com/", "home", [{ url: "https://www.example.com/c-mutfak/tabak", text: "Tabak" }]), page("https://www.example.com/c-banyo/havlu", "category"), page("https://www.example.com/p/layna", "product")];
    expect(menuCategories(pages, "tr")).toEqual(["Nevresim Takımı", "Havlu", "Yastık"]);
  });

  it("menüdeki ürün grubu taranan ürün sayısından önce gelir", () => {
    const g = (label: string, n: number) => ({ label, area: null, subtype: null, products: Array.from({ length: n }, (_, i) => `${label} ${i}`), evidenceUrls: [], attributes: [], hasSet: false }) as TopicGroup;
    const out = preferMenuGroups([g("Saklama Kutuları", 5), g("Banyo Aksesuarları", 3), g("Nevresim Takımları", 1)], ["Nevresim Takımı", "Havlu"]);
    expect(out.map((x) => x.label)).toEqual(["Nevresim Takımları", "Saklama Kutuları", "Banyo Aksesuarları"]);
  });
});

describe("soru önerileri", () => {
  it("katalogda doğrulanan özellikle somut soru; bilgi sorusu tek ve en sonda", () => {
    const t = purposeTemplates("Yastık", "TR", { attributes: groupAttributes(["Winter Kaz Tüyü Yastık", "Layna Yün Yastık", "Comfy Kaz Tüyü Yastık"]) });
    expect(t[1]!.text).toBe("Kaz tüyü yastık arıyorum; hangi markaları önerirsin?");
    expect(t.filter((x) => ["tips", "types_diff"].includes(x.pattern))).toHaveLength(1);
    expect(t[t.length - 1]!.pattern).toBe("tips");
  });

  it("grupta bilgi sorusu varsa yenisi önerilmez; aynı kalıp en çok 2 grupta takip edilir", () => {
    const cluster = (id: string, label: string, texts: string[]) => ({ id, label, category: label, prompts: texts.map((text, i) => ({ id: `${id}-${i}`, active: true, archivedAt: null, versions: [{ text }] })) });
    const groups = buildPickerGroups(
      [
        cluster("a", "Yastık", ["Yastık seçerken nelere dikkat etmeliyim?", "Türkiye'de en iyi yastık markaları hangileri?"]),
        cluster("b", "Havlu", ["Türkiye'de en iyi havlu markaları hangileri?"]),
        cluster("c", "Nevresim Takımı", []),
      ],
      [],
      "TR",
    );
    const by = (l: string) => groups.find((g) => g.label === l)!;
    expect(by("Yastık").suggested.concat(by("Yastık").needsEdit).some((q) => questionPattern(q.text) === "tips")).toBe(false);
    expect(by("Nevresim Takımı").suggested.some((q) => questionPattern(q.text) === "best_brands")).toBe(false);
    expect(by("Nevresim Takımı").suggested.length).toBeGreaterThan(2);
  });
});
