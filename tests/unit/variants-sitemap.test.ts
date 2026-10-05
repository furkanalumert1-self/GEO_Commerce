import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { classifyPage, extractPage } from "@/modules/audit/html";
import { crawlSite, type Fetcher } from "@/modules/audit/crawler";
import { candidateFacts } from "@/modules/catalog/candidates";

const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const variant = (color: string, sku: string) => ({ "@type": "Product", name: `Alida Nevresim Takımı - ${color} - ${color}`, sku, offers: { "@type": "Offer", price: "1349.99", priceCurrency: "TRY", availability: "https://schema.org/InStock" } });

describe("varyantlı ürün sayfası (ProductGroup)", () => {
  const url = "https://m.example/alida-nevresim-gri-nt1/";
  const html = `<html><body><h1>Alida Nevresim Takımı - Gri</h1>${ld({ "@context": "https://schema.org", "@type": "ProductGroup", "@id": "Nevresim", name: "Alida Nevresim Takımı - Gri", hasVariant: [variant("Mint", "1"), variant("Pudra", "2"), variant("Gri", "3")] })}</body></html>`;

  it("varyantlar tek ürüne iner; sayfanın kendi rengi seçilir, ürün sayfası sayılır", () => {
    const f = extractPage(html, url);
    expect(f.products).toHaveLength(1);
    expect(f.products[0]).toMatchObject({ name: "Alida Nevresim Takımı - Gri", sku: "3", price: "1349.99", url });
    expect(classifyPage(url, f)).toBe("product");
    expect(candidateFacts("product", f.products)?.name).toBe("Alida Nevresim Takımı - Gri");
  });

  it("varyant grubu olmayan çok ürünlü sayfa liste olarak kalır", () => {
    const list = `<html><body><h1>Nevresimler</h1>${ld([variant("Mint", "1"), variant("Gri", "3"), { ...variant("Bej", "4"), name: "Başka ürün" }])}</body></html>`;
    expect(classifyPage("https://m.example/nevresim/", extractPage(list, "https://m.example/nevresim/"))).toBe("category");
  });
});

describe("sitemap başka sunucuda ve sıkıştırılmış (.xml.gz)", () => {
  it("S3'teki gzip ürün sitemap'i okunur; yalnız marka alan adındaki sayfalar taranır", async () => {
    const productXml = `<urlset><url><loc>https://m.example/urun-a/</loc></url><url><loc>https://baska.example/x/</loc></url></urlset>`;
    const page = (body: string, u: string, status = 200, extra: Record<string, string> = {}) => ({ status, headers: { "content-type": "text/html", ...extra }, body, url: u, truncated: false });
    const seen: string[] = [];
    const fetcher: Fetcher = async (u, o) => {
      seen.push(`${u}|${o.sameSiteAs ?? "-"}`);
      if (u.endsWith("/robots.txt")) return page("Sitemap: https://s3.example/sm/index.xml", u, 200, { "content-type": "text/plain" });
      if (u === "https://s3.example/sm/index.xml") return page(`<sitemapindex><sitemap><loc>https://s3.example/sm/sitemap-products-1.xml.gz</loc></sitemap></sitemapindex>`, u, 200, { "content-type": "text/xml" });
      if (u.endsWith(".xml.gz")) return page(productXml, u, 200, { "content-type": "text/xml" });
      if (u.includes("urun-a")) return page(`<h1>A</h1>${ld({ "@type": "Product", name: "A", sku: "a", offers: { price: "10", priceCurrency: "TRY" } })}`, u);
      return page("<h1>Ana</h1>", u);
    };
    const r = await crawlSite({ domain: "m.example", maxPages: 5, delayMs: 0, fetcher });
    expect(r.pages.some((p) => p.url === "https://m.example/urun-a/" && p.pageType === "product")).toBe(true);
    expect(seen.some((s) => s.startsWith("https://baska.example"))).toBe(false);
    expect(seen.find((s) => s.startsWith("https://s3.example/sm/sitemap-products"))!.endsWith("|-")).toBe(true);
  });

  it("gzip baytları açılır; düz metin ve kesilmiş gzip olduğu gibi kalır", async () => {
    const { decodeBody } = await import("@/lib/http/safe-fetch");
    const xml = "<urlset><url><loc>https://m.example/a/</loc></url></urlset>";
    expect(decodeBody(gzipSync(xml), false)).toBe(xml);
    expect(decodeBody(Buffer.from(xml), false)).toBe(xml);
    expect(decodeBody(gzipSync(xml).subarray(0, 10), true)).not.toBe(xml);
  });
});

describe("ürün kategorisi breadcrumb'dan", () => {
  it("şema kategorisi yoksa son kategori kırıntısı; ürünün kendi adı (yazım farkıyla) kategori olmaz", () => {
    const crumbs = (names: string[]) => `<script type="application/ld+json">${JSON.stringify({ "@type": "BreadcrumbList", itemListElement: names.map((n, i) => ({ "@type": "ListItem", position: i + 1, name: n })) })}</script>`;
    const prod = (n: string) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: n, sku: "1", offers: { price: "10", priceCurrency: "TRY" } })}</script>`;
    const a = extractPage(`<h1>X</h1>${crumbs(["Anasayfa", "Yatak Odası", "Pike Takımı", "Searlas Pike Takımı- Mint"])}${prod("Searlas Pike Takımı - Mint")}`, "https://m.example/searlas/");
    expect(a.products[0]!.category).toBe("Pike Takımı");
  });
});
