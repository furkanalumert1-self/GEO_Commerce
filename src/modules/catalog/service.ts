import type { PrismaClient } from "@/generated/prisma/client";
import type { CrawlResult } from "@/modules/audit/crawler";
import { parseMoneyMinor } from "@/adapters/commerce/csv";
import type { NormalizedProduct } from "@/adapters/commerce/types";

/**
 * Crawl/feed/CSV'den katalog kalıcılaştırma. Bilgi yoksa null; external ID connector bazında unique.
 */
export async function persistCrawl(db: PrismaClient, ids: { workspaceId: string; brandId: string; crawlRunId: string }, crawl: CrawlResult) {
  const now = new Date();
  for (const p of crawl.pages) {
    const productComplete = p.facts.products.length === 0 ? null : p.facts.products.every((x) => x.name && x.price && x.currency && x.availability);
    await db.pageSnapshot.upsert({
      where: { crawlRunId_url: { crawlRunId: ids.crawlRunId, url: p.url } },
      update: {},
      create: {
        workspaceId: ids.workspaceId,
        brandId: ids.brandId,
        crawlRunId: ids.crawlRunId,
        url: p.url,
        canonical: p.canonical,
        pageType: p.pageType,
        httpStatus: p.status,
        contentHash: p.contentHash,
        etag: p.etag,
        title: p.facts.title,
        schemaTypes: p.facts.schemaTypes,
        findings: { productComplete, noindex: p.facts.robotsNoindex, textLength: p.facts.textLength, trackers: p.facts.trackers },
        sampledAt: now,
      },
    });
  }
  const products: NormalizedProduct[] = crawl.pages.flatMap((pg) =>
    pg.facts.products.map((x) => ({
      externalId: x.sku ?? pg.url,
      name: x.name ?? pg.facts.title ?? pg.url,
      description: x.description,
      url: x.url ?? pg.url,
      imageUrl: x.image,
      categoryExternalIds: x.category ? [x.category] : [],
      variants: [{ externalId: x.sku ?? pg.url, sku: x.sku, priceMinor: parseMoneyMinor(x.price ?? undefined), currency: x.currency, stock: null, available: x.availability ? /InStock/i.test(x.availability) : null }],
    })),
  );
  const categoryPages = crawl.pages.filter((p) => p.pageType === "category");
  for (const c of categoryPages) {
    const name = c.facts.h1 ?? c.facts.title ?? c.url;
    await upsertCategory(db, ids, { externalId: c.url, name, url: c.url });
  }
  await upsertProducts(db, ids, products, "crawl", null);
  await db.crawlRun.update({ where: { id: ids.crawlRunId }, data: { status: "succeeded", pagesDone: crawl.pages.length, pagesFailed: crawl.failed.length, pagesFound: crawl.pages.length + crawl.failed.length, finishedAt: now } });
}

async function upsertCategory(db: PrismaClient, ids: { workspaceId: string; brandId: string }, c: { externalId: string; name: string; url: string | null }, connectorId: string | null = null) {
  const existing = await db.category.findFirst({ where: { brandId: ids.brandId, connectorId, externalId: c.externalId } });
  if (existing) return db.category.update({ where: { id: existing.id }, data: { name: c.name, url: c.url } });
  return db.category.create({ data: { workspaceId: ids.workspaceId, brandId: ids.brandId, connectorId, externalId: c.externalId, name: c.name, url: c.url } });
}

export async function upsertProducts(db: PrismaClient, ids: { workspaceId: string; brandId: string }, products: NormalizedProduct[], source: string, connectorId: string | null) {
  let count = 0;
  for (const p of products) {
    const existing = await db.product.findFirst({ where: { brandId: ids.brandId, connectorId, externalId: p.externalId } });
    const data = { name: p.name, description: p.description, url: p.url, imageUrl: p.imageUrl, source };
    const product = existing
      ? await db.product.update({ where: { id: existing.id }, data })
      : await db.product.create({ data: { ...data, workspaceId: ids.workspaceId, brandId: ids.brandId, connectorId, externalId: p.externalId } });
    for (const v of p.variants) {
      await db.productVariant.upsert({
        where: { productId_externalId: { productId: product.id, externalId: v.externalId } },
        update: { sku: v.sku, priceMinor: v.priceMinor, currency: v.currency, stock: v.stock, available: v.available },
        create: { workspaceId: ids.workspaceId, productId: product.id, externalId: v.externalId, sku: v.sku, priceMinor: v.priceMinor, currency: v.currency, stock: v.stock, available: v.available },
      });
    }
    for (const catName of p.categoryExternalIds) {
      const cat = (await db.category.findFirst({ where: { brandId: ids.brandId, OR: [{ externalId: catName }, { name: catName }] } })) ?? (await upsertCategory(db, ids, { externalId: catName, name: catName, url: null }, connectorId));
      await db.productCategory.upsert({ where: { productId_categoryId: { productId: product.id, categoryId: cat.id } }, update: {}, create: { productId: product.id, categoryId: cat.id } });
    }
    count++;
  }
  return count;
}
