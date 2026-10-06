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
import { ENGINE_SHORT, fmtDate, fmtNumber, fmtPct, SURFACE_LABEL, RUN_STATUS_LABEL, trOfCount } from "@/lib/format";
import { sovMissingReason } from "@/lib/view-models";
import { isStalled, runProgress } from "@/modules/monitoring/run-status";

export const metadata: Metadata = { title: "Görünürlük" };

export default async function VisibilityPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const range = parseRange(sp);
  const { page, pageSize, skip } = pageParams(sp);
  const base = `/w/${workspaceId}/b/${brandId}/visibility`;
  const obsWhere = { workspaceId, brandId, sampledAt: { gte: range.from, lte: range.to }, ...(sp.engine ? { engine: sp.engine } : {}), ...(sp.status === "failed" ? { status: { in: ["failed", "parse_failed"] as ("failed" | "parse_failed")[] } } : {}) , ...(sp.kind === "branded" || sp.kind === "generic" ? { promptVersion: { prompt: { branded: sp.kind === "branded" } } } : {}) };
  const kindBase = { workspaceId, brandId, sampledAt: { gte: range.from, lte: range.to }, status: "succeeded" as const, ...(sp.engine ? { engine: sp.engine } : {}) };
  // Markalı ve genel keşif soruları ayrı özetlenir; puan formülü değişmez (yalnız görünüm).
  const kindStats = await Promise.all(
    [false, true].map(async (branded) => {
      const where = { ...kindBase, promptVersion: { prompt: { branded } } };
      const [answers, mentioned] = await Promise.all([db.observation.count({ where }), db.observation.count({ where: { ...where, mentions: { some: { entityId: brandId, kind: { not: "negative" } } } } })]);
      return { branded, answers, mentioned };
    }),
  );
  const [metrics, entities, observations, obsTotal, runs, engines, drawer] = await Promise.all([
    brandMetrics(db, workspaceId, brandId, { from: range.from, to: range.to, engines: sp.engine ? [sp.engine] : undefined }),
    brandEntities(db, brandId),
    db.observation.findMany({ where: obsWhere, include: { mentions: true, citations: true, promptVersion: { select: { text: true, version: true } } }, orderBy: { sampledAt: "desc" }, skip, take: pageSize }),
    db.observation.count({ where: obsWhere }),
    db.monitoringRun.findMany({ where: { workspaceId, brandId }, orderBy: { scheduledAt: "desc" }, take: 8 }),
    db.observation.findMany({ where: { workspaceId, brandId }, distinct: ["engine"], select: { engine: true } }),
    sp.obs && isUuid(sp.obs) ? db.observation.findFirst({ where: { id: sp.obs, workspaceId, brandId }, include: { mentions: true, citations: true, promptVersion: { select: { text: true, version: true } } } }) : null,
  ]);
  const progress = await runProgress(db, runs);
  const names = Object.fromEntries(entities.map((e) => [e.id, e.name]));
  const qs = (patch: Record<string, string>) => {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v !== undefined) as Array<[string, string]>);
    for (const [k, v] of Object.entries(patch)) q.set(k, v);
    return `${base}?${q.toString()}`;
  };

  return (
    <>
      <PageHeader title="Sonuçlar" description="Platform bazında puan, rakiplere göre görünürlük payı ve yanıtlar. Markanızın anılması ve kaynak gösterilme ayrı ölçülür; alınamayan yanıtlar düşüş sayılmaz." />
      <div className="mb-5 flex flex-wrap gap-1 border-b border-border" role="navigation" aria-label="Sorular">
        <Link href={`/w/${workspaceId}/b/${brandId}/prompts`} className="inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm text-text-secondary hover:text-text sm:min-h-10">Takip ettiğim sorular</Link>
        <Link href={base} aria-current="page" className="inline-flex min-h-11 items-center border-b-2 border-primary px-3 text-sm font-medium text-primary sm:min-h-10">Sonuçlar</Link>
      </div>
      <FilterBar basePath={base} sp={sp} timeZone={access.brand.timezone} engines={engines.map((e) => e.engine)} />
      <p className="tabular -mt-3 mb-4 text-sm text-text-secondary" data-testid="sample-summary">
        {metrics.promptCount} farklı soru · {metrics.sampleCount} geçerli yanıt · {metrics.runCount} çalışma{metrics.failedCount ? ` · ${metrics.failedCount} yanıt alınamadı (puana girmez)` : ""}
      </p>
      {metrics.aggregate.smallSample ? (
        <div className="mb-4">
          <Alert tone="warning" title="Küçük örneklem">Seçili dönemde {metrics.sampleCount} geçerli gözlem var (&lt; 20). Sonuçları yönlü bir işaret olarak değerlendirin.</Alert>
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Platformlar" description="Toplam puan, yanıtlarının en az %80’i alınabilen platformların eşit ağırlıklı ortalamasıdır." />
          <TableWrap label="Platformlar">
            <thead>
              <tr>
                <Th>Platform</Th>
                <Th numeric>Puan</Th>
                <Th numeric title="Markanızın yanıtlarda anılma oranı">Markanızın anılması</Th>
                <Th numeric>Önerilme</Th>
                <Th numeric title="Sitenizin kaynak olarak gösterilme oranı">Kaynak gösterilme</Th>
                <Th numeric title="Planlanan yanıtlardan alınabilenlerin oranı">Tamamlanan ölçüm</Th>
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
          <CardHeader title="Rakiplere göre görünürlük payı" description="Aynı soru kümesi; her yanıtta bir marka en fazla bir kez sayılır. Rakip listesi değişirse karşılaştırma kümesi değişir." />
          {metrics.sov.every((x) => x.value === null) ? <p className="px-5 pb-2 text-sm text-text-secondary">Neden ölçülemedi: {sovMissingReason({ competitorCount: metrics.sov.filter((x) => x.type === "competitor").length, validAnswers: metrics.sampleCount })}.</p> : null}
          <TableWrap label="Share of voice">
            <thead>
              <tr>
                <Th>Marka</Th>
                <Th numeric>Pay</Th>
              </tr>
            </thead>
            <tbody>
              {metrics.sov.map((s) => (
                <tr key={s.id}>
                  <Td>{s.name} {s.type === "brand" ? <Badge tone="primary">Siz</Badge> : null}</Td>
                  <Td numeric>{s.value === null ? <span title={sovMissingReason({ competitorCount: metrics.sov.filter((x) => x.type === "competitor").length, validAnswers: metrics.sampleCount })}>Ölçülemedi</span> : `%${fmtNumber(s.value, "tr-TR", 1)}`}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Yanıtlar"
          description={<>Her satır tek bir AI yanıtıdır; ayrıntı için soruya tıklayın. {kindStats.map((k) => `${k.branded ? "Markalı sorular" : "Genel keşif"}: ${k.answers} yanıt, markanız ${trOfCount(k.mentioned)} anıldı`).join(" · ")}. <span className="whitespace-nowrap">Göster: {([["", "Tümü"], ["generic", "Genel keşif"], ["branded", "Markalı"]] as const).map(([k, l]) => <Link key={k} className={(sp.kind ?? "") === k ? "ml-1 font-medium text-text" : "ml-1 text-primary underline"} href={qs({ kind: k, page: "1" })}>{l}</Link>)}</span></>}
          action={<Link className="text-sm text-primary underline" href={qs({ status: sp.status === "failed" ? "" : "failed", page: "1" })}>{sp.status === "failed" ? "Tümünü göster" : "Yalnız başarısızlar"}</Link>}
        />
        {observations.length === 0 ? (
          <EmptyState title="Sonuç yok" description="Seçili filtrelerde gözlem yok." action={<Link className="text-primary underline" href={base}>Filtreleri sıfırla</Link>} />
        ) : (
          <TableWrap label="Gözlemler">
            <thead>
              <tr>
                <Th>Soru</Th>
                <Th>Platform</Th>
                <Th>Markanız</Th>
                <Th numeric title="Yanıtta gösterilen kaynak sayısı">Kaynak</Th>
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
                      {o.status !== "succeeded" ? <Badge tone="warning">Değerlendirilemedi</Badge> : own ? <Badge tone={own.kind === "recommendation" ? "success" : own.kind === "negative" ? "danger" : "primary"}>{own.kind === "recommendation" ? "Önerildi" : own.kind === "negative" ? "Olumsuz" : "Anıldı"}{own.rank ? ` #${own.rank}` : ""}</Badge> : <Badge>Anılmadı</Badge>}
                    </Td>
                    <Td numeric>{o.status !== "succeeded" ? <span className="text-text-secondary" title="Yanıt alınamadı">bilinmiyor</span> : o.citations.length}</Td>
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
                {isStalled(r, progress.get(r.id)) ? <Badge tone="warning">Durakladı</Badge> : <Badge tone={r.status === "succeeded" ? "success" : r.status === "partial" ? "warning" : r.status === "failed" ? "danger" : "primary"}>{RUN_STATUS_LABEL[r.status] ?? r.status}</Badge>}
                <span className="tabular text-muted" title="Başarılı / planlanan yanıt">{progress.get(r.id)?.succeeded ?? r.completedCount}/{r.scheduledCount}</span>
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
