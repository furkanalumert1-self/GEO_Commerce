import { describe, expect, it } from "vitest";
import { pinnedLookup } from "@/lib/http/safe-fetch";
import { classifyPage } from "@/modules/audit/html";
import { auditPrompts, deriveCategoryTerms } from "@/modules/audit/service";

describe("sabitlenmiş DNS lookup", () => {
  it("Node'un { all: true } çağrısına adres dizisiyle yanıt verir", () => {
    const lookup = pinnedLookup("93.184.216.34", 4);
    let all: unknown;
    lookup("x.com", { all: true }, (_e, a) => (all = a));
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
    let single: unknown[] = [];
    lookup("x.com", {}, (_e, a, f) => (single = [a, f]));
    expect(single).toEqual(["93.184.216.34", 4]);
  });
});

describe("tarama sınıflandırması ve soru üretimi", () => {
  const p = (category: string) => ({ category });
  it("çok ürünlü liste sayfası kategori, tek ürünlü sayfa ürün; ana sayfa ana sayfadır", () => {
    expect(classifyPage("https://m.com/mocca-koltuklar", { schemaTypes: [], products: [p("a") as never, p("b") as never] })).toBe("category");
    expect(classifyPage("https://m.com/mocca-koltuk-gri", { schemaTypes: [], products: [p("a") as never] })).toBe("product");
    expect(classifyPage("https://m.com/", { schemaTypes: [], products: [p("a") as never, p("b") as never] })).toBe("home");
  });

  it("model adları yerine paylaşılan genel kategori terimleri seçilir", () => {
    const pages = [
      { pageType: "category", facts: { h1: null, title: "Mocca Koltuk", products: [p("Mobilya >Mocca Katlanır Koltuk"), p("Mobilya >Magic Katlanır Koltuk")] } },
      { pageType: "category", facts: { h1: null, title: "Coop Puf", products: [p("Mobilya >Coop Puf Seti"), p("Mobilya >Loop Puf Seti")] } },
    ];
    const terms = deriveCategoryTerms(pages);
    expect(terms).toEqual(["Katlanır Koltuk", "Puf Seti", "Mobilya"]);
    const prompts = auditPrompts(terms, "TR");
    expect(prompts).toHaveLength(5);
    expect(prompts.join(" ")).not.toMatch(/mocca|magic|hassas cilt/i);
  });
});

describe("breadcrumb ve başlıktan kategori", () => {
  it("ürün şeması olmayan sitede breadcrumb ilk düzeyini kullanır", async () => {
    const { extractPage } = await import("@/modules/audit/html");
    const { deriveCategoryTerms, auditPrompts } = await import("@/modules/audit/service");
    const crumb = (names: string[]) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "X" }, { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Anasayfa" }, ...names.map((name, i) => ({ "@type": "ListItem", position: i + 2, name }))] }] })}</script>`;
    const page = (path: string, title: string, names: string[]) => ({ pageType: "other", facts: extractPage(`<html><head><title>${title}</title>${crumb(names)}</head><body></body></html>`, `https://x.com.tr/${path}`) });
    const pages = [
      page("kategori-listesi", "Kategori Konu Listesi", ["Kategori(Konu) Liste"]),
      page("yataklar", "Yatak Modelleri ve Fiyatları | X", ["Yatak"]),
      page("ihtiyaca-gore", "İhtiyaca Göre", ["Yatak", "İhtiyaca Göre"]),
      page("bel", "Bel Desteği", ["Yatak", "İhtiyaca Göre", "Bel Desteği"]),
    ];
    expect(pages[1]!.facts.breadcrumbs).toEqual(["Yatak"]);
    const terms = deriveCategoryTerms(pages);
    expect(terms[0]).toBe("Yatak");
    expect(terms.some((t) => /kategori|göre/i.test(t))).toBe(false);
    expect(auditPrompts(terms, "TR")[0]).toBe("Türkiye'de en iyi yatak markaları hangileri?");
  });

  it("kategori yoksa bozuk 'ürünler' sorusu üretmez", async () => {
    const { auditPrompts } = await import("@/modules/audit/service");
    const prompts = auditPrompts([], "TR");
    expect(prompts).toHaveLength(5);
    expect(prompts.join(" ")).not.toMatch(/ürünler (markaları|modellerini)/);
  });
});

describe("aynı markanın başka uzantısına yönlendirme", () => {
  const page = (url: string, body: string) => ({ status: 200, url, headers: { "content-type": "text/html" }, body, truncated: false });
  it("avonni.com → avonni.com.tr yönlendirmesinde hedef alan adı taranır", async () => {
    const { crawlSite } = await import("@/modules/audit/crawler");
    const fetcher = async (url: string, opts: { sameSiteAs?: string }) => {
      const u = new URL(url);
      if (u.hostname === "avonni.com") {
        if (opts.sameSiteAs) throw new Error("Redirect doğrulanmış domain dışına çıkıyor");
        return page("https://avonni.com.tr/", "<html><title>Avonni</title></html>");
      }
      if (u.pathname === "/") return page(url, `<html><title>Avonni</title><a href="https://avonni.com.tr/iletisim">İletişim</a></html>`);
      return { ...page(url, ""), status: 404 };
    };
    const r = await crawlSite({ domain: "avonni.com", maxPages: 3, fetcher, delayMs: 0 });
    expect(r.domain).toBe("avonni.com.tr");
    expect(r.redirectedFrom).toBe("avonni.com");
    expect(r.pages.length).toBeGreaterThan(0);
  });

  it("farklı markaya yönlendirme izlenmez", async () => {
    const { resolveSiteDomain } = await import("@/modules/audit/crawler");
    const fetcher = async () => page("https://baskamarka.com/", "");
    expect(await resolveSiteDomain(fetcher, "avonni.com")).toBe("avonni.com");
  });

  it("sayfa alınamazsa hazırlık puanı 0 değil 'ölçülemedi'", async () => {
    const { evaluateReadiness } = await import("@/modules/audit/readiness");
    const r = evaluateReadiness({ domain: "x.com", robotsFound: false, robotsDisallowAll: false, sitemapFound: false, pages: [], failed: [{ url: "https://x.com/", reason: "x" }], skippedByRobots: 0, truncated: false });
    expect(r.geoScore).toBeNull();
    expect(r.adsScore).toBeNull();
  });
});

describe("microdata breadcrumb ve şablon bağlantıları", () => {
  it("microdata BreadcrumbList adlarını okur, {{url}} bağlantılarını atlar", async () => {
    const { extractPage } = await import("@/modules/audit/html");
    const html = `<html><title>Luxury Avizeler</title><ul class="breadcrumb" itemscope itemtype="https://schema.org/BreadcrumbList">
      <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem"><a itemprop="item" href="/"><span itemprop='name'>Anasayfa</span></a></li>
      <li itemprop='itemListElement' itemscope itemtype='https://schema.org/ListItem'><a itemprop='item' href='/avize'><span itemprop='name'>Avize</span></a></li>
      <li itemprop='itemListElement' itemscope itemtype='https://schema.org/ListItem'><a itemprop='item' href='/luxury-avizeler'><span itemprop='name'>Luxury Avizeler</span></a></li>
    </ul><a href="{{basketUrl}}">Sepet</a><a href="/iletisim">İletişim</a></html>`;
    const f = extractPage(html, "https://avonni.com.tr/luxury-avizeler");
    expect(f.breadcrumbs).toEqual(["Avize", "Luxury Avizeler"]);
    expect(f.schemaTypes).toContain("BreadcrumbList");
    expect(f.links.some((l) => l.includes("%7B%7B"))).toBe(false);
    expect(f.links).toContain("https://avonni.com.tr/iletisim");
  });
});
