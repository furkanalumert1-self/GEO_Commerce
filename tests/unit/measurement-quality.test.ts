import { describe, expect, it } from "vitest";
import { buildQuestionSet, cleanTopic, detectBusiness, menuSections, siteBrandName, topicsFor } from "@/modules/audit/business";
import { questionIssues, questionKind } from "@/modules/audit/service";
import { balanceRepetitions, visibilityScore, type ScoredObservation } from "@/modules/monitoring/metrics";
import { isStalled } from "@/modules/monitoring/run-status";
import { sovMissingReason } from "@/lib/view-models";

type P = Parameters<typeof detectBusiness>[0][number];
const page = (url: string, pageType: string, facts: Partial<P["facts"]> = {}): P => ({
  url,
  pageType,
  facts: { title: null, h1: null, metaDescription: null, schemaTypes: [], products: [], ogSiteName: null, links: [], breadcrumbs: [], lang: "tr", anchors: [], ...facts },
});
const product = (name: string, brand: string | null) => ({ name, brand, description: null, category: null, price: "100", currency: "TRY", availability: "InStock", sku: null, image: null, url: null });

describe("işletme türü", () => {
  const store = [
    page("https://evim.com/", "home", { ogSiteName: "Evim", anchors: [{ url: "https://evim.com/ev-tekstili/", text: "Ev Tekstili" }, { url: "https://evim.com/ev-tekstili/a", text: "Nevresim" }, { url: "https://evim.com/ev-tekstili/b", text: "Yorgan" }, { url: "https://evim.com/sofra/", text: "Sofra" }, { url: "https://evim.com/hizmetlerimiz/", text: "Hizmetlerimiz" }] }),
    page("https://evim.com/ev-tekstili/x", "product", { products: [product("Battaniye", "Linen Co")] }),
    page("https://evim.com/ev-tekstili/y", "product", { products: [product("Nevresim", "Uyku")] }),
    page("https://evim.com/sofra/z", "product", { products: [product("Tabak", "Seramikçi")] }),
    page("https://evim.com/sofra/w", "product", { products: [product("Bardak", "Camcı")] }),
  ];

  it("çok markalı mağaza: gerekçe ve kaynak URL ile; menü başlığından soru üretilmez", () => {
    const p = detectBusiness(store, "evim.com");
    expect(p.type).toBe("retailer");
    expect(p.reasons[0]).toMatch(/farklı üretici markası/);
    expect(p.evidenceUrls.length).toBeGreaterThan(0);
    expect(menuSections(store)).toEqual(["Ev Tekstili", "Sofra"]);
    const topics = topicsFor(p, store, [], "tr");
    const set = buildQuestionSet(p, topics, { country: "TR", brandName: siteBrandName(store, "evim.com") });
    expect(set.questions.map((q) => q.kind)).toEqual(["discovery", "discovery", "need", "need", "info"]);
    expect(set.questions[0]!.text).toBe("Türkiye'de ev tekstili ürünleri satın alabileceğim online mağazalar hangileri?");
    expect(set.questions.some((q) => /hizmetlerimiz|evim/i.test(q.text))).toBe(false);
  });

  it("üretici: ürünlerin çoğu kendi markası", () => {
    const pages = [page("https://folia.com/", "home", { ogSiteName: "Folia® – Hair Care" }), ...["Serum", "Şampuan", "Tonik", "Maske"].map((n, i) => page(`https://folia.com/products/${i}`, "product", { products: [product(n, i === 3 ? "Başka" : "FOLIA")] }))];
    expect(siteBrandName(pages, "folia.com")).toBe("Folia");
    const p = detectBusiness(pages, "folia.com");
    expect(p.type).toBe("manufacturer");
    const set = buildQuestionSet(p, ["Saç bakımı"], { country: "TR", brandName: "Folia" });
    expect(set.questions[0]!.text).toBe("Türkiye'de en iyi saç bakımı markaları hangileri?");
  });

  it("ajans: gerçek hizmet adları (yasal sayfa ve menü başlığı değil)", () => {
    const pages = [
      page("https://ajans.com/", "home", {
        title: "Dijital pazarlama ajansı",
        links: ["https://ajans.com/seo-hizmetleri/", "https://ajans.com/crm-kurulum-hizmeti/", "https://ajans.com/bilgi-toplumu-hizmetleri/"],
        anchors: [
          { url: "https://ajans.com/hizmetlerimiz/", text: "Hizmetlerimiz" },
          { url: "https://ajans.com/seo-hizmetleri/", text: "SEO Hizmetleri" },
          { url: "https://ajans.com/crm-kurulum-hizmeti/", text: "CRM Kurulumu" },
          { url: "https://ajans.com/bilgi-toplumu-hizmetleri/", text: "Bilgi Toplumu Hizmetleri" },
        ],
      }),
    ];
    const p = detectBusiness(pages, "ajans.com");
    expect(p.type).toBe("service");
    expect(p.offerings).toEqual(["SEO", "CRM Kurulumu"]);
    const set = buildQuestionSet(p, topicsFor(p, pages, [], "tr"), { country: "TR", brandName: "Pixel" });
    expect(set.questions[0]!.text).toBe("Türkiye'de SEO hizmeti veren ajansları karşılaştırır mısın?");
    expect(set.questions[2]!.text).toBe("SEO ve CRM kurulumu hizmetlerini birlikte sunan ajanslar hangileri?");
  });

  it("veri yetersizse soru uydurulmaz; eksik set ve neden döner", () => {
    const p = detectBusiness([page("https://x.com/", "home")], "x.com");
    expect(p.type).toBe("unknown");
    expect(p.confidence).toBe("low");
    const set = buildQuestionSet(p, [], { country: "TR", brandName: "X" });
    expect(set.questions).toEqual([]);
    expect(set.incomplete).toMatch(/kategori/);
  });

  it("yazılım sinyali için tek demo/api bağlantısı yetmez; fiyatlandırma + kayıt gerekir", () => {
    const weak = detectBusiness([page("https://s.com/", "home", { links: ["https://s.com/demo", "https://s.com/api"] })], "s.com");
    expect(weak.type).not.toBe("saas");
    const strong = detectBusiness([page("https://s.com/", "home", { links: ["https://s.com/pricing", "https://s.com/signup"] })], "s.com");
    expect(strong.type).toBe("saas");
  });

  it("konu temizliği: 'Collection:' öneki, gezinme etiketi ve Türkçe sitede İngilizce ürün tipi", () => {
    expect(cleanTopic("Collection: Saç Bakımı", "tr")).toBe("Saç Bakımı");
    expect(cleanTopic("Products", "tr")).toBeNull();
    expect(cleanTopic("Hair Loss Treatments", "tr")).toBeNull();
    expect(cleanTopic("Hair Loss Treatments", "en")).toBe("Hair Loss Treatments");
  });
});

describe("soru düzenleme kontrolü", () => {
  it("marka adı, bağlantı ve kısa soru işaretlenir; tür tahmin edilir", () => {
    expect(questionIssues("Evim güvenilir mi?", "Evim")).toContain("Marka adınızı içeren sorular genel keşif ölçümüne girmez; markasız yazın");
    expect(questionIssues("www.x.com iyi mi bir site?", "Y")).toContain("Soruda bağlantı olmamalı");
    expect(questionIssues("Yatak?", "Y")).toContain("Soru çok kısa");
    expect(questionIssues("Türkiye'de yatak satın alabileceğim mağazalar hangileri?", "Evim")).toEqual([]);
    expect(questionKind("Yatak seçerken nelere dikkat etmeliyim?")).toBe("info");
    expect(questionKind("Yatak için hangi markaları önerirsin?")).toBe("discovery");
  });
});

describe("hesaplama", () => {
  const obs = (mentioned: boolean, valid = true): ScoredObservation => ({ engine: "chatgpt", surface: "api_grounded", valid, weight: 1, mentioned, recommended: false, ownCitation: false, supportsCitations: true });

  it("tekrarlar soru/platform içinde birleştirilir: 3 kez sorulan soru fazla ağırlık almaz", () => {
    // A sorusu 3 kez (hep anıldı), B sorusu 1 kez (anılmadı): birleştirmeden M=0.75, birleştirince 0.5.
    const items = [
      { key: "A", obs: obs(true) },
      { key: "A", obs: obs(true) },
      { key: "A", obs: obs(true) },
      { key: "B", obs: obs(false) },
    ];
    expect(visibilityScore(items.map((x) => x.obs), 4).M).toBeCloseTo(0.75);
    expect(visibilityScore(balanceRepetitions(items), 4).M).toBeCloseTo(0.5);
    // Başarısız yanıt ağırlığı değişmez ve formüle girmez.
    const withFail = balanceRepetitions([...items, { key: "C", obs: obs(false, false) }]);
    expect(withFail[4]!.weight).toBe(1);
    expect(visibilityScore(withFail, 5).M).toBeCloseTo(0.5);
  });

  it("görünürlük payı ölçülemiyorsa nedeni ayrılır", () => {
    expect(sovMissingReason({ competitorCount: 0, validAnswers: 0 })).toBe("Geçerli yanıt yok");
    expect(sovMissingReason({ competitorCount: 0, validAnswers: 12 })).toBe("Onaylı rakip yok");
    expect(sovMissingReason({ competitorCount: 3, validAnswers: 12 })).toMatch(/pay tanımsız/);
  });

  it("uzun süre ilerlemeyen çalışma 'durakladı' sayılır; biten çalışma sayılmaz", () => {
    const now = Date.now();
    const old = new Date(now - 30 * 60_000);
    expect(isStalled({ status: "running", startedAt: old, scheduledAt: old }, { succeeded: 2, failed: 0, pending: 8, lastActivity: old }, now)).toBe(true);
    expect(isStalled({ status: "running", startedAt: old, scheduledAt: old }, { succeeded: 2, failed: 0, pending: 8, lastActivity: new Date(now - 60_000) }, now)).toBe(false);
    expect(isStalled({ status: "succeeded", startedAt: old, scheduledAt: old }, undefined, now)).toBe(false);
  });
});
