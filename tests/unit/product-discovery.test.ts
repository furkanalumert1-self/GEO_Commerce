import { describe, expect, it } from "vitest";
import { crawlSite, classifySiteError, type Fetcher } from "@/modules/audit/crawler";
import { availabilityFlag, extractPage } from "@/modules/audit/html";
import { candidateFacts, candidateStatus, normalizeProductUrl } from "@/modules/catalog/candidates";

const page = (body: string, url: string) => ({ status: 200, headers: { "content-type": "text/html" }, body, url, truncated: false });
const productLd = (name: string, price = "100", sku = "S1") => `<script type="application/ld+json">{"@type":"Product","name":"${name}","sku":"${sku}","offers":{"@type":"Offer","price":"${price}","priceCurrency":"TRY","availability":"https://schema.org/InStock"}}</script>`;

describe("tarayıcı: ürün sitemap'i öncelikli, www denemesi", () => {
  it("dizinde 6. sıradaki ürün sitemap'i okunur ve ürün sayfaları bütçe dolmadan taranır", async () => {
    const base = "https://shop.example";
    const children = ["blog", "blog_category", "page", "brand", "category", "product"].map((n) => `${base}/xml/sitemap/${n}.xml`);
    const fetcher: Fetcher = async (url) => {
      if (url.endsWith("/robots.txt")) return page("User-agent: *\nAllow: /", url);
      if (url.endsWith("/sitemap.xml")) return page(`<sitemapindex>${children.map((c) => `<sitemap><loc>${c}</loc></sitemap>`).join("")}</sitemapindex>`, url);
      if (url.includes("/xml/sitemap/product.xml")) return page(`<urlset>${[1, 2, 3, 4].map((i) => `<url><loc>${base}/urun-${i}</loc></url>`).join("")}</urlset>`, url);
      if (url.includes("/xml/sitemap/")) return page(`<urlset>${Array.from({ length: 30 }, (_, i) => `<url><loc>${base}/${url.split("/").pop()!.replace(".xml", "")}-${i}</loc></url>`).join("")}</urlset>`, url);
      if (/\/urun-\d$/.test(url)) return page(`<html>${productLd(url.split("/").pop()!)}</html>`, url);
      return page(`<html><a href="${base}/marka-x">x</a></html>`, url);
    };
    const r = await crawlSite({ domain: "shop.example", maxPages: 8, fetcher });
    expect(r.pages.filter((p) => p.pageType === "product").map((p) => p.url).sort()).toEqual([1, 2, 3, 4].map((i) => `${base}/urun-${i}`));
    expect(r.pages.some((p) => p.url.includes("/blog-"))).toBe(false);
  });

  it("www'suz adres SSL hatası verirse www ile taranır; ikisi de olmazsa nedeni bildirilir", async () => {
    const ssl: Fetcher = async (url) => {
      if (url.startsWith("https://bozuk.example")) throw new Error("write EPROTO ssl3_read_bytes:tlsv1 alert internal error");
      return page(`<html><title>ok</title></html>`, url);
    };
    const r = await crawlSite({ domain: "bozuk.example", maxPages: 3, fetcher: ssl });
    expect(r.wwwFallback).toBe(true);
    expect(r.pages[0]?.url).toBe("https://www.bozuk.example/");
    const dead: Fetcher = async () => { throw new Error("write EPROTO tlsv1 alert internal error"); };
    const d = await crawlSite({ domain: "olu.example", maxPages: 3, fetcher: dead });
    expect(d.pages).toHaveLength(0);
    expect(d.homeError?.kind).toBe("ssl");
    expect(classifySiteError("getaddrinfo ENOTFOUND x")).toBe("dns");
  });
});

describe("çıkarım: şemasız ürün, kategori, eksik alan", () => {
  it("Product şeması yoksa og:type=product etiketleriyle aday çıkar; uydurma alan yok", () => {
    const html = `<html><head><meta property="og:type" content="product"><meta property="og:title" content="Visco Yastık | Mağaza"><meta property="og:image" content="https://m.example/y.jpg"><meta property="product:availability" content="in stock"></head><body><h1>Visco Yastık</h1></body></html>`;
    const f = extractPage(html, "https://m.example/visco-yastik");
    expect(f.products).toHaveLength(1);
    expect(f.products[0]).toMatchObject({ name: "Visco Yastık", price: null, currency: null, availability: "in stock", source: "meta" });
  });
  it("yalnız başlık veya og:type olmadan ürün üretilmez; fiyat 0 bilinmiyor sayılır", () => {
    expect(extractPage(`<html><head><meta property="og:title" content="X"></head></html>`, "https://m.example/x").products).toHaveLength(0);
    expect(extractPage(`<html>${productLd("Y", "0")}</html>`, "https://m.example/y").products[0]!.price).toBeNull();
  });
  it("kategori sayfası (birden çok ürün) aday değildir", () => {
    const html = `<html>${productLd("A", "1", "a")}${productLd("B", "2", "b")}</html>`;
    const f = extractPage(html, "https://m.example/yataklar");
    expect(candidateFacts("category", f.products)).toBeNull();
    expect(candidateFacts("product", f.products)).toBeNull();
  });
  it("stok metni: in stock / InStock / tükendi / belirsiz", () => {
    expect(availabilityFlag("in stock")).toBe(true);
    expect(availabilityFlag("InStock")).toBe(true);
    expect(availabilityFlag("OutOfStock")).toBe(false);
    expect(availabilityFlag("ön sipariş yakında?")).toBeNull();
  });
});

describe("aday durumu", () => {
  const existing = [{ externalId: "https://m.example/a", url: "https://www.m.example/a/", name: "A", variants: [{ priceMinor: 1000n, currency: "TRY", available: true }] }];
  it("canonical/yazım farkı aynı ürün sayılır; değişen fiyat 'Güncellenecek'", () => {
    expect(normalizeProductUrl("https://www.m.example/a/?utm_source=x")).toBe(normalizeProductUrl("https://m.example/a"));
    expect(candidateStatus({ url: "https://m.example/a?utm_source=x", sku: null, name: "A", priceMinor: 1200n, currency: "TRY", available: true }, existing).status).toBe("update");
    expect(candidateStatus({ url: "https://m.example/a", sku: null, name: "A", priceMinor: 1000n, currency: "TRY", available: true }, existing).status).toBe("imported");
  });
  it("yeni ve eksik bilgili adaylar ayrılır", () => {
    expect(candidateStatus({ url: "https://m.example/b", sku: null, name: "B", priceMinor: 500n, currency: "TRY", available: true }, existing).status).toBe("new");
    const inc = candidateStatus({ url: "https://m.example/c", sku: null, name: "C", priceMinor: null, currency: null, available: null }, existing);
    expect(inc.status).toBe("incomplete");
    expect(inc.missing).toEqual(["fiyat", "stok"]);
  });
});
