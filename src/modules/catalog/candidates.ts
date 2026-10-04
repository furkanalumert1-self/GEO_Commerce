import type { PrismaClient } from "@/generated/prisma/client";
import { parseMoneyMinor } from "@/adapters/commerce/csv";
import type { NormalizedProduct } from "@/adapters/commerce/types";
import { availabilityFlag, extractPage, type ProductFacts } from "@/modules/audit/html";
import { safeFetch } from "@/lib/http/safe-fetch";
import { AppError } from "@/lib/http/errors";

/**
 * Ürün keşfi → önizleme → onaylı aktarım. Tarama ürün adaylarını sayfa kaydına (findings.productCandidates)
 * yazar; katalog yalnız kullanıcı seçip onayladığında değişir. Mağazanın sitesine hiçbir şey yazılmaz.
 */
export type CandidateStatus = "new" | "update" | "imported" | "incomplete" | "review";

export interface ProductCandidate {
  url: string;
  name: string;
  image: string | null;
  category: string | null;
  priceMinor: string | null; // BigInt JSON uyumu için metin
  currency: string | null;
  available: boolean | null;
  sku: string | null;
  source: "schema" | "meta";
  sampledAt: string;
  status: CandidateStatus;
  /** Durumun tek cümlelik nedeni (eksik alan, değişen fiyat vb.). */
  note: string | null;
  missing: string[];
}

/** Aynı ürünün farklı yazımlarını eşlemek için URL normalizasyonu (şema/host/sonda eğik çizgi/izleme parametreleri). */
export function normalizeProductUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid|ref$)/i.test(k)) u.searchParams.delete(k);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Aday için yalnız ürün sayfasında, tek ürün bildiren ve adı olan kayıt kabul edilir; kategori listeleri ürün sayılmaz. */
export function candidateFacts(pageType: string, products: ProductFacts[]): ProductFacts | null {
  if (pageType !== "product" || products.length !== 1) return null;
  const p = products[0]!;
  return p.name ? p : null;
}

type Existing = { externalId: string; url: string | null; name: string; variants: Array<{ priceMinor: bigint | null; currency: string | null; available: boolean | null }> };

/** Saf durum hesabı: mevcut katalogla karşılaştırma ve eksik alanlar. */
export function candidateStatus(c: { url: string; sku: string | null; name: string; priceMinor: bigint | null; currency: string | null; available: boolean | null }, existing: Existing[], pageType = "product"): { status: CandidateStatus; note: string | null; missing: string[] } {
  const missing = [...(c.priceMinor === null ? ["fiyat"] : []), ...(c.available === null ? ["stok"] : [])];
  if (pageType !== "product") return { status: "review", note: "Ürün sayfası olduğu doğrulanmadı", missing };
  const key = normalizeProductUrl(c.url);
  const match = existing.find((e) => (c.sku && e.externalId === c.sku) || e.externalId === c.url || (e.url && normalizeProductUrl(e.url) === key));
  if (match) {
    const v = match.variants[0];
    const changes: string[] = [];
    if (match.name !== c.name) changes.push("ad");
    if (c.priceMinor !== null && v?.priceMinor !== c.priceMinor) changes.push("fiyat");
    if (c.available !== null && v?.available !== c.available) changes.push("stok");
    return changes.length ? { status: "update", note: `Değişen: ${changes.join(", ")}`, missing } : { status: "imported", note: null, missing };
  }
  if (missing.length) return { status: "incomplete", note: `Sayfada okunamadı: ${missing.join(", ")}`, missing };
  return { status: "new", note: null, missing };
}

function toCandidateBase(url: string, f: ProductFacts) {
  return {
    url: f.url && /^https?:/.test(f.url) ? f.url : url,
    pageUrl: url,
    name: f.name!.trim(),
    image: f.image,
    category: f.category,
    priceMinor: parseMoneyMinor(f.price ?? undefined),
    currency: f.price ? f.currency : null,
    available: availabilityFlag(f.availability),
    sku: f.sku,
    source: f.source ?? "schema",
  };
}

export interface CandidateSummary {
  pagesRead: number;
  pagesFailed: number;
  candidates: ProductCandidate[];
  lastCrawlAt: Date | null;
  truncated: boolean;
}

export async function listCandidates(db: PrismaClient, ids: { workspaceId: string; brandId: string }): Promise<CandidateSummary> {
  const [snaps, existing, lastRun] = await Promise.all([
    db.pageSnapshot.findMany({ where: { workspaceId: ids.workspaceId, brandId: ids.brandId, pageType: "product" }, orderBy: { sampledAt: "desc" }, distinct: ["url"], take: 1000, select: { url: true, pageType: true, findings: true, sampledAt: true } }),
    db.product.findMany({ where: { workspaceId: ids.workspaceId, brandId: ids.brandId }, select: { externalId: true, url: true, name: true, variants: { take: 1, select: { priceMinor: true, currency: true, available: true } } } }),
    db.crawlRun.findFirst({ where: { workspaceId: ids.workspaceId, brandId: ids.brandId }, orderBy: { createdAt: "desc" }, select: { pagesDone: true, pagesFailed: true, finishedAt: true, createdAt: true, maxPages: true, status: true } }),
  ]);
  const candidates: ProductCandidate[] = [];
  const seen = new Set<string>();
  for (const s of snaps) {
    const list = ((s.findings as { productCandidates?: ProductFacts[] } | null)?.productCandidates ?? []) as ProductFacts[];
    const f = candidateFacts(s.pageType ?? "other", list);
    if (!f) continue;
    const b = toCandidateBase(s.url, f);
    const key = normalizeProductUrl(b.url);
    if (seen.has(key)) continue; // canonical/yazım farkı olan aynı ürün bir kez listelenir
    seen.add(key);
    const st = candidateStatus(b, existing, s.pageType ?? "other");
    candidates.push({ url: b.url, name: b.name, image: b.image, category: b.category, priceMinor: b.priceMinor?.toString() ?? null, currency: b.currency, available: b.available, sku: b.sku, source: b.source, sampledAt: s.sampledAt.toISOString(), ...st });
  }
  return {
    pagesRead: lastRun?.pagesDone ?? 0,
    pagesFailed: lastRun?.pagesFailed ?? 0,
    candidates,
    lastCrawlAt: lastRun ? (lastRun.finishedAt ?? lastRun.createdAt) : null,
    truncated: lastRun ? lastRun.pagesDone >= lastRun.maxPages || lastRun.status === "partial" : false,
  };
}

/** Kullanıcının eklediği tek ürün bağlantısı: aynı alan adı, SSRF korumalı getirme, aynı çıkarım; yazma yok. */
export async function previewProductUrl(url: string, brandDomain: string): Promise<{ candidate: ReturnType<typeof toCandidateBase> | null; reason: string | null }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new AppError("validation_error", "Geçerli bir ürün bağlantısı girin", { fieldErrors: { url: ["Geçerli bir bağlantı girin"] } });
  }
  const d = brandDomain.replace(/^www\./, "");
  const host = u.hostname.replace(/^www\./, "");
  if (u.protocol !== "https:" || (host !== d && !host.endsWith(`.${d}`))) throw new AppError("validation_error", `Bağlantı ${d} alan adınızda ve https olmalı`, { fieldErrors: { url: [`${d} alan adında bir https bağlantısı girin`] } });
  const r = await safeFetch(u.toString(), { sameSiteAs: d, maxBytes: 1_500_000, timeoutMs: 10_000, maxRedirects: 4 });
  if (r.status >= 400) return { candidate: null, reason: `Sayfa açılamadı (HTTP ${r.status})` };
  const facts = extractPage(r.body, r.url);
  const f = facts.products.length === 1 ? facts.products[0]! : null;
  if (!f?.name) return { candidate: null, reason: facts.products.length > 1 ? "Bu bir kategori/liste sayfası; tek ürün sayfası girin" : "Sayfada ürün bilgisi (ad ve fiyat/stok/görsel) bulunamadı" };
  return { candidate: toCandidateBase(r.url, f), reason: null };
}

/**
 * Seçilen adayları kataloğa aktarır. Mükerrer kontrolü: SKU / ürün kodu / normalize URL. Boş alan dolu veriyi
 * ezmez; taramada çıkmayan ürünler silinmez veya stok dışı yapılmaz. Tekrar onay aynı kaydı günceller.
 */
export async function importCandidates(db: PrismaClient, ids: { workspaceId: string; brandId: string }, urls: string[], opts: { brandDomain: string; catalogLimit: number }): Promise<{ imported: number; updated: number; skipped: Array<{ url: string; reason: string }> }> {
  const wanted = [...new Set(urls.map((u) => u.trim()).filter(Boolean))].slice(0, 500);
  const snaps = await db.pageSnapshot.findMany({ where: { workspaceId: ids.workspaceId, brandId: ids.brandId, pageType: "product" }, orderBy: { sampledAt: "desc" }, distinct: ["url"], take: 2000, select: { url: true, pageType: true, findings: true } });
  const byKey = new Map<string, ReturnType<typeof toCandidateBase>>();
  for (const s of snaps) {
    const f = candidateFacts(s.pageType ?? "other", ((s.findings as { productCandidates?: ProductFacts[] } | null)?.productCandidates ?? []) as ProductFacts[]);
    if (!f) continue;
    const b = toCandidateBase(s.url, f);
    byKey.set(normalizeProductUrl(b.url), b);
    byKey.set(normalizeProductUrl(s.url), b);
  }
  const skipped: Array<{ url: string; reason: string }> = [];
  const chosen: Array<ReturnType<typeof toCandidateBase>> = [];
  for (const url of wanted) {
    let c = byKey.get(normalizeProductUrl(url)) ?? null;
    if (!c) {
      // Taramada olmayan, kullanıcının eklediği bağlantı: aynı doğrulama ve çıkarımdan geçer.
      try {
        const p = await previewProductUrl(url, opts.brandDomain);
        c = p.candidate;
        if (!c) skipped.push({ url, reason: p.reason ?? "Ürün bilgisi bulunamadı" });
      } catch (e) {
        skipped.push({ url, reason: e instanceof AppError ? e.message : "Sayfa getirilemedi" });
      }
    }
    if (c) chosen.push(c);
  }
  const existing = await db.product.findMany({ where: { workspaceId: ids.workspaceId, brandId: ids.brandId }, select: { id: true, externalId: true, url: true, connectorId: true, active: true } });
  const findExisting = (c: ReturnType<typeof toCandidateBase>) => {
    const key = normalizeProductUrl(c.url);
    return existing.find((e) => (c.sku && e.externalId === c.sku) || e.externalId === c.url || (e.url && normalizeProductUrl(e.url) === key)) ?? null;
  };
  const newOnes = chosen.filter((c) => !findExisting(c));
  const activeCount = existing.filter((e) => e.active).length;
  if (activeCount + newOnes.length > opts.catalogLimit) throw new AppError("quota_exceeded", `Ürün limiti aşılıyor: paketiniz ${opts.catalogLimit} ürüne izin veriyor; ${opts.catalogLimit - activeCount} yeni ürün ekleyebilirsiniz`, { limit: opts.catalogLimit, used: activeCount });
  let imported = 0;
  let updated = 0;
  for (const c of chosen) {
    const ex = findExisting(c);
    const p: NormalizedProduct = {
      externalId: ex?.externalId ?? c.sku ?? c.url,
      name: c.name,
      description: null,
      url: c.url,
      imageUrl: c.image,
      categoryExternalIds: c.category ? [c.category] : [],
      variants: [{ externalId: c.sku ?? c.url, sku: c.sku, priceMinor: c.priceMinor, currency: c.currency, stock: null, available: c.available }],
    };
    await upsertMerged(db, ids, p, ex);
    if (ex) updated++;
    else imported++;
  }
  return { imported, updated, skipped };
}

/** Yalnız dolu alanları yazar (boş/belirsiz alan mevcut veriyi ezmez). */
async function upsertMerged(db: PrismaClient, ids: { workspaceId: string; brandId: string }, p: NormalizedProduct, ex: { id: string; connectorId: string | null } | null) {
  const set = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
  const product = ex
    ? await db.product.update({ where: { id: ex.id }, data: set({ name: p.name, url: p.url, imageUrl: p.imageUrl }) })
    : await db.product.create({ data: { workspaceId: ids.workspaceId, brandId: ids.brandId, connectorId: null, externalId: p.externalId, name: p.name, description: p.description, url: p.url, imageUrl: p.imageUrl, source: "crawl" } });
  const v = p.variants[0]!;
  const variants = await db.productVariant.findMany({ where: { productId: product.id }, select: { id: true } });
  // Birden çok varyantlı ürün (boy/renk) tek sayfa fiyatıyla birleştirilmez; yalnız tek varyantlı kayıt güncellenir.
  if (variants.length === 1) await db.productVariant.update({ where: { id: variants[0]!.id }, data: set({ sku: v.sku, priceMinor: v.priceMinor, currency: v.currency, available: v.available }) });
  else if (variants.length === 0) await db.productVariant.create({ data: { workspaceId: ids.workspaceId, productId: product.id, externalId: v.externalId, sku: v.sku, priceMinor: v.priceMinor, currency: v.currency, stock: null, available: v.available } });
  for (const catName of p.categoryExternalIds) {
    const cat = (await db.category.findFirst({ where: { brandId: ids.brandId, OR: [{ externalId: catName }, { name: catName }] } })) ?? (await db.category.create({ data: { workspaceId: ids.workspaceId, brandId: ids.brandId, connectorId: null, externalId: catName, name: catName, url: null } }));
    await db.productCategory.upsert({ where: { productId_categoryId: { productId: product.id, categoryId: cat.id } }, update: {}, create: { productId: product.id, categoryId: cat.id } });
  }
}
