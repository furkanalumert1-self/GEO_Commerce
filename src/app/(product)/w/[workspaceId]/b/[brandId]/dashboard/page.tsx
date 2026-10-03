import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Provenance, SectionHeader, TableWrap, Td, Th, cn } from "@/components/ui";
import { FilterBar } from "@/components/layout/filter-bar";
import { TrendChart } from "@/components/data/trend-chart";
import { ActionStatusBadge, ImpactBadge, MetricCard, PlatformBreakdown } from "@/components/data/growth";
import { ApiButton } from "@/components/forms/api-button";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { brandMetrics, dailyTrend, parseRange } from "@/modules/monitoring/queries";
import { revenueSummary } from "@/modules/commerce/service";
import { actionsNeedingFix } from "@/modules/actions/readiness";
import { hasFeature } from "@/modules/billing/plans";
import { ENGINE_SHORT, fmtDate, fmtMoney, fmtNumber, fmtPct, GAP_LABEL, SURFACE_LABEL } from "@/lib/format";
import { absoluteDelta, actionCta, alignPrevious, impactLevel, plainTr, previousPeriod } from "@/lib/view-models";

export const metadata: Metadata = { title: "Genel Bakış" };

/** Para birimleri ayrı, etiketli satırlarda; kur verisi olmadan tek toplama çevrilmez. */
function CurrencyAmounts({ byCurrency, fallbackCurrency }: { byCurrency: Record<string, bigint>; fallbackCurrency: string }) {
  const entries = Object.entries(byCurrency);
  if (entries.length === 0) return <>{fmtMoney(0, fallbackCurrency)}</>;
  if (entries.length === 1) return <>{fmtMoney(entries[0]![1], entries[0]![0])}</>;
  return (
    <ul className="flex flex-col gap-0.5 text-lg sm:text-[22px]">
      {entries.map(([c, v]) => (
        <li key={c} className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-text-secondary">{c}</span>
          <span>{fmtMoney(v, c)}</span>
        </li>
      ))}
    </ul>
  );
}

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
  const [needsFix, productCount, oppActions] = await Promise.all([
    actionsNeedingFix(db, recentActions),
    db.product.count({ where: { brandId, active: true } }),
    db.action.findMany({ where: { workspaceId, brandId, opportunityId: { in: topOpps.map((o) => o.id) } }, orderBy: { updatedAt: "desc" }, select: { id: true, opportunityId: true } }),
  ]);
  const actionByOpp = new Map<string, string>();
  for (const a of oppActions) if (a.opportunityId && !actionByOpp.has(a.opportunityId)) actionByOpp.set(a.opportunityId, a.id);
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

  // ── Günlük dilde özetler (yalnız gerçek veriden) ──
  const validTotal = metrics.perEngine.reduce((a, e) => a + e.validObservations, 0);
  const mentionedTotal = metrics.perEngine.reduce((a, e) => a + Math.round((e.M ?? 0) * e.validObservations), 0);
  const visibilitySentence =
    validTotal === 0 ? "Bu dönemde geçerli yanıt yok." : mentionedTotal === 0 ? `${fmtNumber(validTotal)} yanıtın hiçbirinde markanız anılmadı.` : `Markanız ${fmtNumber(validTotal)} yanıttan ${fmtNumber(mentionedTotal)} tanesinde anıldı.`;
  const leaders = metrics.sov.filter((x) => x.type === "competitor" && (x.value ?? 0) > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 3).map((x) => x.name);
  const sovSentence = competitorCount === 0 ? "Henüz onaylı rakip yok." : leaders.length ? `${leaders.join(", ")} öne çıkıyor.` : "Rakipleriniz de bu yanıtlarda anılmadı.";
  const ongoing = openOpps - newOpps;
  const oppSentence = openOpps === 0 ? "Şu an açık fırsat yok." : `${fmtNumber(newOpps)} yeni, ${fmtNumber(ongoing)} devam ediyor.`;
  const engineName = (e: string) => ENGINE_SHORT[e] ?? e;
  const missingDetail = metrics.aggregate.missingEngines.map((e) => {
    const pe = metrics.perEngine.find((x) => x.engine === e);
    if (!pe || pe.validObservations === 0) return `${engineName(e)} yanıt vermedi`;
    return `${engineName(e)} yanıtlarının yalnız %${Math.round((pe.coverage ?? 0) * 100)}'i alınabildi`;
  });
  const usedEngines = metrics.perEngine.filter((e) => !metrics.aggregate.missingEngines.includes(e.engine) && e.validObservations > 0).map((e) => engineName(e.engine));
  const scoredDays = trend.filter((d) => d.score !== null);

  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description={
          <>
            AI asistanlarında markanızın nasıl göründüğü ve bugün yapabilecekleriniz.
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
            variant="primary"
            label="Yeni ölçüm başlat"
            pendingLabel="Başlatılıyor…"
            redirectTo={`${base}/runs/{runId}`}
          />
        }
      />
      <FilterBar basePath={`${base}/dashboard`} sp={sp} timeZone={tz} engines={engines.map((e) => e.engine)} />

      {metrics.aggregate.partial ? (
        <div className="mb-6">
          <Alert tone="warning" title="Ölçüm kısmen tamamlandı">
            {missingDetail.length ? `${missingDetail.join("; ")}.` : "Seçili dönemde yeterli yanıt yok."}{" "}
            {usedEngines.length ? `Sonuçlar yalnız ${usedEngines.join(", ")} yanıtlarına dayanıyor. ` : ""}
            <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`${base}/visibility?status=failed`}>Alınamayan yanıtları gör</Link>
          </Alert>
        </div>
      ) : null}

      <section aria-label="Temel göstergeler" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MetricCard
          label="AI görünürlüğü"
          value={score ?? undefined}
          unit="/ 100"
          missing={score === null ? (metrics.sampleCount ? "Yetersiz veri" : "Henüz ölçülmüyor") : undefined}
          badge={metrics.aggregate.smallSample && score !== null ? <Badge tone="warning">Az veri</Badge> : undefined}
          sentence={visibilitySentence}
          delta={scoreDelta}
          scope={`${fmtNumber(metrics.sampleCount)} geçerli yanıt · ${range.days} gün`}
          href={`${base}/visibility${qs}`}
          linkLabel="Soruları gör"
        />
        <MetricCard
          label="Rakiplere göre görünürlük payınız"
          value={self === null ? undefined : fmtNumber(self, "tr-TR", 1)}
          unit="%"
          missing={self === null ? "Henüz ölçülmüyor" : undefined}
          sentence={sovSentence}
          delta={sovDelta}
          scope={`Aynı sorularda markanızın ve ${competitorCount} onaylı rakibin anılma payı`}
          href={`${base}/competitors${qs}`}
          linkLabel="Rakipleri gör"
        />
        <MetricCard
          label="Büyüme fırsatları"
          value={fmtNumber(openOpps)}
          sentence={oppSentence}
          scope={highOpps > 0 ? `${highOpps} yüksek öncelikli` : undefined}
          href={`${base}/opportunities`}
          linkLabel="Fırsatları gör"
        />
        {revenue ? (
          <MetricCard
            label="AI kaynaklı satış"
            value={<CurrencyAmounts byCurrency={revenue.aiNetByCurrency} fallbackCurrency={access.brand.currency} />}
            sentence={`${fmtNumber(revenue.aiOrders)} sipariş AI ziyaretleriyle eşleşti.`}
            scope={`Son dokunuş · eşleşen sipariş oranı ${fmtPct(revenue.attributionCoverage)}`}
            href={`${base}/revenue${qs}`}
            linkLabel="Geliri gör"
          />
        ) : (
          <MetricCard
            label="AI kaynaklı satış"
            missing="Henüz ölçülmüyor"
            sentence={revenueAllowed ? "Mağaza bağlantısı veya CSV sipariş aktarımı gerekiyor." : "Satış ölçümü Commerce ve üzeri paketlerde."}
            href={revenueAllowed ? `${base}/integrations` : `/w/${workspaceId}/billing`}
            linkLabel={revenueAllowed ? "Kurulumu tamamla" : "Paketleri gör"}
          />
        )}
      </section>

      <section aria-labelledby="focus" className="mt-10">
        <SectionHeader
          id="focus"
          title="Bugün yapabilecekleriniz"
          description={topOpps.length ? "Öncelik sırasına göre en fazla 3 adım." : undefined}
          action={<Link className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2 sm:min-h-0" href={`${base}/opportunities`}>Tüm fırsatlar <ArrowRight size={14} aria-hidden /></Link>}
        />
        {productCount === 0 && topOpps.length ? (
          <div className="mb-3">
            <Alert tone="warning" title="Ürün bilgileriniz eksik">
              Katalogda ürün yok; bu yüzden AI ile iyileştir taslakları ürün ayrıntısı içeremez. Önce siteyi tarayın veya ürünlerinizi aktarın.{" "}
              <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`/w/${workspaceId}/onboarding?brand=${brandId}&step=3`}>Ürün bilgilerini tamamla</Link>
            </Alert>
          </div>
        ) : null}
        {topOpps.length === 0 ? (
          <Card>
            <EmptyState title="Şu an öncelikli fırsat yok" description="Yeni ölçümler tamamlandıkça rakiplere kaybedilen sorular burada listelenir." />
          </Card>
        ) : (
          <ol className="flex flex-col gap-3">
            {topOpps.map((o, i) => {
              const comps = o.components as Components;
              const diag = o.diagnosis as DiagnosisJson & Array<{ verification?: string }>;
              const engine = diag?.[0]?.observation?.engine;
              const weakEvidence = diag?.[0]?.verification === "insufficient_evidence";
              const rawEvidence = comps.visibilityGap?.rationale ?? comps.evidenceStrength?.rationale ?? null;
              const evidence = rawEvidence ? plainTr(rawEvidence) : null;
              const actionId = actionByOpp.get(o.id);
              const continuing = o.status === "in_progress" && actionId;
              const href = continuing ? `${base}/actions/${actionId}` : `${base}/opportunities/${o.id}`;
              return (
                <li key={o.id}>
                  <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                        {continuing ? <Badge>Devam ediyor</Badge> : <Badge tone="primary">Öncelik {i + 1}</Badge>}
                        <span>{o.cluster.label}</span>
                        {engine ? <><span aria-hidden>·</span><span>{ENGINE_SHORT[engine] ?? engine}</span></> : null}
                        {weakEvidence ? <Badge tone="warning">Kanıt az</Badge> : null}
                        <ImpactBadge level={impactLevel(o)} />
                      </div>
                      <h3 className="mt-2 text-base font-semibold leading-snug">
                        <Link href={href} className="hover:underline underline-offset-2">{o.title}</Link>
                      </h3>
                      <p className="mt-1 text-sm text-text-secondary">{evidence ?? "Bu öneri henüz kanıtla doğrulanmadı."} <span className="text-xs">({GAP_LABEL[o.gapType]})</span></p>
                      {o.recommendedAction ? (
                        <p className="mt-2 text-sm">
                          <span className="font-semibold text-primary-hover">{continuing ? "Sıradaki adım: " : "Önerilen adım: "}</span>
                          {continuing ? "Taslağı gözden geçirip tamamlayın." : o.recommendedAction}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                      <Link
                        href={href}
                        className={cn(
                          "inline-flex min-h-11 items-center justify-center gap-1 rounded-[var(--radius-md)] border px-4 text-sm font-medium sm:min-h-10",
                          i === 0 && !continuing ? "border-primary bg-primary text-white hover:bg-primary-hover" : "border-border bg-surface hover:bg-surface-subtle",
                        )}
                        aria-label={`${continuing ? "Devam et" : "İncele"}: ${o.title}`}
                      >
                        {continuing ? "Devam et" : "İncele"}
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
          <CardHeader title="Görünürlük trendi" description={`Günlük AI görünürlük puanı (0–100) · kesik çizgi: önceki ${range.days} gün`} />
          <div className="px-5 pb-2 pt-4">
            {scoredDays.length > 0 && scoredDays.length < 3 ? (
              <div className="flex flex-wrap items-center gap-4 pb-4">
                <ul className="flex flex-wrap gap-2">
                  {scoredDays.map((d) => <li key={d.day} className="tabular rounded-[var(--radius-md)] bg-surface-subtle px-3 py-2 text-sm">{fmtDate(new Date(`${d.day}T12:00:00Z`), tz)} · <b>{d.score}</b></li>)}
                </ul>
                <div className="min-w-0 flex-1"><p className="font-medium">Trend için daha fazla ölçüm gerekiyor.</p><p className="text-sm text-text-secondary">Şu an {scoredDays.length} ölçüm günü var; düzenli ölçümle eğilim burada çizgi olarak görünür.</p></div>
              </div>
            ) : (
            <>
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
            </>
            )}
          </div>
          <details className="border-t border-border px-5 py-3 text-xs">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-text-secondary sm:min-h-0">Ölçüm detayları</summary>
            <div className="mt-2">
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
          </details>
        </Card>
        <Card className="xl:col-span-4">
          <CardHeader title="Platformlar" description="Her platform ayrı ölçülür (0–100)." />
          <PlatformBreakdown
            rows={metrics.perEngine.map((e) => ({
              key: e.engine,
              label: ENGINE_SHORT[e.engine] ?? e.engine,
              score: e.score,
              samples: e.validObservations,
              note: `tamamlanan ölçüm ${fmtPct(e.coverage)}${e.smallSample ? " · az veri" : ""}`,
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
          title="Son çalışmalar"
          action={<Link className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline underline-offset-2 sm:min-h-0" href={`${base}/actions`}>Tüm aksiyonlar <ArrowRight size={14} aria-hidden /></Link>}
        />
        <Card>
          {recentActions.length === 0 ? (
            <EmptyState title="Henüz aksiyon yok" description="Bir fırsatı inceleyip AI ile iyileştir taslağı oluşturduğunuzda çalışmalarınız burada görünür." />
          ) : (
            <>
            <ul className="divide-y divide-border sm:hidden">
              {recentActions.map((a) => (
                <li key={a.id} className="flex flex-col gap-1.5 px-4 py-3 text-sm">
                  <Link className="font-medium hover:underline underline-offset-2" href={`${base}/actions/${a.id}`}>{a.title}</Link>
                  <span className="break-all text-xs text-text-secondary">{a.targetUrl ?? a.opportunity?.title ?? "—"}</span>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <ActionStatusBadge status={a.status} manual={Boolean((a.measurement as { manualPublish?: boolean } | null)?.manualPublish)} needsFix={needsFix.has(a.id)} />
                    <Link className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary" href={`${base}/actions/${a.id}`} aria-label={`${actionCta(a.status)}: ${a.title}`}>{actionCta(a.status)} <ArrowRight size={14} aria-hidden /></Link>
                  </span>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
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
                      <Td><ActionStatusBadge status={a.status} manual={manual} needsFix={needsFix.has(a.id)} /></Td>
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
            </div>
            </>
          )}
        </Card>
      </section>
    </>
  );
}
