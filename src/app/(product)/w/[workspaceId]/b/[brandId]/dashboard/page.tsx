import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { Alert, Card, CardHeader, EmptyState, PageHeader, Provenance, SectionHeader, TableWrap, Td, Th, cn } from "@/components/ui";
import { FilterBar } from "@/components/layout/filter-bar";
import { TrendChart } from "@/components/data/trend-chart";
import { ActionStatusBadge, ImpactBadge, MetricCard, PlatformBreakdown } from "@/components/data/growth";
import { ApiButton } from "@/components/forms/api-button";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { brandMetrics, dailyTrend, parseRange } from "@/modules/monitoring/queries";
import { revenueSummary } from "@/modules/commerce/service";
import { hasFeature } from "@/modules/billing/plans";
import { ENGINE_SHORT, fmtDate, fmtMoney, fmtNumber, fmtPct, GAP_LABEL, SURFACE_LABEL } from "@/lib/format";
import { absoluteDelta, actionCta, alignPrevious, impactLevel, previousPeriod } from "@/lib/view-models";

export const metadata: Metadata = { title: "Genel Bakış" };

type SP = Promise<Record<string, string | undefined>>;
type Components = Partial<Record<string, { value: number | null; rationale: string }>>;
type DiagnosisJson = Array<{ observation?: { engine?: string } | null }> | null;

const OPEN = ["new", "triaged", "in_progress"] as const;

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: SP }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const tz = access.brand.timezone;
  const range = parseRange(sp);
  const engineFilter = sp.engine ? [sp.engine] : undefined;
  const filters = { from: range.from, to: range.to, engines: engineFilter };
  const prev = previousPeriod(range);
  const base = `/w/${workspaceId}/b/${brandId}`;
  const keep = new URLSearchParams(Object.entries({ range: sp.range, from: sp.from, to: sp.to, engine: sp.engine }).filter((e): e is [string, string] => Boolean(e[1])));
  const qs = keep.toString() ? `?${keep.toString()}` : "";

  const [metrics, prevMetrics, trend, prevTrend, openOpps, highOpps, newOpps, topOpps, recentActions, promptCount, lastRun, engines, orderSources] = await Promise.all([
    brandMetrics(db, workspaceId, brandId, filters),
    brandMetrics(db, workspaceId, brandId, { ...prev, engines: engineFilter }),
    dailyTrend(db, workspaceId, brandId, filters, tz),
    dailyTrend(db, workspaceId, brandId, { ...prev, engines: engineFilter }, tz),
    db.opportunity.count({ where: { workspaceId, brandId, status: { in: [...OPEN] } } }),
    db.opportunity.count({ where: { workspaceId, brandId, status: { in: [...OPEN] }, priority: "high" } }),
    db.opportunity.count({ where: { workspaceId, brandId, status: "new" } }),
    db.opportunity.findMany({
      where: { workspaceId, brandId, status: { in: [...OPEN] } },
      orderBy: [{ score: { sort: "desc", nulls: "last" } }],
      take: 3,
      include: { cluster: { select: { label: true } } },
    }),
    db.action.findMany({ where: { workspaceId, brandId }, orderBy: { updatedAt: "desc" }, take: 5, include: { opportunity: { select: { title: true } } } }),
    db.prompt.count({ where: { workspaceId, brandId, active: true } }),
    db.monitoringRun.findFirst({ where: { workspaceId, brandId }, orderBy: { scheduledAt: "desc" } }),
    db.observation.findMany({ where: { workspaceId, brandId }, distinct: ["engine"], select: { engine: true } }),
    db.integration.count({ where: { brandId, capabilities: { path: ["ordersRead"], equals: true } } }),
  ]);
  const revenueAllowed = hasFeature(access.entitlements, "revenue");
  const revenue = revenueAllowed && orderSources > 0 ? await revenueSummary(db, workspaceId, brandId, { from: range.from, to: range.to }) : null;

  if (promptCount === 0 && !lastRun) {
    return (
      <>
        <PageHeader title="Genel Bakış" description={`${access.brand.name} için görünürlük ölçümü henüz başlamadı.`} />
        <Card>
          <EmptyState
            title="İlk ölçüm için soru ekleyin"
            description="GEO (Generative Engine Optimization), markanızın AI asistan yanıtlarında görünürlüğünü ölçer ve iyileştirir. Katalog ve soru listesini onayladıktan sonra ilk ölçümü başlatabilirsiniz."
            action={<Link className="inline-flex min-h-11 items-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover sm:min-h-10" href={`/w/${workspaceId}/onboarding?brand=${brandId}`}>Kurulumu tamamla</Link>}
          />
        </Card>
      </>
    );
  }

  // ── KPI'lar ve önceki eşit dönem farkı ──
  const score = metrics.aggregate.score;
  const scoreDelta = absoluteDelta(score, prevMetrics.aggregate.score, "puan");
  const self = metrics.sov.find((s) => s.id === brandId)?.value ?? null;
  const prevSelf = prevMetrics.sov.find((s) => s.id === brandId)?.value ?? null;
  const sovDelta = absoluteDelta(self, prevSelf, "yüzde puan");
  const competitorCount = metrics.sov.filter((s) => s.type === "competitor").length;

  // ── Trend: ana seri + önceki dönem (gün sırasıyla hizalı) ──
  const prevAligned = alignPrevious(trend, prevTrend, Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000));
  const chartData = trend.map((d, i) => ({ day: d.day, all: d.score, prev: prevAligned[i] ?? null }));
  const firstScore = trend.find((d) => d.score !== null)?.score ?? null;
  const lastScore = [...trend].reverse().find((d) => d.score !== null)?.score ?? null;
  const trendSummary =
    firstScore === null || lastScore === null
      ? "Seçili dönemde günlük skor hesaplanacak kadar gözlem yok."
      : `Günlük skor dönem başında ${firstScore}, en son ${lastScore} (100 üzerinden). Farklı soru kümeleri arası değişim performans iyileşmesi olarak yorumlanmamalıdır.`;
  const coverages = metrics.perEngine.map((e) => e.coverage).filter((c): c is number => c !== null);
  const coverageVaries = coverages.length > 1 && Math.max(...coverages) - Math.min(...coverages) > 0.2;

  // ── Tek cümle durum özeti (yalnız veriye dayalı ifadeler) ──
  const summary: string[] = [];
  if (newOpps > 0) summary.push(`${newOpps} fırsat incelemenizi bekliyor.`);
  else if (openOpps > 0) summary.push(`${openOpps} açık fırsat üzerinde çalışılıyor.`);
  else summary.push("Açık fırsat yok.");
  if (scoreDelta.kind === "points" && scoreDelta.direction !== "flat") {
    summary.push(`AI görünürlüğü önceki döneme göre ${Math.abs(scoreDelta.value)} puan ${scoreDelta.direction === "up" ? "arttı" : "azaldı"}.`);
  }

  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description={
          <>
            <span className="text-text">{summary.join(" ")}</span>
            <span className="mt-1 block text-[13px]">
              {access.brand.name} · Son güncelleme: {fmtDate(metrics.provenance.lastSampledAt, tz, "tr-TR", true)}
            </span>
          </>
        }
        action={
          <ApiButton
            url={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/runs`}
            body={{ engines: ["chatgpt", "gemini", "perplexity"], locales: [`${access.brand.language}-${access.brand.country}`], repeats: 1 }}
            idempotent
            label="Ölçüm başlat"
            pendingLabel="Kuyruğa alınıyor…"
            onSuccessMessage="Ölçüm kuyruğa alındı"
          />
        }
      />
      <FilterBar basePath={`${base}/dashboard`} sp={sp} timeZone={tz} engines={engines.map((e) => e.engine)} />

      {metrics.aggregate.partial ? (
        <div className="mb-6">
          <Alert tone="warning" title="Kısmi veri">
            {metrics.aggregate.missingEngines.length
              ? `Kapsamı %80 altında veya skorsuz platformlar toplam skora dahil edilmedi: ${metrics.aggregate.missingEngines.map((e) => ENGINE_SHORT[e] ?? e).join(", ")}.`
              : "Seçili dönemde yeterli gözlem yok."}
          </Alert>
        </div>
      ) : null}

      <section aria-label="Temel göstergeler" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="AI görünürlüğü"
          value={score ?? undefined}
          unit="/ 100"
          missing={score === null ? (metrics.sampleCount ? "Yetersiz örneklem" : "Henüz ölçülmüyor") : undefined}
          delta={scoreDelta}
          scope={`${fmtNumber(metrics.sampleCount)} geçerli yanıt · ${range.days} gün${metrics.aggregate.smallSample ? " · küçük örneklem" : ""}`}
          href={`${base}/visibility${qs}`}
          linkLabel="Soruları gör"
        />
        <MetricCard
          label="Rekabet payı (Share of Voice)"
          value={self === null ? undefined : fmtNumber(self, "tr-TR", 1)}
          unit="%"
          missing={self === null ? "Henüz ölçülmüyor" : undefined}
          delta={sovDelta}
          scope={`${competitorCount} onaylı rakiple aynı soru kümesi`}
          href={`${base}/competitors${qs}`}
          linkLabel="Rakipleri gör"
        />
        <MetricCard
          label="Açık büyüme fırsatları"
          value={fmtNumber(openOpps)}
          scope={highOpps > 0 ? `${highOpps} yüksek öncelikli` : "Yüksek öncelikli fırsat yok"}
          href={`${base}/opportunities`}
          linkLabel="Fırsatları gör"
        />
        {revenue ? (
          <MetricCard
            label="AI kaynaklı gelir"
            value={Object.keys(revenue.aiNetByCurrency).length === 0 ? fmtMoney(0, access.brand.currency) : Object.entries(revenue.aiNetByCurrency).map(([c, v]) => fmtMoney(v, c)).join(" · ")}
            scope={`${fmtNumber(revenue.aiOrders)} sipariş · son dokunuş · kapsam ${fmtPct(revenue.attributionCoverage)}`}
            href={`${base}/revenue${qs}`}
            linkLabel="Geliri gör"
          />
        ) : (
          <MetricCard
            label="AI kaynaklı gelir"
            missing={revenueAllowed ? "Entegrasyon gerekli" : "Paketinizde yok"}
            scope={revenueAllowed ? "Sipariş kaynağı bağlanınca gözlemlenen gelir gösterilir." : "Gelir ölçümü Commerce ve üzeri paketlerde."}
            href={revenueAllowed ? `${base}/integrations` : `/w/${workspaceId}/billing`}
            linkLabel={revenueAllowed ? "Mağazayı bağla" : "Paketleri gör"}
          />
        )}
      </section>

      <section aria-labelledby="focus" className="mt-10">
        <SectionHeader
          id="focus"
          title="Bugün odaklanmanız gerekenler"
          description={topOpps.length ? `Öncelik sırasına göre ${topOpps.length === 3 ? "ilk 3" : topOpps.length} fırsat` : undefined}
          action={<Link className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2 sm:min-h-0" href={`${base}/opportunities`}>Tüm fırsatlar <ArrowRight size={14} aria-hidden /></Link>}
        />
        {topOpps.length === 0 ? (
          <Card>
            <EmptyState title="Şu an öncelikli fırsat yok" description="Yeni ölçümler tamamlandıkça rakiplere kaybedilen sorular burada listelenir." />
          </Card>
        ) : (
          <ol className="flex flex-col gap-3">
            {topOpps.map((o, i) => {
              const comps = o.components as Components;
              const engine = (o.diagnosis as DiagnosisJson)?.[0]?.observation?.engine;
              const evidence = comps.visibilityGap?.rationale ?? comps.evidenceStrength?.rationale ?? null;
              return (
                <li key={o.id}>
                  <Card className={cn("flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between", i === 0 && "border-l-[3px] border-l-primary")}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                        <span className="tabular font-medium">Öncelik {i + 1}</span>
                        <span aria-hidden>·</span>
                        <span>{GAP_LABEL[o.gapType]}</span>
                        <span aria-hidden>·</span>
                        <span>{o.cluster.label}</span>
                        {engine ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>{ENGINE_SHORT[engine] ?? engine}</span>
                          </>
                        ) : null}
                      </div>
                      <h3 className="mt-1.5 text-base font-semibold leading-snug">
                        <Link href={`${base}/opportunities/${o.id}`} className="hover:underline underline-offset-2">{o.title}</Link>
                      </h3>
                      <p className="mt-1 text-sm text-text-secondary">{evidence ?? "Bu öneri henüz kanıtla doğrulanmadı."}</p>
                      {o.recommendedAction ? (
                        <p className="mt-2 text-sm">
                          <span className="font-medium">Öneri: </span>
                          {o.recommendedAction}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                      <ImpactBadge level={impactLevel(o)} />
                      {o.expectedEffort ? <span className="text-xs text-text-secondary">Efor: {o.expectedEffort}</span> : null}
                      <Link
                        href={`${base}/opportunities/${o.id}`}
                        className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium text-primary hover:underline underline-offset-2 sm:min-h-9"
                        aria-label={`İncele: ${o.title}`}
                      >
                        İncele <ArrowRight size={14} aria-hidden />
                      </Link>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-label="Görünürlük trendi ve platformlar" className="mt-10 grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader title="Görünürlük trendi" description={`Günlük AI görünürlük skoru (0–100) · kesik çizgi: önceki ${range.days} gün`} />
          <div className="px-5 pb-2 pt-4">
            <p className="mb-3 text-sm text-text-secondary">{trendSummary}</p>
            {chartData.length ? (
              <TrendChart
                data={chartData}
                series={[
                  { key: "all", label: "Bu dönem", variant: "main" },
                  { key: "prev", label: "Önceki dönem", variant: "compare" },
                ]}
                yLabel="Günlük görünürlük skoru"
              />
            ) : (
              <EmptyState title="Sonuç yok" description="Seçili filtrelerde gözlem bulunamadı." action={<Link className="text-primary underline" href={`${base}/dashboard`}>Filtreleri sıfırla</Link>} />
            )}
          </div>
          <div className="border-t border-border px-5 py-3">
            <Provenance
              items={[
                ["Yüzey", metrics.provenance.surfaces.map((s) => SURFACE_LABEL[s] ?? s).join(", ") || "—"],
                ["Modeller", metrics.provenance.models.join(", ") || "—"],
                ["Kapsam", fmtPct(metrics.coverage)],
                ["Başarısız sorgu", fmtNumber(metrics.failedCount)],
                ["Formül", `${metrics.formulaVersion}: 0,5·Anılma + 0,3·Öneri + 0,2·Kendi kaynağı`],
              ]}
            />
          </div>
        </Card>
        <Card className="xl:col-span-4">
          <CardHeader title="Platformlar" description="Aynı ölçek (0–100); platformlar ayrı ölçülür." />
          <PlatformBreakdown
            rows={metrics.perEngine.map((e) => ({
              key: e.engine,
              label: ENGINE_SHORT[e.engine] ?? e.engine,
              score: e.score,
              samples: e.validObservations,
              note: `kapsam ${fmtPct(e.coverage)}${e.smallSample ? " · küçük örneklem" : ""}`,
            }))}
          />
          {coverageVaries ? (
            <p className="border-t border-border px-5 py-3 text-xs text-warning">Platformların ölçüm kapsamı farklı; skorları doğrudan karşılaştırırken dikkatli olun.</p>
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="works" className="mt-10">
        <SectionHeader
          id="works"
          title="Devam eden ve son çalışmalar"
          action={<Link className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2 sm:min-h-0" href={`${base}/actions`}>Tüm aksiyonlar <ArrowRight size={14} aria-hidden /></Link>}
        />
        <Card>
          {recentActions.length === 0 ? (
            <EmptyState title="Henüz aksiyon yok" description="Bir fırsatı inceleyip Fix with AI ile taslak oluşturduğunuzda çalışmalarınız burada görünür." />
          ) : (
            <TableWrap label="Son çalışmalar">
              <thead>
                <tr>
                  <Th>Aksiyon</Th>
                  <Th>Hedef</Th>
                  <Th>Durum</Th>
                  <Th>Son işlem</Th>
                  <Th><span className="sr-only">İşlem</span></Th>
                </tr>
              </thead>
              <tbody>
                {recentActions.map((a) => {
                  const manual = Boolean((a.measurement as { manualPublish?: boolean } | null)?.manualPublish);
                  return (
                    <tr key={a.id}>
                      <Td className="max-w-[22rem]">
                        <Link className="font-medium hover:underline underline-offset-2" href={`${base}/actions/${a.id}`}>{a.title}</Link>
                      </Td>
                      <Td className="max-w-[18rem] truncate text-text-secondary" title={a.targetUrl ?? a.opportunity?.title ?? undefined}>{a.targetUrl ?? a.opportunity?.title ?? "—"}</Td>
                      <Td><ActionStatusBadge status={a.status} manual={manual} /></Td>
                      <Td className="whitespace-nowrap text-text-secondary">{fmtDate(a.updatedAt, tz, "tr-TR", true)}</Td>
                      <Td className="text-right">
                        <Link className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-sm font-medium text-primary hover:underline underline-offset-2 sm:min-h-0" href={`${base}/actions/${a.id}`} aria-label={`${actionCta(a.status)}: ${a.title}`}>
                          {actionCta(a.status)} <ArrowRight size={14} aria-hidden />
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </section>
    </>
  );
}
