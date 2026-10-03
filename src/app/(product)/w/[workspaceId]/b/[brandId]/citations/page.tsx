import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/layout/filter-bar";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { parseRange } from "@/modules/monitoring/queries";
import { isCompetitorCandidate } from "@/modules/audit/competitor-filter";

const SOURCE_TYPE_LABEL: Record<string, string> = { own: "Şirket sitesi", media: "Haber / medya", review: "İnceleme sitesi", blog: "Blog", directory: "Rehber / dizin", forum: "Forum", industry: "Sektör sitesi", other: "Diğer" };

export const metadata: Metadata = { title: "Kaynaklar" };

/**
 * Citation gap: rakibi destekleyen üçüncü taraf kaynaklar vs kendi marka bağlantısı.
 * Site sayısı ile URL sayısı ayrı; outreach görevi CSV ile dışa aktarılır (otomatik e-posta yok).
 */
export default async function CitationsPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const range = parseRange(sp);
  const onlyGap = sp.gap === "1";
  const cits = await db.citation.findMany({
    where: { workspaceId, observation: { brandId, status: "succeeded", sampledAt: { gte: range.from, lte: range.to } } },
    select: { domain: true, canonicalUrl: true, association: true, sourceType: true, observationId: true, observation: { select: { sampledAt: true, mentions: { select: { entityId: true, entityType: true } } } } },
  });
  const byDomain = new Map<string, { association: string; sourceType: string | null; urls: Set<string>; obs: Set<string>; withBrand: number; withCompetitorOnly: number; last: Date }>();
  for (const c of cits) {
    const d = byDomain.get(c.domain) ?? { association: c.association, sourceType: c.sourceType, urls: new Set(), obs: new Set(), withBrand: 0, withCompetitorOnly: 0, last: c.observation.sampledAt };
    d.urls.add(c.canonicalUrl);
    if (!d.obs.has(c.observationId)) {
      d.obs.add(c.observationId);
      const brandM = c.observation.mentions.some((m) => m.entityId === brandId);
      const compM = c.observation.mentions.some((m) => m.entityType === "competitor");
      if (brandM) d.withBrand++;
      else if (compM) d.withCompetitorOnly++;
    }
    if (c.observation.sampledAt > d.last) d.last = c.observation.sampledAt;
    byDomain.set(c.domain, d);
  }
  // Üçüncü taraf görünen ticari alan adları çoğu zaman rakip mağazalardır (outreach hedefi değil); ayrı işaretlenir.
  let rows = [...byDomain.entries()].map(([domain, d]) => {
    const likelyCompetitor = d.association === "third_party" && isCompetitorCandidate(domain, access.brand.domain);
    return { domain, ...d, likelyCompetitor, gap: d.association === "third_party" && !likelyCompetitor && d.withCompetitorOnly > 0 && d.withBrand === 0 };
  });
  if (onlyGap) rows = rows.filter((r) => r.gap);
  rows.sort((a, b) => b.withCompetitorOnly - a.withCompetitorOnly || b.obs.size - a.obs.size);
  const base = `/w/${workspaceId}/b/${brandId}/citations`;
  const csvHref = `/api/v1/workspaces/${workspaceId}/brands/${brandId}/citations/export?days=${range.days}`;
  return (
    <>
      <PageHeader title="Kaynaklar (citation)" description="Yanıtlarda atıf yapılan siteler. Bir bağlantının varlığı sayfanın belirli markayı önerdiğini tek başına kanıtlamaz." action={<a className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm hover:bg-bg sm:min-h-9" href={csvHref}>Kaynak listesini indir</a>} />
      <FilterBar basePath={base} sp={sp} timeZone={access.brand.timezone} showEngine={false} />
      <div className="mb-4 flex gap-2 text-sm">
        <Link href={`${base}?range=${sp.range ?? "30"}`} className={onlyGap ? "text-primary underline" : "font-medium"}>Tüm kaynaklar</Link>
        <span aria-hidden>·</span>
        <Link href={`${base}?range=${sp.range ?? "30"}&gap=1`} className={onlyGap ? "font-medium" : "text-primary underline"}>Yalnız citation boşluğu</Link>
      </div>
      <Card>
        <CardHeader title={`${rows.length} site · ${rows.reduce((s, r) => s + r.urls.size, 0)} URL`} description="Boşluk: rakip anılan yanıtlarda atıf yapılan, markanızın anıldığı hiçbir yanıtta görünmeyen yayın, pazaryeri ve inceleme siteleri (outreach hedefi). Olası rakip: başka bir markanın mağazası olabilir; Rakipler sayfasından ekleyebilirsiniz." />
        {rows.length === 0 ? <EmptyState title="Sonuç yok" description="Seçili dönemde kaynak bulunamadı." /> : (
          <TableWrap label="Kaynak siteleri">
            <thead><tr><Th>Site</Th><Th>Site türü</Th><Th>İlişki</Th><Th numeric>URL</Th><Th numeric>Yanıt</Th><Th numeric>Yalnız rakiple</Th><Th numeric>Markanızla</Th></tr></thead>
            <tbody>
              {rows.slice(0, 100).map((r) => (
                <tr key={r.domain}>
                  <Td>{r.domain} {r.gap ? <Badge tone="warning">Boşluk</Badge> : r.likelyCompetitor ? <Badge>Olası rakip</Badge> : null}</Td>
                  <Td className="text-muted">{SOURCE_TYPE_LABEL[r.sourceType ?? ""] ?? r.sourceType ?? "—"}</Td>
                  <Td>{r.association === "own" ? "Kendi" : r.association === "competitor" ? "Rakip sitesi" : r.likelyCompetitor ? "Ticari site (rakip olabilir)" : "Üçüncü taraf"}</Td>
                  <Td numeric>{r.urls.size}</Td>
                  <Td numeric>{r.obs.size}</Td>
                  <Td numeric>{r.withCompetitorOnly}</Td>
                  <Td numeric>{r.withBrand}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
