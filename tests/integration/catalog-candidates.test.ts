import { describe, expect, it } from "vitest";
import { autoImportComplete, importCandidates, importProductFacts, listCandidates, previewProductUrl } from "@/modules/catalog/candidates";
import { persistCrawl } from "@/modules/catalog/service";
import type { CrawlResult } from "@/modules/audit/crawler";
import { extractPage } from "@/modules/audit/html";
import { db, makeTenant } from "./helpers";

const ld = (name: string, price: string | null, sku: string) =>
  `<html><script type="application/ld+json">{"@type":"Product","name":"${name}","sku":"${sku}","offers":{"@type":"Offer",${price ? `"price":"${price}",` : ""}"priceCurrency":"TRY","availability":"https://schema.org/InStock"}}</script></html>`;

async function crawlWith(t: Awaited<ReturnType<typeof makeTenant>>, pages: Array<{ url: string; html: string; pageType: string }>) {
  const run = await db.crawlRun.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, maxPages: 50, status: "running" } });
  const crawl: CrawlResult = {
    domain: t.brand.domain, robotsFound: true, robotsDisallowAll: false, sitemapFound: true, failed: [], skippedByRobots: 0, truncated: false,
    pages: pages.map((p) => ({ url: p.url, canonical: null, status: 200, pageType: p.pageType, contentHash: p.url, etag: null, facts: extractPage(p.html, p.url) })),
  };
  await persistCrawl(db, { workspaceId: t.ws.id, brandId: t.brand.id, crawlRunId: run.id }, crawl);
}

describe("ürün keşfi → onaylı aktarım", () => {
  it("tarama kataloğu değiştirmez; onaylanan adaylar aktarılır; tekrar onay mükerrer oluşturmaz", async () => {
    const t = await makeTenant("commerce");
    const d = `https://${t.brand.domain}`;
    await crawlWith(t, [
      { url: `${d}/yatak`, html: ld("Yatak", "12999", "Y1"), pageType: "product" },
      { url: `${d}/yastik`, html: ld("Yastık", null, "Y2"), pageType: "product" },
      { url: `${d}/yataklar`, html: ld("A", "1", "a") + ld("B", "2", "b"), pageType: "category" },
    ]);
    expect(await db.product.count({ where: { brandId: t.brand.id } })).toBe(0);
    const list = await listCandidates(db, { workspaceId: t.ws.id, brandId: t.brand.id });
    expect(list.candidates.map((c) => [c.name, c.status]).sort()).toEqual([["Yastık", "incomplete"], ["Yatak", "new"]]);

    const opts = { brandDomain: t.brand.domain, catalogLimit: 500 };
    const r1 = await importCandidates(db, { workspaceId: t.ws.id, brandId: t.brand.id }, [`${d}/yatak`, `${d}/yastik`], opts);
    expect(r1).toMatchObject({ imported: 2, updated: 0 });
    const r2 = await importCandidates(db, { workspaceId: t.ws.id, brandId: t.brand.id }, [`${d}/yatak/`], opts);
    expect(r2).toMatchObject({ imported: 0, updated: 1 });
    expect(await db.product.count({ where: { brandId: t.brand.id } })).toBe(2);
    const yastik = await db.product.findFirstOrThrow({ where: { brandId: t.brand.id, name: "Yastık" }, include: { variants: true } });
    expect(yastik.variants[0]!.priceMinor).toBeNull(); // bilinmeyen fiyat uydurulmaz
  });

  it("boş alan dolu veriyi ezmez; başka marka etkilenmez; kota aşımı açık hata", async () => {
    const t = await makeTenant("commerce");
    const other = await makeTenant("commerce");
    const d = `https://${t.brand.domain}`;
    const p = await db.product.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, externalId: "Y2", name: "Yastık", description: "Elle yazılmış açıklama", url: `${d}/yastik`, source: "csv" } });
    await db.productVariant.create({ data: { workspaceId: t.ws.id, productId: p.id, externalId: "Y2", priceMinor: 89900n, currency: "TRY", available: true } });
    await crawlWith(t, [{ url: `${d}/yastik`, html: ld("Yastık", null, "Y2"), pageType: "product" }, { url: `${d}/yeni`, html: ld("Yeni", "10", "N1"), pageType: "product" }]);
    await importCandidates(db, { workspaceId: t.ws.id, brandId: t.brand.id }, [`${d}/yastik`], { brandDomain: t.brand.domain, catalogLimit: 500 });
    const after = await db.product.findUniqueOrThrow({ where: { id: p.id }, include: { variants: true } });
    expect(after.description).toBe("Elle yazılmış açıklama");
    expect(after.variants[0]!.priceMinor).toBe(89900n);
    expect(await db.product.count({ where: { brandId: other.brand.id } })).toBe(0);
    await expect(importCandidates(db, { workspaceId: t.ws.id, brandId: t.brand.id }, [`${d}/yeni`], { brandDomain: t.brand.domain, catalogLimit: 1 })).rejects.toMatchObject({ code: "quota_exceeded" });
  });
});

describe("otomatik aktarım", () => {
  it("taramadan sonra bilgisi tam ürünler kataloğa eklenir, eksikler aday kalır; tekrar mükerrer oluşturmaz; limit aşılmaz", async () => {
    const t = await makeTenant("commerce");
    const d = `https://${t.brand.domain}`;
    // Aynı ürün şemada iki kez (tema + uygulama) yer alsa da tek ürün sayılır.
    await crawlWith(t, [
      { url: `${d}/products/kase`, html: ld("Kase", "250", "K1") + ld("Kase", "250", "K1"), pageType: "product" },
      { url: `${d}/products/tabak`, html: ld("Tabak", "300", "T1"), pageType: "product" },
      { url: `${d}/products/yastik`, html: ld("Yastık", null, "Y2"), pageType: "product" },
    ]);
    const ids = { workspaceId: t.ws.id, brandId: t.brand.id };
    expect(await autoImportComplete(db, ids, { catalogLimit: 500 })).toMatchObject({ imported: 2, overLimit: 0 });
    expect((await db.product.findMany({ where: { brandId: t.brand.id }, select: { name: true } })).map((p) => p.name).sort()).toEqual(["Kase", "Tabak"]);
    const list = await listCandidates(db, ids);
    expect(list.candidates.find((c) => c.name === "Yastık")?.status).toBe("incomplete");
    expect(await autoImportComplete(db, ids, { catalogLimit: 500 })).toMatchObject({ imported: 0, updated: 2 });
    expect(await db.product.count({ where: { brandId: t.brand.id } })).toBe(2);
  });

  it("ücretsiz ölçüm ürünleri hesaba kaydedilince aktarılır; paket limiti aşılmaz", async () => {
    const t = await makeTenant("commerce");
    const d = `https://${t.brand.domain}`;
    const facts = (name: string, price: string | null) => ({ name, description: null, category: null, price, currency: "TRY", availability: "InStock", sku: null, image: null, url: null });
    const r = await importProductFacts(db, { workspaceId: t.ws.id, brandId: t.brand.id }, [{ pageUrl: `${d}/a`, facts: facts("A", "10") }, { pageUrl: `${d}/b`, facts: facts("B", "20") }, { pageUrl: `${d}/c`, facts: facts("C", null) }], { catalogLimit: 1 });
    expect(r).toMatchObject({ imported: 1, overLimit: 1 });
    expect(await db.product.count({ where: { brandId: t.brand.id } })).toBe(1);
  });

  it("ana sayfa adresi girilirse açık yönlendirme verilir (istek atılmadan)", async () => {
    const r = await previewProductUrl("https://www.chakra.com.tr/", "chakra.com.tr");
    expect(r.candidate).toBeNull();
    expect(r.reason).toMatch(/ana sayfa/);
  });
});
