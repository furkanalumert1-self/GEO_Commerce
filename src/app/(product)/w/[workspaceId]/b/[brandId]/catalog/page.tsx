import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap, Td, Th, cn } from "@/components/ui";
import { Pager, pageParams } from "@/components/data/pager";
import { ApiButton } from "@/components/forms/api-button";
import { CsvImportForm } from "@/components/forms/csv-import";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { JobStartButton } from "@/components/forms/job-start-button";
import { executionMode } from "@/lib/queue";
import { ProductCandidates } from "@/components/forms/product-candidates";
import { listCandidates, normalizeProductUrl } from "@/modules/catalog/candidates";

export const metadata: Metadata = { title: "Ürünlerim" };

const SOURCE_LABEL: Record<string, string> = { crawl: "Site incelemesi", feed: "Ürün dosyası", csv: "Ürün dosyası", connector: "Mağaza bağlantısı" };
const PROVIDER_LABEL: Record<string, string> = { shopify: "Shopify", ikas: "ikas", ticimax: "Ticimax", ideasoft: "IdeaSoft", csv_feed: "Ürün/sipariş dosyası", openai_ads: "ChatGPT Ads" };

export default async function CatalogPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const tab = sp.tab === "categories" || sp.tab === "pages" ? sp.tab : "products";
  const { page, pageSize, skip } = pageParams(sp);
  const stock = sp.stock === "out" ? "out" : sp.stock === "in" ? "in" : null;
  const q = sp.q?.slice(0, 80);
  const base = `/w/${workspaceId}/b/${brandId}/catalog`;

  const productWhere = {
    brandId,
    workspaceId,
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    ...(stock === "out" ? { variants: { some: { available: false } } } : stock === "in" ? { variants: { some: { available: true } } } : {}),
  };
  const [products, productTotal, categories, pages, pageTotal, lastCrawl, integrations, productPageCount, activeProducts] = await Promise.all([
    tab === "products" ? db.product.findMany({ where: productWhere, include: { variants: { take: 1 }, categories: { include: { category: { select: { name: true } } } } }, orderBy: { name: "asc" }, skip, take: pageSize }) : [],
    db.product.count({ where: productWhere }),
    tab === "categories" ? db.category.findMany({ where: { brandId }, include: { _count: { select: { products: true } } }, orderBy: { name: "asc" } }) : [],
    tab === "pages" ? db.pageSnapshot.findMany({ where: { brandId }, orderBy: { sampledAt: "desc" }, skip, take: pageSize }) : [],
    db.pageSnapshot.count({ where: { brandId } }),
    db.crawlRun.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
    db.integration.findMany({ where: { brandId }, select: { provider: true, status: true, lastSyncAt: true } }),
    db.pageSnapshot.count({ where: { brandId, pageType: "product" } }),
    db.product.count({ where: { brandId, workspaceId } }),
  ]);
  const discovery = await listCandidates(db, { workspaceId, brandId });
  const pending = discovery.candidates.filter((c) => c.status !== "imported");
  const importedCount = discovery.candidates.length - pending.length;
  const reviewCount = discovery.candidates.filter((c) => c.status === "incomplete" || c.status === "review").length;
  // Yarım kalan işe dönüş yalnız uygulama içi yoldan (açık yönlendirme yok).
  const returnHref = sp.return && /^\/w\/[0-9a-f-]{36}\/b\/[0-9a-f-]{36}\//.test(sp.return) ? sp.return : null;
  const importedUrls = new Set((await db.product.findMany({ where: { brandId, workspaceId, url: { not: null } }, select: { url: true }, take: 5000 })).map((p) => normalizeProductUrl(p.url!)));
  // "Tarandı ama ürün yok": nedeni sayfa türünden söylenir; çözüm yeniden tarama değil, ürün dosyası/mağaza bağlantısıdır.
  const emptyReason =
    activeProducts > 0 || pageTotal === 0 || discovery.candidates.length > 0
      ? null
      : productPageCount === 0
        ? `${fmtNumber(pageTotal)} sayfa incelendi ancak hiçbiri ürün sayfası olarak tanınmadı. Ürün sayfalarınızda ürün bilgisi işaretlemesi (ad, fiyat, stok) olmayabilir veya ürün sayfaları ilk incelenen sayfalar arasına girmemiş olabilir. Yeni incelemede ürün sayfaları önceliklidir.`
        : `${fmtNumber(productPageCount)} ürün sayfası bulundu ancak ürün adı/fiyatı okunamadı (sayfalarda ürün bilgisi işaretlemesi eksik).`;

  const tabLink = (t: string, label: string) => (
    <Link href={`${base}?tab=${t}`} aria-current={tab === t ? "page" : undefined} className={cn("inline-flex min-h-11 items-center border-b-2 px-3 text-sm sm:min-h-9", tab === t ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-text")}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Ürünlerim"
        description={`Taslaklarda kullanılan ürün bilgileri. Son site incelemesi: ${lastCrawl ? fmtDate(lastCrawl.finishedAt ?? lastCrawl.createdAt, access.brand.timezone, "tr-TR", true) : "henüz yok"}.`}
        action={<JobStartButton url={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/crawls`} body={{ maxPages: 50 }} label="Siteyi incele ve ürünleri bul" inline={executionMode() === "inline"} queuedMessage="Tarama kuyruğa alındı" runningLabel="Site taraması" />}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {integrations.map((i) => (
          <Badge key={i.provider} tone={i.status === "healthy" ? "success" : i.status === "reauth_required" || i.status === "degraded" ? "warning" : "neutral"}>
            {PROVIDER_LABEL[i.provider] ?? i.provider}: {i.status === "healthy" ? "bağlı" : i.status === "reauth_required" ? "yeniden yetki gerekli" : i.status === "degraded" ? "sorunlu" : "kurulmadı"}
          </Badge>
        ))}
      </div>
      {emptyReason ? (
        <div className="mb-4">
          <Alert tone="warning" title="Ürün bulunamadı">
            {emptyReason} <a className="font-medium text-primary underline" href="#adaylar">Ürün bağlantısı ekleyin</a>, <a className="font-medium text-primary underline" href="#urun-aktar">ürün dosyanızı yükleyin</a> veya mağazanızı <Link className="font-medium text-primary underline" href={`/w/${workspaceId}/b/${brandId}/integrations`}>bağlayın</Link>.
          </Alert>
        </div>
      ) : null}
      {discovery.candidates.length > 0 || activeProducts === 0 || (discovery.lastCrawlAt && discovery.pagesRead === 0) ? (
        <Card className="mb-6" id="adaylar">
          <CardHeader
            title="Bulunan ürün adayları"
            description={
              discovery.lastCrawlAt
                ? `Son inceleme: ${fmtNumber(discovery.pagesRead)} sayfa okundu${discovery.pagesFailed ? `, ${fmtNumber(discovery.pagesFailed)} sayfa erişilemedi` : ""}; ${fmtNumber(discovery.candidates.length)} ürün adayı bulundu, ${fmtNumber(importedCount)} aktarıldı, ${fmtNumber(reviewCount)} inceleme bekliyor.${discovery.pagesRead === 0 && discovery.pagesFailed > 0 ? " Hiç sayfa okunamadı: siteniz otomatik ziyaretleri (bot koruması/WAF, ör. Cloudflare) engelliyor olabilir. Güvenlik duvarınızda CallypsoBot'a izin verin veya aşağıdan ürün dosyası (CSV) yükleyin." : ""}${discovery.truncated ? " Tüm mağaza taranmadı (sayfa/süre sınırı); incelemeyi tekrar başlatarak devam edebilirsiniz." : ""} Bilgisi tam ürünler otomatik eklenir, eksikler onayınızı bekler; sitenize hiçbir şey yazılmaz.`
                : "Siteyi incelediğimizde adı, fiyatı ve stok bilgisi tam olan ürünler kataloğa otomatik eklenir; bilgisi eksik olanlar burada onayınızı bekler."
            }
          />
          <ProductCandidates api={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/catalog/candidates`} candidates={pending.concat(discovery.candidates.filter((c) => c.status === "imported").slice(0, 20))} returnHref={returnHref} />
        </Card>
      ) : null}
      <Card>
        <div className="flex flex-wrap gap-1 border-b border-border px-2" role="tablist" aria-label="Katalog görünümü">
          {tabLink("products", `Ürünlerim (${fmtNumber(productTotal)})`)}
          {tabLink("categories", "Kategoriler")}
          {tabLink("pages", `İncelenen sayfalar (${fmtNumber(pageTotal)})`)}
        </div>
        {tab === "products" ? (
          <>
            <form className="flex flex-wrap items-end gap-2 px-4 py-3" action={base}>
              <input type="hidden" name="tab" value="products" />
              <label className="flex flex-col gap-1 text-sm">
                <span>Ara</span>
                <input name="q" defaultValue={q} className="min-h-11 rounded-md border border-border px-2 sm:min-h-9" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Stok</span>
                <select name="stock" defaultValue={stock ?? ""} className="min-h-11 rounded-md border border-border px-2 sm:min-h-9">
                  <option value="">Tümü</option>
                  <option value="in">Stokta</option>
                  <option value="out">Stokta yok</option>
                </select>
              </label>
              <button className="min-h-11 rounded-md border border-border px-3 text-sm sm:min-h-9" type="submit">Uygula</button>
              {q || stock ? <Link className="min-h-9 py-2 text-sm text-primary underline" href={base}>Filtreleri sıfırla</Link> : null}
            </form>
            {products.length === 0 ? (
              <EmptyState title={q || stock ? "Sonuç yok" : "Katalog boş"} description={q || stock ? "Filtrelere uyan ürün yok." : "Ürün dosyanızı aşağıdan yükleyin veya mağazanızı bağlayın."} />
            ) : (
              <TableWrap label="Ürünler">
                <thead>
                  <tr>
                    <Th>Ürün</Th>
                    <Th>Kategori</Th>
                    <Th>SKU</Th>
                    <Th numeric>Fiyat</Th>
                    <Th>Stok</Th>
                    <Th>Nereden</Th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const v = p.variants[0];
                    return (
                      <tr key={p.id}>
                        <Td>{p.url ? <a className="text-primary hover:underline" href={p.url} rel="noopener noreferrer" target="_blank">{p.name}</a> : p.name}</Td>
                        <Td>{p.categories.map((c) => c.category.name).join(", ") || "—"}</Td>
                        <Td className="text-muted">{v?.sku ?? "—"}</Td>
                        <Td numeric>{v?.priceMinor != null && v.currency ? fmtMoney(v.priceMinor, v.currency) : "Ölçülemedi"}</Td>
                        <Td>{v?.available == null ? <Badge>Bilinmiyor</Badge> : v.available ? <Badge tone="success">Stokta</Badge> : <Badge tone="danger">Yok</Badge>}</Td>
                        <Td className="text-muted">{SOURCE_LABEL[p.source] ?? p.source}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
            <Pager basePath={base} sp={{ ...sp, tab: "products" }} page={page} pageSize={pageSize} total={productTotal} />
          </>
        ) : null}
        {tab === "categories" ? (
          <TableWrap label="Kategoriler">
            <thead>
              <tr>
                <Th>Kategori</Th>
                <Th numeric>Ürün</Th>
                <Th>URL</Th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <Td>{c.name}</Td>
                  <Td numeric>{c._count.products}</Td>
                  <Td className="text-muted">{c.url ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : null}
        {tab === "pages" ? (
          <>
            <TableWrap label="İncelenen sayfalar">
              <thead>
                <tr>
                  <Th>Sayfa</Th>
                  <Th>Tür</Th>
                  <Th>Yapılandırılmış veri</Th>
                  <Th>Durum</Th>
                  <Th>Örnekleme</Th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => {
                  const f = p.findings as { productComplete?: boolean | null; noindex?: boolean; productCandidates?: Array<{ url?: string | null; price?: string | null }> } | null;
                  const cand = f?.productCandidates?.[0];
                  const pageState = p.excluded ? "Hariç" : cand ? (importedUrls.has(normalizeProductUrl(cand.url ?? p.url)) || importedUrls.has(normalizeProductUrl(p.url)) ? "Aktarıldı" : !cand.price ? "Bilgi eksik" : "Ürün adayı bulundu") : "Sayfa okundu";
                  return (
                    <tr key={p.id}>
                      <Td className="max-w-[28rem] truncate" title={p.url}>{p.url}</Td>
                      <Td>{p.pageType ?? "—"}</Td>
                      <Td className="text-muted">{p.schemaTypes.join(", ") || "—"}</Td>
                      <Td>
                        <Badge tone={pageState === "Aktarıldı" ? "success" : pageState === "Ürün adayı bulundu" ? "primary" : pageState === "Bilgi eksik" ? "warning" : "neutral"}>{pageState}</Badge>
                        {f?.noindex ? <span className="ml-1 text-xs text-danger">arama motorlarına kapalı</span> : null}
                      </Td>
                      <Td className="text-muted">{fmtDate(p.sampledAt, access.brand.timezone)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
            <Pager basePath={base} sp={{ ...sp, tab: "pages" }} page={page} pageSize={pageSize} total={pageTotal} />
          </>
        ) : null}
      </Card>
      <Card className="mt-6" id="urun-aktar">
        <CardHeader title="Ürün dosyası içe aktarma" description="Mağaza panelinizden ürün listesini CSV olarak dışa aktarıp yükleyin. Örnek dosyayı indirip sütunları karşılaştırabilirsiniz." />
        <div className="p-4">
          <CsvImportForm url={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/catalog/import`} initialKind={sp.import === "orders" ? "orders" : "products"} />
        </div>
      </Card>
    </>
  );
}
