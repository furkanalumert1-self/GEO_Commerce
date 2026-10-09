import { describe, expect, it } from "vitest";
import { categorySuggestions, homeBrandName, menuCategories, preferMenuGroups, productGroups, type TopicGroup } from "@/modules/audit/business";
import { isCompetitorCandidate, nonCompetitorReason } from "@/modules/audit/competitor-filter";
import { buildPickerGroups } from "@/modules/prompts/picker";
import { groupAttributes, purposeTemplates, questionPattern } from "@/modules/prompts/quality";

const menu = [
  { url: "https://www.example.com/c-yatak-odasi/nevresim-takimi", text: "Nevresim Takımı" },
  { url: "https://www.example.com/c-banyo/havlu", text: "Havlu" },
  { url: "https://www.example.com/c-yatak-odasi/yastik", text: "Yastık" },
  { url: "https://www.example.com/c-banyo", text: "Banyo" },
  { url: "https://www.example.com/hakkimizda", text: "Hakkımızda" },
  { url: "https://www.example.com/siparis-takibi", text: "Sipariş Takibi" },
  { url: "https://www.example.com/kurumsal-satis", text: "Kurumsal Satış" },
  { url: "https://www.example.com/kulup", text: "KULÜP Kart" },
  { url: "https://www.example.com/cabare", text: "CaBaRe" },
  { url: "https://www.example.com/c-mutfak/tencere", text: "Tencere" },
];
const page = (url: string, pageType: string, extra: Array<{ url: string; text: string }> = [], products: Array<{ name: string }> = []) =>
  ({ url, pageType, facts: { title: null, h1: null, ogSiteName: null, metaDescription: null, schemaTypes: [], products, links: [], breadcrumbs: [], lang: "tr", anchors: [...menu, ...extra] } }) as never;

describe("ana menü kategorileri", () => {
  it("sayfaların çoğunda tekrar eden, ürün/kategori kanıtı olan menü bağlantılarını alır; kurumsal, kulüp ve koleksiyon adlarını eler", () => {
    const pages = [
      page("https://www.example.com/", "home", [{ url: "https://www.example.com/c-mutfak/tabak", text: "Tabak" }]),
      page("https://www.example.com/c-banyo/havlu", "category"),
      page("https://www.example.com/p/layna", "product", [], [{ name: "Layna Yün Yastık" }]),
      page("https://www.example.com/c-yatak-odasi/nevresim-takimi/ranforce-cift", "product", [], [{ name: "Ranforce Çift Kişilik Nevresim Takımı" }]),
    ];
    // Tencere menüde var ama taranan sayfalarda kanıtı yok; "Tabak" yalnız bir sayfada geçiyor.
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

describe("ürün grubu ve rakip doğruluğu", () => {
  it("alt bölüm üst bölümü daraltıyorsa grup alt bölümdür: “Çay › Çay Bardakları” çay değildir", () => {
    const product = (name: string, crumbs: string[]) => ({ url: `https://pasabahce.example/p/${name}`, pageType: "product", facts: { title: null, h1: name, ogSiteName: null, metaDescription: null, schemaTypes: [], products: [{ name }], links: [], breadcrumbs: [...crumbs, name], lang: "tr" } }) as never;
    const groups = productGroups([product("Leo Çay Bardağı", ["Sofra", "Çay", "Çay Bardakları"]), product("Timeless Çay Bardağı", ["Sofra", "Çay", "Çay Bardakları"])], "tr");
    expect(groups[0]!.label).toBe("Çay Bardakları");
    // Gerçek çay satan markada grup yine çay ürünüdür (2. düzey "Siyah Çay").
    const tea = productGroups([product("Rize Turist", ["Çay", "Siyah Çay"]), product("Tiryaki", ["Çay", "Siyah Çay"])], "tr");
    expect(tea[0]!.label).toBe("Siyah Çay");
  });

  it("kullanım alanı (“Pişirme”, “Servis ve Sunum”) grup olmaz; asıl ürüne inilir ve menüden elenir", () => {
    const product = (name: string, crumbs: string[]) => ({ url: `https://schafer.example/p/${name}`, pageType: "product", facts: { title: null, h1: name, ogSiteName: null, metaDescription: null, schemaTypes: [], products: [{ name }], links: [], breadcrumbs: [...crumbs, name], lang: "tr" } }) as never;
    const groups = productGroups([product("Granit Tava 24", ["Mutfak", "Pişirme", "Tava & Tava Seti"]), product("Seramik Tava 28", ["Mutfak", "Pişirme", "Tava & Tava Seti"]), product("Servis Tabağı", ["Mutfak", "Servis ve Sunum", "Servis Tabakları"])], "tr");
    expect(groups.map((g) => g.label)).toEqual(["Tava & Tava Seti", "Servis Tabakları"]);
  });

  it("alan adında marka adını taşıyan siteler markanın kendisidir, rakip önerilmez", () => {
    expect(nonCompetitorReason("pasabahcemagazalari.com", "pasabahce.com")).toBe("own");
    expect(nonCompetitorReason("www.karaca-home.com", "karaca.com")).toBe("own");
    expect(isCompetitorCandidate("chado.com.tr", "pasabahce.com")).toBe(true);
    // Kısa marka adı başka markaları yanlışlıkla elemesin.
    expect(isCompetitorCandidate("ikea.com.tr", "ike.com")).toBe(true);
  });
});

describe("kullanım alanı birleşimleri, menüde marka adı, kategori önerileri", () => {
  const product = (name: string, crumbs: string[]) => ({ url: `https://emsan.example/p/${name}`, pageType: "product", facts: { title: null, h1: name, ogSiteName: null, metaDescription: null, schemaTypes: [], products: [{ name }], links: [], breadcrumbs: [...crumbs, name], lang: "tr" } }) as never;

  it("yalnız kullanım kelimelerinden oluşan ad (“İçecek Sunum”, “Kahvaltı & Servis”) grup olmaz", () => {
    const groups = productGroups([product("Kristal Sürahi", ["Sofra", "İçecek Sunum", "Sürahiler"]), product("Cam Sürahi", ["Sofra", "İçecek Sunum", "Sürahiler"]), product("Kahvaltı Tabağı", ["Mutfak", "Kahvaltı & Servis", "Kahvaltı Takımları"])], "tr");
    expect(groups.map((g) => g.label)).toEqual(["Sürahiler", "Kahvaltı Takımları"]);
  });

  it("marka adı menü kategorisi sayılmaz", () => {
    const anchors = [
      { url: "https://www.emsan.com.tr/", text: "Emsan" },
      { url: "https://www.emsan.com.tr/kadehler", text: "Kadehler" },
    ];
    const pg = (url: string, pageType: string, products: Array<{ name: string }> = []) => ({ url, pageType, facts: { title: null, h1: null, ogSiteName: null, metaDescription: null, schemaTypes: [], products, links: [], breadcrumbs: [], lang: "tr", anchors } }) as never;
    const pages = [pg("https://www.emsan.com.tr/", "home"), pg("https://www.emsan.com.tr/kadehler", "category"), pg("https://www.emsan.com.tr/p/kristal-kadeh", "product", [{ name: "Kristal Kadeh" }])];
    expect(menuCategories(pages, "tr", 8, "Emsan")).toEqual(["Kadehler"]);
  });

  it("ürün grubu bulunamazsa ana sayfa açıklamasındaki kategoriler önerilir", () => {
    const home = { url: "https://korkmaz.com.tr/", pageType: "home", facts: { title: "Korkmaz Mutfak Eşyaları", h1: null, ogSiteName: null, metaDescription: "Mutfağınızın tencere, tava, mutfak gereçleri, yemek takımları ve diğer tüm ihtiyaçları için en kaliteli ürünler Korkmaz.com.tr ile, hemen tıklayın!", schemaTypes: [], products: [], links: [], breadcrumbs: [], lang: "tr" } } as never;
    expect(categorySuggestions([home], [], "Korkmaz")).toEqual(["Tencere", "Tava", "Mutfak gereçleri", "Yemek takımları"]);
    expect(homeBrandName(home, "korkmaz.com.tr")).toBe("Korkmaz");
  });
});
