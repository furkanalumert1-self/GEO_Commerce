import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap, Td, Th, cn } from "@/components/ui";
import { Pager, pageParams } from "@/components/data/pager";
import { ApiButton } from "@/components/forms/api-button";
import { CsvImportForm } from "@/components/forms/csv-import";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { JobStartButton } from "@/components/forms/job-start-button";
import { executionMode } from "@/lib/queue";

export const metadata: Metadata = { title: "Katalog" };

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
  const [products, productTotal, categories, pages, pageTotal, lastCrawl, integrations] = await Promise.all([
    tab === "products" ? db.product.findMany({ where: productWhere, include: { variants: { take: 1 }, categories: { include: { category: { select: { name: true } } } } }, orderBy: { name: "asc" }, skip, take: pageSize }) : [],
    db.product.count({ where: productWhere }),
    tab === "categories" ? db.category.findMany({ where: { brandId }, include: { _count: { select: { products: true } } }, orderBy: { name: "asc" } }) : [],
    tab === "pages" ? db.pageSnapshot.findMany({ where: { brandId }, orderBy: { sampledAt: "desc" }, skip, take: pageSize }) : [],
    db.pageSnapshot.count({ where: { brandId } }),
    db.crawlRun.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
    db.integration.findMany({ where: { brandId }, select: { provider: true, status: true, lastSyncAt: true } }),
  ]);

  const tabLink = (t: string, label: string) => (
    <Link href={`${base}?tab=${t}`} aria-current={tab === t ? "page" : undefined} className={cn("inline-flex min-h-11 items-center border-b-2 px-3 text-sm sm:min-h-9", tab === t ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-text")}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Katalog"
        description={`Ürünler, kategoriler ve taranan URL'ler. Son tarama: ${lastCrawl ? fmtDate(lastCrawl.finishedAt ?? lastCrawl.createdAt, access.brand.timezone, "tr-TR", true) : "henüz yok"}.`}
        action={<JobStartButton url={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/crawls`} body={{ maxPages: 50 }} label="Siteyi yeniden tara" inline={executionMode() === "inline"} queuedMessage="Tarama kuyruğa alındı" runningLabel="Site taraması" />}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {integrations.map((i) => (
          <Badge key={i.provider} tone={i.status === "healthy" ? "success" : i.status === "reauth_required" || i.status === "degraded" ? "warning" : "neutral"}>
            {i.provider}: {i.status}
          </Badge>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap gap-1 border-b border-border px-2" role="tablist" aria-label="Katalog görünümü">
          {tabLink("products", `Ürünler (${fmtNumber(productTotal)})`)}
          {tabLink("categories", "Kategoriler")}
          {tabLink("pages", `URL'ler (${fmtNumber(pageTotal)})`)}
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
              <EmptyState title={q || stock ? "Sonuç yok" : "Katalog boş"} description={q || stock ? "Filtrelere uyan ürün yok." : "Siteyi tarayın veya CSV/feed ile ürün içe aktarın."} />
            ) : (
              <TableWrap label="Ürünler">
                <thead>
                  <tr>
                    <Th>Ürün</Th>
                    <Th>Kategori</Th>
                    <Th>SKU</Th>
                    <Th numeric>Fiyat</Th>
                    <Th>Stok</Th>
                    <Th>Kaynak</Th>
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
                        <Td className="text-muted">{p.source}</Td>
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
            <TableWrap label="Taranan URL'ler">
              <thead>
                <tr>
                  <Th>URL</Th>
                  <Th>Tür</Th>
                  <Th>Şema</Th>
                  <Th>Durum</Th>
                  <Th>Örnekleme</Th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => {
                  const f = p.findings as { productComplete?: boolean | null; noindex?: boolean } | null;
                  return (
                    <tr key={p.id}>
                      <Td className="max-w-[28rem] truncate" title={p.url}>{p.url}</Td>
                      <Td>{p.pageType ?? "—"}</Td>
                      <Td className="text-muted">{p.schemaTypes.join(", ") || "—"}</Td>
                      <Td>
                        {p.excluded ? <Badge>Hariç</Badge> : f?.noindex ? <Badge tone="danger">noindex</Badge> : f?.productComplete === false ? <Badge tone="warning">Eksik Offer</Badge> : <Badge tone="success">OK</Badge>}
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
      <Card className="mt-6">
        <CardHeader title="CSV / feed içe aktarma" description="Tüm platformlarda kullanılabilen, açıkça etiketli yedek yöntem. Sütun eşlemesini aşağıda belirtin." />
        <div className="p-4">
          <CsvImportForm url={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/catalog/import`} />
        </div>
      </Card>
    </>
  );
}
