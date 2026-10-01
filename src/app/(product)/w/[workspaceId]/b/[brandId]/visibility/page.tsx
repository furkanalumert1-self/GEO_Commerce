import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Provenance, TableWrap, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/layout/filter-bar";
import { Pager, pageParams } from "@/components/data/pager";
import { UrlDrawer } from "@/components/data/drawer";
import { ObservationEvidence } from "@/components/data/observation-evidence";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { brandMetrics, parseRange } from "@/modules/monitoring/queries";
import { brandEntities } from "@/modules/monitoring/service";
import { isUuid } from "@/modules/tenancy/access";
import { ENGINE_SHORT, fmtDate, fmtNumber, fmtPct, SURFACE_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Görünürlük" };

export default async function VisibilityPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const range = parseRange(sp);
  const { page, pageSize, skip } = pageParams(sp);
  const base = `/w/${workspaceId}/b/${brandId}/visibility`;
  const obsWhere = { workspaceId, brandId, sampledAt: { gte: range.from, lte: range.to }, ...(sp.engine ? { engine: sp.engine } : {}), ...(sp.status === "failed" ? { status: { in: ["failed", "parse_failed"] as ("failed" | "parse_failed")[] } } : {}) };
  const [metrics, entities, observations, obsTotal, runs, engines, drawer] = await Promise.all([
    brandMetrics(db, workspaceId, brandId, { from: range.from, to: range.to, engines: sp.engine ? [sp.engine] : undefined }),
    brandEntities(db, brandId),
    db.observation.findMany({ where: obsWhere, include: { mentions: true, citations: true, promptVersion: { select: { text: true, version: true } } }, orderBy: { sampledAt: "desc" }, skip, take: pageSize }),
    db.observation.count({ where: obsWhere }),
    db.monitoringRun.findMany({ where: { workspaceId, brandId }, orderBy: { scheduledAt: "desc" }, take: 8 }),
    db.observation.findMany({ where: { workspaceId, brandId }, distinct: ["engine"], select: { engine: true } }),
    sp.obs && isUuid(sp.obs) ? db.observation.findFirst({ where: { id: sp.obs, workspaceId, brandId }, include: { mentions: true, citations: true, promptVersion: { select: { text: true, version: true } } } }) : null,
  ]);
  const names = Object.fromEntries(entities.map((e) => [e.id, e.name]));
  const qs = (patch: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v !== undefined) as Array<[string, string]>);
    for (const [k, v] of Object.entries(patch)) q.set(k, v);
    return `${base}?${q.toString()}`;
  };

  return (
    <>
      <PageHeader title="Görünürlük" description="Motor bazında skor, SOV ve kanıt. Mention ve citation ayrı ölçülür; başarısız sorgular düşüş sayılmaz." />
      <FilterBar basePath={base} sp={sp} timeZone={access.brand.timezone} engines={engines.map((e) => e.engine)} />
      {metrics.aggregate.smallSample ? (
        <div className="mb-4">
          <Alert tone="warning" title="Küçük örneklem">Seçili dönemde {metrics.sampleCount} geçerli gözlem var (&lt; 20). Sonuçları yönlü bir işaret olarak değerlendirin.</Alert>
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Motor kırılımı" description="Toplam skor yalnız coverage ≥ %80 motorların eşit ağırlıklı ortalamasıdır." />
          <TableWrap label="Motor kırılımı">
            <thead>
              <tr>
                <Th>Motor</Th>
                <Th numeric>Skor</Th>
                <Th numeric>Mention</Th>
                <Th numeric>Öneri</Th>
                <Th numeric>Kendi citation</Th>
                <Th numeric>Coverage</Th>
              </tr>
            </thead>
            <tbody>
              {metrics.perEngine.map((e) => (
                <tr key={e.engine}>
                  <Td>
                    {ENGINE_SHORT[e.engine] ?? e.engine} {e.smallSample ? <Badge tone="warning">Küçük örneklem</Badge> : null}
                  </Td>
                  <Td numeric>{e.score ?? "—"}</Td>
                  <Td numeric>{fmtPct(e.M)}</Td>
                  <Td numeric>{fmtPct(e.R)}</Td>
                  <Td numeric>{fmtPct(e.C)}</Td>
                  <Td numeric>{fmtPct(e.coverage)}</Td>
                </tr>
              ))}
              <tr>
                <Td className="font-semibold">Toplam {metrics.aggregate.partial ? <Badge tone="warning">Kısmi</Badge> : null}</Td>
                <Td numeric className="font-semibold">{metrics.aggregate.score ?? "Ölçülemedi"}</Td>
                <Td colSpan={4} className="text-xs text-muted">{metrics.aggregate.missingEngines.length ? `Dahil edilmeyen: ${metrics.aggregate.missingEngines.map((e) => ENGINE_SHORT[e] ?? e).join(", ")}` : "Tüm motorlar dahil"}</Td>
              </tr>
            </tbody>
          </TableWrap>
          <div className="border-t border-border px-4 py-3">
            <details className="text-xs"><summary className="inline-flex min-h-11 cursor-pointer items-center text-text-secondary sm:min-h-0">Ölçüm detayları</summary><div className="mt-1"><Provenance items={[["Yüzey", metrics.provenance.surfaces.map((s) => SURFACE_LABEL[s] ?? s).join(", ") || "—"], ["Başarısız sorgu", fmtNumber(metrics.failedCount)], ["Formül sürümü", metrics.formulaVersion], ["Ölçüm kümesi kimliği", metrics.cohortHash]]} /></div></details>
          </div>
        </Card>
        <Card>
          <CardHeader title="Share of Voice" description="Aynı soru kümesi; her yanıtta bir marka en fazla bir kez sayılır. Rakip listesi değişirse karşılaştırma kümesi değişir." />
          <TableWrap label="Share of voice">
            <thead>
              <tr>
                <Th>Marka</Th>
                <Th numeric>SOV</Th>
              </tr>
            </thead>
            <tbody>
              {metrics.sov.map((s) => (
                <tr key={s.id}>
                  <Td>{s.name} {s.type === "brand" ? <Badge tone="primary">Siz</Badge> : null}</Td>
                  <Td numeric>{s.value === null ? "Ölçülemedi" : `%${fmtNumber(s.value, "tr-TR", 1)}`}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Gözlemler"
          description="Her satır tek bir AI yanıtıdır. Kanıtı görmek için satırı açın."
          action={<Link className="text-sm text-primary underline" href={qs({ status: sp.status === "failed" ? "" : "failed", page: "1" })}>{sp.status === "failed" ? "Tümünü göster" : "Yalnız başarısızlar"}</Link>}
        />
        {observations.length === 0 ? (
          <EmptyState title="Sonuç yok" description="Seçili filtrelerde gözlem yok." action={<Link className="text-primary underline" href={base}>Filtreleri sıfırla</Link>} />
        ) : (
          <TableWrap label="Gözlemler">
            <thead>
              <tr>
                <Th>Soru</Th>
                <Th>Motor</Th>
                <Th>Marka</Th>
                <Th numeric>Citation</Th>
                <Th>Tarih</Th>
              </tr>
            </thead>
            <tbody>
              {observations.map((o) => {
                const own = o.mentions.find((m) => m.entityId === brandId);
                return (
                  <tr key={o.id}>
                    <Td className="max-w-[26rem]">
                      <Link scroll={false} className="text-primary hover:underline" href={qs({ obs: o.id })}>{o.promptVersion.text}</Link>
                    </Td>
                    <Td>{ENGINE_SHORT[o.engine] ?? o.engine}</Td>
                    <Td>
                      {o.status !== "succeeded" ? <Badge tone="warning">Başarısız</Badge> : own ? <Badge tone={own.kind === "recommendation" ? "success" : own.kind === "negative" ? "danger" : "primary"}>{own.kind === "recommendation" ? "Önerildi" : own.kind === "negative" ? "Olumsuz" : "Anıldı"}{own.rank ? ` #${own.rank}` : ""}</Badge> : <Badge>Anılmadı</Badge>}
                    </Td>
                    <Td numeric>{o.citations.length}</Td>
                    <Td className="text-muted">{fmtDate(o.sampledAt, access.brand.timezone, "tr-TR", true)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        <Pager basePath={base} sp={sp} page={page} pageSize={pageSize} total={obsTotal} />
      </Card>

      <Card className="mt-6">
        <CardHeader title="Son ölçüm çalıştırmaları" />
        <ul className="divide-y divide-border">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <Link className="text-primary hover:underline" href={`/w/${workspaceId}/b/${brandId}/runs/${r.id}`}>{fmtDate(r.scheduledAt, access.brand.timezone, "tr-TR", true)} · {r.engines.map((e) => ENGINE_SHORT[e] ?? e).join(", ")}</Link>
              <span className="flex items-center gap-2">
                <Badge tone={r.status === "succeeded" ? "success" : r.status === "partial" ? "warning" : r.status === "failed" ? "danger" : "primary"}>{r.status}</Badge>
                <span className="tabular text-muted">{r.completedCount}/{r.scheduledCount}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {drawer ? (
        <Suspense>
          <UrlDrawer param="obs" title="Gözlem kanıtı">
            <ObservationEvidence o={drawer} names={names} timeZone={access.brand.timezone} />
          </UrlDrawer>
        </Suspense>
      ) : null}
    </>
  );
}
