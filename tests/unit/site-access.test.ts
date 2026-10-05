import { describe, expect, it } from "vitest";
import { botChallenge, classifySiteError, crawlSite, type Fetcher } from "@/modules/audit/crawler";
import { cleanTopic } from "@/modules/audit/business";
import { inStockFirst } from "@/modules/actions/generator";

const html = (body: string, url: string, status = 200, headers: Record<string, string> = { "content-type": "text/html" }) => ({ status, headers, body, url, truncated: false });

describe("bot koruması ve yönlendirme", () => {
  it("403/401/429 ve doğrulama sayfası 'blocked' sayılır; diğer HTTP hataları 'http'", () => {
    expect(classifySiteError("http_403")).toBe("blocked");
    expect(classifySiteError("http_403_challenge")).toBe("blocked");
    expect(classifySiteError("http_429")).toBe("blocked");
    expect(classifySiteError("http_500")).toBe("http");
    expect(classifySiteError("http_404")).toBe("http");
  });

  it("Cloudflare challenge başlığı tanınır", () => {
    expect(botChallenge({ "cf-mitigated": "challenge" })).toBe(true);
    expect(botChallenge({ server: "cloudflare" })).toBe(false);
  });

  it("Cloudflare engelli site: hata nedeni challenge olarak kaydedilir, sayfa okunmaz", async () => {
    const fetcher: Fetcher = async (url) => (url.endsWith("/robots.txt") || url.includes("sitemap") ? html("", url, 404) : html("Just a moment...", url, 403, { "content-type": "text/html", "cf-mitigated": "challenge" }));
    const r = await crawlSite({ domain: "engelli.example", maxPages: 5, delayMs: 0, fetcher });
    expect(r.pages).toHaveLength(0);
    expect(r.failed[0]?.reason).toBe("http_403_challenge");
    expect(classifySiteError(r.failed[0]!.reason)).toBe("blocked");
  });

  it("ülke yönlendirmesi (mavi.com → us.mavi.com) landedHost olarak raporlanır", async () => {
    const fetcher: Fetcher = async (url) => {
      if (url.endsWith("/robots.txt") || url.includes("sitemap")) return html("", url, 404);
      const u = new URL(url);
      return html("<html><head><title>US store</title></head><body><h1>Jeans</h1></body></html>", `https://us.mavi.example${u.pathname}`);
    };
    const r = await crawlSite({ domain: "mavi.example", maxPages: 2, delayMs: 0, fetcher });
    expect(r.landedHost).toBe("us.mavi.example");
  });

  it("www yönlendirmesi landedHost sayılmaz", async () => {
    const fetcher: Fetcher = async (url) => (url.endsWith("/robots.txt") || url.includes("sitemap") ? html("", url, 404) : html("<h1>x</h1>", url.replace("https://m.example", "https://www.m.example")));
    const r = await crawlSite({ domain: "m.example", maxPages: 1, delayMs: 0, fetcher });
    expect(r.landedHost).toBeUndefined();
  });
});

describe("konu temizliği: vitrin ve ölçü etiketleri ürün grubu değildir", () => {
  it.each(["Basics", "New Arrivals", "Best Sellers", "Yeni Gelenler", "Women's 28-30 inch Inseam", "34 Beden"])("%s elenir", (t) => {
    expect(cleanTopic(t, "tr")).toBeNull();
  });
  it.each(["Jean", "Kot Pantolon", "Cep Telefonu"])("%s korunur", (t) => {
    expect(cleanTopic(t, "tr")).toBe(t);
  });
});

describe("AI ile iyileştir: stokta olmayan ürünler öne çıkarılmaz", () => {
  it("stokta olmayanlar elenir; hepsi stok dışıysa liste korunur", () => {
    const a = { name: "A", available: true }, b = { name: "B", available: false }, c = { name: "C", available: null };
    expect(inStockFirst([b, a, c]).map((x) => x.name)).toEqual(["A", "C"]);
    expect(inStockFirst([b]).map((x) => x.name)).toEqual(["B"]);
  });
});

describe("reklam taslağı: model adları ürün tipi sayılmaz", () => {
  it("telefon adlarından 'iphone gb' gibi ifade üretilmez; kategori adı kullanılır", async () => {
    const { adDrafts } = await import("@/modules/ads/chatgpt-plan");
    const d = adDrafts({ brand: "MediaMarkt", label: "Cep Telefonu", products: ["Apple iPhone 15 128 GB Siyah", "Samsung Galaxy S24 256 GB"] });
    const text = d.map((x) => `${x.title} ${x.body}`).join(" ").toLocaleLowerCase("tr-TR");
    expect(text).not.toMatch(/\bgb\b|iphone|s24/);
    expect(text).toContain("cep telefonu");
  });
});

describe("soru dili: çoğul menü adı tekil kullanılır", () => {
  it("tek kelimelik çoğul ad tekile döner; çok kelimeli ad korunur", async () => {
    const { questionNoun } = await import("@/modules/audit/business");
    expect(questionNoun("Halılar")).toBe("halı");
    expect(questionNoun("Nemlendiriciler")).toBe("nemlendirici");
    expect(questionNoun("Banyo Havluları")).toBe("banyo havluları");
    expect(questionNoun("Jean")).toBe("jean");
  });
});

describe("ürün sayfası yoksa kategori breadcrumb'ları kanıt olur", () => {
  it("JS ile ürün listeleyen sitede gruplar kategori yolundan çıkar; vitrin etiketleri elenir, cinsiyet eklenir", async () => {
    const { productGroups } = await import("@/modules/audit/business");
    const pg = (url: string, breadcrumbs: string[]) => ({ url, pageType: "other", facts: { title: null, h1: null, metaDescription: null, schemaTypes: ["BreadcrumbList"], products: [], ogSiteName: null, links: [], breadcrumbs, lang: "tr", anchors: [] } });
    const groups = productGroups([
      pg("https://k.example/yeni-gelenler", ["Anasayfa", "Kadın", "Yeni Gelenler"]),
      pg("https://k.example/kadin-giyim", ["Anasayfa", "Kadın Giyim"]),
      pg("https://k.example/kadin-jeans", ["Anasayfa", "Kadın", "Jeans"]),
    ] as never, "tr");
    expect(groups.map((g) => g.label)).toEqual(["Kadın Jeans"]);
    expect(groups[0]!.evidenceUrls).toEqual(["https://k.example/kadin-jeans"]);
  });
});
