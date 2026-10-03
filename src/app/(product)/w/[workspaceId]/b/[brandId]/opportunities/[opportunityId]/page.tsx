import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ActionStatusBadge, ImpactBadge, WorkflowStepper } from "@/components/data/growth";
import { impactLevel, plainTr, workflowView } from "@/lib/view-models";
import { actionsNeedingFix } from "@/modules/actions/readiness";
import { ApiButton } from "@/components/forms/api-button";
import { OpportunityControls } from "@/components/forms/opportunity-controls";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { isUuid } from "@/modules/tenancy/access";
import { unlockedOpportunityIds } from "@/modules/opportunities/access";
import { OPPORTUNITY_WEIGHTS, type OpportunityComponents } from "@/modules/opportunities/scoring";
import type { DiagnosisStep } from "@/modules/opportunities/engine";
import { hasFeature } from "@/modules/billing/plans";
import { ENGINE_SHORT, fmtDate, GAP_LABEL, OPP_STATUS_LABEL } from "@/lib/format";
import { cleanQuote } from "@/lib/quote";

export const metadata: Metadata = { title: "Fırsat" };

const COMP_LABEL: Record<string, string> = { intent: "Ticari niyet", visibilityGap: "Görünürlük farkı", catalogFit: "Katalog uyumu", evidenceStrength: "Kanıt gücü", actionability: "Uygulanabilirlik" };
const VERIF: Record<string, string> = { verified: "Doğrulandı", likely: "Olası", insufficient_evidence: "Kanıt yetersiz" };

export default async function OpportunityPage({ params }: { params: Promise<{ workspaceId: string; brandId: string; opportunityId: string }> }) {
  const { workspaceId, brandId, opportunityId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  if (!isUuid(opportunityId)) notFound();
  const unlocked = await unlockedOpportunityIds(db, access);
  const o = await db.opportunity.findFirst({ where: { id: opportunityId, workspaceId, brandId }, include: { cluster: true, evidence: { include: { observation: { select: { engine: true, sampledAt: true, model: true } } } }, actions: { select: { id: true, title: true, status: true, measurement: true, currentVersionId: true }, orderBy: { updatedAt: "desc" } } } });
  if (!o) notFound();
  if (unlocked !== "all" && !unlocked.has(o.id)) {
    return (
      <>
        <PageHeader title="Kilitli fırsat" breadcrumb={[{ label: "Fırsatlar", href: `/w/${workspaceId}/b/${brandId}/opportunities` }, { label: "Kilitli fırsat" }]} />
        <Alert tone="primary" title="Bu fırsatın detayı paketinizde yok">Starter ilk 10 fırsatın detayını gösterir. <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Paketleri gör</Link></Alert>
      </>
    );
  }
  const components = o.components as unknown as OpportunityComponents;
  const diagnosis = (o.diagnosis ?? []) as unknown as DiagnosisStep[];
  const members = await db.membership.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, email: true } } } });
  const fixAllowed = hasFeature(access.entitlements, "fix_with_ai");
  const productCount = await db.product.count({ where: { brandId, active: true } });
  const setupHref = `/w/${workspaceId}/onboarding?brand=${brandId}&step=3`;
  const api = `/api/v1/workspaces/${workspaceId}/brands/${brandId}`;
  const base = `/w/${workspaceId}/b/${brandId}`;
  const latest = o.actions[0] ?? null;
  const needsFix = await actionsNeedingFix(db, o.actions);
  const flow = workflowView(latest?.status, { manualPublish: Boolean((latest?.measurement as { manualPublish?: boolean } | null)?.manualPublish), needsFix: latest ? needsFix.has(latest.id) : false });
  const activeAction = latest && !["completed", "rejected", "rolled_back"].includes(latest.status) ? latest : null;
  const fixButton = fixAllowed ? (
    <ApiButton
      url={`${api}/actions`}
      body={{ opportunityId: o.id, type: o.gapType === "structured_data" ? "schema" : o.gapType === "citation_gap" ? "citation_task" : o.gapType === "missing_comparison" ? "comparison" : "content", targetURL: o.targetUrl }}
      idempotent
      variant={activeAction || productCount === 0 ? "secondary" : "primary"}
      label={activeAction ? "AI ile iyileştir: yeni taslak" : "AI ile iyileştir: taslak hazırla"}
      pendingLabel="Taslak hazırlanıyor…"
      redirectTo={`${base}/actions/{id}`}
    />
  ) : (
    <span className="flex flex-col items-end gap-1">
      <button className="min-h-11 cursor-not-allowed rounded-md border border-border px-4 text-sm opacity-60 sm:min-h-10" disabled>AI ile iyileştir</button>
      <span className="text-xs text-text-secondary">Growth ve üzeri paketlerde · <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Yükselt</Link></span>
    </span>
  );
  const first = diagnosis[0] ?? null;
  const weakEvidence = first?.verification === "insufficient_evidence";
  const intent = components.intent?.value ?? null;
  const setupLink = (
    <Link className="inline-flex min-h-11 items-center rounded-[var(--radius-md)] border border-primary bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover sm:min-h-10" href={setupHref}>
      Ürün bilgilerini tamamla
    </Link>
  );
  const summary = (
    <Card>
      <CardHeader title="Kısa özet" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 px-5 pb-5 text-sm sm:px-6">
        <dt className="text-text-secondary">Durum</dt>
        <dd className="text-right"><Badge>{OPP_STATUS_LABEL[o.status]}</Badge></dd>
        <dt className="text-text-secondary">Kanıt</dt>
        <dd className="text-right">{first ? <Badge tone={weakEvidence ? "warning" : "success"}>{VERIF[first.verification]} · {o.evidence.length} kayıt</Badge> : <Badge tone="warning">Kanıt yok</Badge>}</dd>
        <dt className="text-text-secondary">Tahmini etki</dt>
        <dd className="text-right"><ImpactBadge level={impactLevel(o)} /></dd>
        <dt className="text-text-secondary">Son aksiyon</dt>
        <dd className="text-right">{latest ? <ActionStatusBadge status={latest.status} manual={Boolean((latest.measurement as { manualPublish?: boolean } | null)?.manualPublish)} needsFix={needsFix.has(latest.id)} /> : "Henüz yok"}</dd>
        <dt className="text-text-secondary">Hedef sayfa</dt>
        <dd className="min-w-0 break-all text-right">{o.targetUrl ? <a className="text-primary underline" href={o.targetUrl} target="_blank" rel="noopener noreferrer nofollow">{o.targetUrl}</a> : "Belirlenmedi"}</dd>
        <dt className="text-text-secondary">Soru kümesi</dt>
        <dd className="text-right">{o.cluster.label}</dd>
      </dl>
      {weakEvidence ? <p className="border-t border-border px-5 py-3 text-xs text-text-secondary sm:px-6">Kanıt az olduğu için sonucu kesin kabul etmeyin; yeni bir ölçüm sonucu güçlendirir.</p> : null}
    </Card>
  );
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Büyüme Fırsatları" }, { label: "Fırsatlar", href: `${base}/opportunities` }, { label: o.title }]}
        title={o.title}
        badges={<><Badge>{OPP_STATUS_LABEL[o.status]}</Badge>{o.provisional ? <Badge tone="warning">Geçici puan</Badge> : null}</>}
        description={`${o.cluster.label} sorularında rakipleriniz AI yanıtlarında öne çıkıyor.`}
        action={
          <>
            {productCount === 0 ? setupLink : activeAction ? (
              <Link className="inline-flex min-h-11 items-center rounded-[var(--radius-md)] border border-primary bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover sm:min-h-10" href={`${base}/actions/${activeAction.id}`}>
                Aksiyona devam et
              </Link>
            ) : null}
            {fixButton}
          </>
        }
      />
      <Card className="mb-6 p-5 sm:px-6">
        <WorkflowStepper view={flow} />
        <p className="mt-3 text-sm text-text-secondary">{latest ? <>{latest.title}: </> : null}<span className="font-medium text-text">{flow.label}.</span> {flow.next}</p>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Ne oldu?" />
            <div className="px-5 pb-5 text-sm sm:px-6">
              {first?.observation ? (
                <>
                  <p>{ENGINE_SHORT[first.observation.engine] ?? first.observation.engine} yanıtında rakipler öne çıktı; markanız bu yanıtta önerilmedi.</p>
                  <blockquote className="mt-3 rounded-r-[12px] border-l-[3px] border-primary bg-surface-subtle px-4 py-3 text-text">&ldquo;{cleanQuote(first.observation.quote, 2000)}&rdquo;</blockquote>
                  <p className="mt-2 text-xs text-text-secondary">
                    {ENGINE_SHORT[first.observation.engine] ?? first.observation.engine} · {fmtDate(first.observation.sampledAt, access.brand.timezone)}
                    {first.observation.url ? <> · <a className="break-all text-primary underline" href={first.observation.url} target="_blank" rel="noopener noreferrer nofollow">Kaynak</a></> : null}
                    {" · "}
                    <Link className="text-primary underline" href={`${base}/visibility?obs=${first.observation.observationId}`}>Yanıtın tamamını gör</Link>
                  </p>
                </>
              ) : (
                <p className="text-text-secondary">Bu öneri henüz kanıtla doğrulanmadı.</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Neden önemli?" />
            <div className="px-5 pb-5 text-sm sm:px-6">
              <p>{intent !== null ? `Bu soru grubu satın almaya yakın bir niyet taşıyor (ticari niyet ${intent}/100). ` : ""}AI yanıtında görünmemek, bu soruyu soran müşterinin markanızı hiç görmemesi demek.</p>
              {first ? <p className="mt-2 text-text-secondary"><span className="font-medium text-text">Olası neden (hipotez):</span> {first.possibleCause}</p> : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="Ne yapabilirim?" />
            <div className="px-5 pb-5 text-sm sm:px-6">
              <p>{first?.recommendation ?? o.recommendedAction ?? "Öneri henüz oluşturulmadı."}</p>
              {productCount === 0 ? (
                <div className="mt-4"><Alert tone="warning" title="Önce ürün bilgilerinizi tamamlayın">Katalogda ürün yok; AI ile iyileştir taslağı ürün ayrıntısı içeremez ve eksik alanlarla gelir. Siteyi tarayın veya ürünlerinizi aktarın.</Alert></div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {productCount === 0 ? setupLink : null}
                {fixButton}
              </div>
            </div>
            <details className="border-t border-border">
              <summary className="no-marker flex min-h-11 cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium text-primary sm:px-6">Ayrıntıları gör <span aria-hidden>▾</span></summary>
              <div className="flex flex-col gap-5 px-5 pb-5 text-sm sm:px-6">
                <div>
                  <p className="font-medium">Fırsat puanı: {o.score ?? "hesaplanamadı"}{o.provisional ? " (geçici)" : ""}</p>
                  <ul className="mt-2 divide-y divide-border">
                    {(Object.keys(OPPORTUNITY_WEIGHTS) as Array<keyof typeof OPPORTUNITY_WEIGHTS>).map((k) => (
                      <li key={k} className="py-2">
                        <div className="flex items-baseline justify-between gap-2"><span>{COMP_LABEL[k]}</span><span className="tabular">{components[k]?.value ?? "Bilinmiyor"}</span></div>
                        {components[k]?.rationale ? <p className="mt-0.5 text-xs text-text-secondary">{plainTr(components[k].rationale)}</p> : null}
                      </li>
                    ))}
                  </ul>
                </div>
                {diagnosis.length > 1 || o.evidence.length > 1 ? (
                  <div>
                    <p className="font-medium">Tüm kanıtlar ({o.evidence.length})</p>
                    <ul className="mt-2 divide-y divide-border">
                      {o.evidence.map((e) => (
                        <li key={e.id} className="py-2">
                          {e.quote ? <p>&ldquo;{cleanQuote(e.quote, 2000)}&rdquo;</p> : null}
                          {e.note ? <p className="text-text-secondary">{e.note}</p> : null}
                          <p className="mt-1 text-xs text-text-secondary">{e.observation ? `${ENGINE_SHORT[e.observation.engine] ?? e.observation.engine} · ${fmtDate(e.observation.sampledAt, access.brand.timezone)}` : "Tarama bulgusu"}{e.pageUrl ? <> · <a className="break-all text-primary underline" href={e.pageUrl} target="_blank" rel="noopener noreferrer nofollow">{e.pageUrl}</a></> : null}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="text-text-secondary">
                  <p><span className="font-medium text-text">Tür:</span> {GAP_LABEL[o.gapType]} · <span className="font-medium text-text">Doğrulama:</span> {first ? `${VERIF[first.verification]} (güven %${Math.round(first.confidence * 100)})` : "—"}</p>
                  <p className="mt-1"><span className="font-medium text-text">Ücretli kanal:</span> {o.paidBlockedReason ?? "Uygun"}</p>
                  <p className="mt-1 text-xs">Teşhis bir hipotezdir; korelasyon nedensellik değildir.</p>
                </div>
              </div>
            </details>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {summary}
          {o.actions.length ? (
            <Card>
              <CardHeader title="Aksiyonlar" />
              <ul className="divide-y divide-border">
                {o.actions.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:px-6">
                    <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`${base}/actions/${a.id}`}>{a.title}</Link>
                    <span><ActionStatusBadge status={a.status} manual={Boolean((a.measurement as { manualPublish?: boolean } | null)?.manualPublish)} needsFix={needsFix.has(a.id)} /></span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Takip" description="Ekip içi iş durumu; aksiyon aşamasından ayrı güncellenir." />
            <div className="px-5 pb-5 sm:px-6">
              <OpportunityControls url={`${api}/opportunities/${o.id}`} status={o.status} ownerId={o.ownerId} priority={o.priority} dueAt={o.dueAt?.toISOString().slice(0, 10) ?? ""} members={members.map((m) => ({ id: m.user.id, name: m.user.name ?? m.user.email }))} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
