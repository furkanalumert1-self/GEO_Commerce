import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Provenance, Stat, TableWrap, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/layout/filter-bar";
import { TrendChart } from "@/components/data/trend-chart";
import { ApiButton } from "@/components/forms/api-button";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { brandMetrics, dailyTrend, parseRange } from "@/modules/monitoring/queries";
import { revenueSummary } from "@/modules/commerce/service";
import { hasFeature } from "@/modules/billing/plans";
import { ENGINE_SHORT, fmtDate, fmtMoney, fmtNumber, fmtPct, GAP_LABEL, SURFACE_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Pano" };

type SP = Promise<Record<string, string | undefined>>;

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: SP }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const range = parseRange(sp);
  const filters = { from: range.from, to: range.to, engines: sp.engine ? [sp.engine] : undefined };
  const base = `/w/${workspaceId}/b/${brandId}`;

  const [metrics, trend, openOpps, topOpps, promptCount, lastRun, engines] = await Promise.all([
    brandMetrics(db, workspaceId, brandId, filters),
    dailyTrend(db, workspaceId, brandId, filters, access.brand.timezone),
    db.opportunity.count({ where: { workspaceId, brandId, status: { in: ["new", "triaged", "in_progress"] } } }),
    db.opportunity.findMany({ where: { workspaceId, brandId, status: { in: ["new", "triaged", "in_progress"] } }, orderBy: [{ score: { sort: "desc", nulls: "last" } }], take: 5, include: { cluster: { select: { label: true } } } }),
    db.prompt.count({ where: { workspaceId, brandId, active: true } }),
    db.monitoringRun.findFirst({ where: { workspaceId, brandId }, orderBy: { scheduledAt: "desc" } }),
    db.observation.findMany({ where: { workspaceId, brandId }, distinct: ["engine"], select: { engine: true } }),
  ]);
  const revenueAllowed = hasFeature(access.entitlements, "revenue");
  const revenue = revenueAllowed ? await revenueSummary(db, workspaceId, brandId, { from: range.from, to: range.to }) : null;
  const self = metrics.sov.find((s) => s.id === brandId);

  if (promptCount === 0 && !lastRun) {
    return (
      <>
        <PageHeader title={access.brand.name} description="Görünürlük ölçümü henüz başlamadı." />
        <Card>
          <EmptyState title="İlk ölçüm için prompt ekleyin" description="Katalog ve niyet listesini onayladıktan sonra ilk ölçümü başlatabilirsiniz." action={<Link className="inline-flex min-h-11 items-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-white" href={`/w/${workspaceId}/onboarding?brand=${brandId}`}>Kurulumu tamamla</Link>} />
        </Card>
      </>
    );
  }

  const perEngineKeys = [...new Set(trend.flatMap((d) => Object.keys(d.perEngine)))].sort();
  const chartData = trend.map((d) => ({ day: d.day, all: d.score, ...Object.fromEntries(perEngineKeys.map((k) => [k, d.perEngine[k] ?? null])) }));

  return (
    <>
      <PageHeader
        title={access.brand.name}
        description={`${access.brand.domain} · ${access.brand.country} / ${access.brand.language}`}
        action={<ApiButton url={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/runs`} body={{ engines: ["chatgpt", "gemini", "perplexity"], locales: [`${access.brand.language}-${access.brand.country}`], repeats: 1 }} idempotent label="Ölçüm başlat" pendingLabel="Kuyruğa alınıyor…" variant="primary" onSuccessMessage="Ölçüm kuyruğa alındı" />}
      />
      <FilterBar basePath={`${base}/dashboard`} sp={sp} timeZone={access.brand.timezone} engines={engines.map((e) => e.engine)} />

      {metrics.aggregate.partial ? (
        <div className="mb-4">
          <Alert tone="warning" title="Kısmi veri">
            {metrics.aggregate.missingEngines.length ? `Coverage %80 altında veya skorsuz motorlar toplam skora dahil edilmedi: ${metrics.aggregate.missingEngines.map((e) => ENGINE_SHORT[e] ?? e).join(", ")}.` : "Seçili dönemde yeterli gözlem yok."}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="AI Visibility Score"
          value={metrics.aggregate.score ?? "Ölçülemedi"}
          unit={metrics.aggregate.score !== null ? "/ 100" : undefined}
          badge={metrics.aggregate.smallSample ? <Badge tone="warning">Küçük örneklem</Badge> : metrics.aggregate.partial ? <Badge tone="warning">Kısmi</Badge> : null}
          hint={`${metrics.sampleCount} geçerli gözlem · ${range.days} gün`}
          footnote={`Formül ${metrics.formulaVersion}: 0,5·Mention + 0,3·Öneri + 0,2·Kendi citation`}
        />
        <Stat
          label="Share of Voice"
          value={self?.value === null || self?.value === undefined ? "Ölçülemedi" : fmtNumber(self.value, "tr-TR", 1)}
          unit={self?.value != null ? "%" : undefined}
          hint={`${metrics.sov.length - 1} onaylı rakiple aynı cohort`}
          footnote="Yanıt başına marka başına tek mention sayılır"
        />
        <Stat label="Açık fırsat" value={fmtNumber(openOpps)} hint="Yeni, değerlendirilen ve üzerinde çalışılan" footnote={<Link className="text-primary underline" href={`${base}/opportunities`}>Tüm fırsatlar</Link>} />
        {revenue ? (
          <Stat
            label="Gözlemlenen AI geliri"
            value={Object.keys(revenue.aiNetByCurrency).length === 0 ? fmtMoney(0, access.brand.currency) : Object.entries(revenue.aiNetByCurrency).map(([c, v]) => fmtMoney(v, c)).join(" · ")}
            hint={`${revenue.aiOrders} sipariş · son dokunuş (30 gün)`}
            footnote={`Attribution kapsamı ${fmtPct(revenue.attributionCoverage)} · para birimleri ayrı`}
          />
        ) : (
          <Stat label="Gözlemlenen AI geliri" value="Pakette yok" hint="Gelir ölçümü Commerce ve üzeri paketlerde" footnote={<Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Paketleri gör</Link>} />
        )}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Görünürlük trendi" description="Günlük skor; her motor ayrı çizgi. Farklı cohort'lar arası değişim performans iyileşmesi olarak yorumlanmamalıdır." />
          <div className="p-4">
            {chartData.length ? (
              <TrendChart data={chartData} series={[{ key: "all", label: "Toplam" }, ...perEngineKeys.map((k) => ({ key: k, label: ENGINE_SHORT[k] ?? k }))]} yLabel="Günlük görünürlük skoru" />
            ) : (
              <EmptyState title="Sonuç yok" description="Seçili filtrelerde gözlem bulunamadı." action={<Link className="text-primary underline" href={`${base}/dashboard`}>Filtreleri sıfırla</Link>} />
            )}
          </div>
          <div className="border-t border-border px-4 py-3">
            <Provenance
              items={[
                ["Yüzey", metrics.provenance.surfaces.map((s) => SURFACE_LABEL[s] ?? s).join(", ") || "—"],
                ["Modeller", metrics.provenance.models.join(", ") || "—"],
                ["Coverage", fmtPct(metrics.coverage)],
                ["Başarısız", fmtNumber(metrics.failedCount)],
                ["Son örnek", fmtDate(metrics.provenance.lastSampledAt, access.brand.timezone, "tr-TR", true)],
                ["Cohort", metrics.cohortHash],
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Motor bazında" description="Motorlar ayrı ölçülür; toplamda eşit ağırlıklıdır." />
          <ul className="divide-y divide-border">
            {metrics.perEngine.map((e) => (
              <li key={e.engine} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{ENGINE_SHORT[e.engine] ?? e.engine}</p>
                  <p className="text-xs text-muted">Coverage {fmtPct(e.coverage)} · {e.validObservations} gözlem</p>
                </div>
                <div className="flex items-center gap-2">
                  {e.smallSample ? <Badge tone="warning">Küçük örneklem</Badge> : null}
                  <span className="tabular text-lg font-semibold">{e.score ?? "—"}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Öncelikli 5 aksiyon" description="Fırsat skoruna göre; her skorun bileşenleri detay sayfasında açılır." action={<Link className="text-sm text-primary underline" href={`${base}/opportunities`}>Tümü</Link>} />
        {topOpps.length === 0 ? (
          <EmptyState title="Açık fırsat yok" description="Yeni ölçümler tamamlandıkça fırsatlar burada görünür." />
        ) : (
          <TableWrap label="Öncelikli fırsatlar">
            <thead>
              <tr>
                <Th>Fırsat</Th>
                <Th>Tür</Th>
                <Th numeric>Skor</Th>
                <Th>Önerilen aksiyon</Th>
              </tr>
            </thead>
            <tbody>
              {topOpps.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link className="font-medium text-primary hover:underline" href={`${base}/opportunities/${o.id}`}>{o.title}</Link>
                  </Td>
                  <Td>{GAP_LABEL[o.gapType]}</Td>
                  <Td numeric>{o.score ?? "Geçici"}{o.provisional ? " *" : ""}</Td>
                  <Td className="text-muted">{o.recommendedAction}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
