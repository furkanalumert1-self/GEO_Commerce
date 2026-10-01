import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ActionStatusBadge, ImpactBadge, WorkflowStepper } from "@/components/data/growth";
import { impactLevel, workflowView } from "@/lib/view-models";
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

export const metadata: Metadata = { title: "Fırsat" };

const COMP_LABEL: Record<string, string> = { intent: "Ticari niyet", visibilityGap: "Görünürlük farkı", catalogFit: "Katalog uyumu", evidenceStrength: "Kanıt gücü", actionability: "Uygulanabilirlik" };
const VERIF: Record<string, string> = { verified: "Doğrulandı", likely: "Olası", insufficient_evidence: "Kanıt yetersiz" };

export default async function OpportunityPage({ params }: { params: Promise<{ workspaceId: string; brandId: string; opportunityId: string }> }) {
  const { workspaceId, brandId, opportunityId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  if (!isUuid(opportunityId)) notFound();
  const unlocked = await unlockedOpportunityIds(db, access);
  const o = await db.opportunity.findFirst({ where: { id: opportunityId, workspaceId, brandId }, include: { cluster: true, evidence: { include: { observation: { select: { engine: true, sampledAt: true, model: true } } } }, actions: { select: { id: true, title: true, status: true, measurement: true }, orderBy: { updatedAt: "desc" } } } });
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
  const api = `/api/v1/workspaces/${workspaceId}/brands/${brandId}`;
  const base = `/w/${workspaceId}/b/${brandId}`;
  const latest = o.actions[0] ?? null;
  const flow = workflowView(latest?.status, { manualPublish: Boolean((latest?.measurement as { manualPublish?: boolean } | null)?.manualPublish) });
  const activeAction = latest && !["completed", "rejected", "rolled_back"].includes(latest.status) ? latest : null;
  const fixButton = fixAllowed ? (
    <ApiButton
      url={`${api}/actions`}
      body={{ opportunityId: o.id, type: o.gapType === "structured_data" ? "schema" : o.gapType === "citation_gap" ? "citation_task" : o.gapType === "missing_comparison" ? "comparison" : "content", targetURL: o.targetUrl }}
      idempotent
      variant={activeAction ? "secondary" : "primary"}
      label={activeAction ? "Fix with AI: yeni taslak" : "Fix with AI: taslak oluştur"}
      pendingLabel="Taslak hazırlanıyor…"
      redirectTo={`${base}/actions/{id}`}
    />
  ) : (
    <span className="flex flex-col items-end gap-1">
      <button className="min-h-11 cursor-not-allowed rounded-md border border-border px-4 text-sm opacity-60 sm:min-h-10" disabled>Fix with AI</button>
      <span className="text-xs text-text-secondary">Growth ve üzeri paketlerde · <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Yükselt</Link></span>
    </span>
  );
  const summary = (
    <Card>
      <CardHeader title="Özet" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 px-5 py-4 text-sm">
        <dt className="text-text-secondary">Durum</dt>
        <dd><Badge tone="primary">{OPP_STATUS_LABEL[o.status]}</Badge></dd>
        <dt className="text-text-secondary">Etki</dt>
        <dd><ImpactBadge level={impactLevel(o)} /></dd>
        <dt className="text-text-secondary">Fırsat skoru</dt>
        <dd className="tabular">{o.score ?? "Hesaplanamadı"}{o.provisional ? " (geçici)" : ""}</dd>
        <dt className="text-text-secondary">Efor</dt>
        <dd>{o.expectedEffort ?? "Belirtilmedi"}</dd>
        <dt className="text-text-secondary">Hedef sayfa</dt>
        <dd className="min-w-0 break-all">{o.targetUrl ? <a className="text-primary underline" href={o.targetUrl} target="_blank" rel="noopener noreferrer nofollow">{o.targetUrl}</a> : "Belirlenmedi"}</dd>
        <dt className="text-text-secondary">Soru kümesi</dt>
        <dd>{o.cluster.label} · {o.locale}</dd>
      </dl>
    </Card>
  );
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Büyüme Fırsatları" }, { label: "Fırsatlar", href: `${base}/opportunities` }, { label: o.title }]}
        title={o.title}
        badges={<><Badge tone="primary">{OPP_STATUS_LABEL[o.status]}</Badge><Badge>{GAP_LABEL[o.gapType]}</Badge>{o.provisional ? <Badge tone="warning">Geçici skor</Badge> : null}</>}
        description={`${o.cluster.label} · ${o.locale}${o.targetUrl ? ` · ${o.targetUrl}` : ""}`}
        action={
          <>
            {activeAction ? (
              <Link className="inline-flex min-h-11 items-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover sm:min-h-10" href={`${base}/actions/${activeAction.id}`}>
                Aksiyona devam et
              </Link>
            ) : null}
            {fixButton}
          </>
        }
      />
      <Card className="mb-6 p-5">
        <WorkflowStepper view={flow} />
        <p className="mt-3 text-sm text-text-secondary">{latest ? <>Son aksiyon ({latest.title}): </> : null}<span className="font-medium text-text">{flow.label}.</span> {flow.next}</p>
      </Card>
      <div className="mb-6 xl:hidden">{summary}</div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Neden kaybediyorum?" description="Teşhis: gözlem, olası neden ve önerilen aksiyon ayrı gösterilir. Korelasyon nedensellik değildir." />
            <ol className="divide-y divide-border">
              {diagnosis.length === 0 ? <li className="px-5 py-4 text-sm text-text-secondary">Bu öneri henüz kanıtla doğrulanmadı.</li> : null}
              {diagnosis.map((d, i) => (
                <li key={i} className="grid gap-4 px-5 py-5 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-text-secondary">Gözlem</p>
                    {d.observation ? (
                      <>
                        <blockquote className="mt-1.5 border-l-2 border-primary/40 pl-3 text-text">&ldquo;{d.observation.quote}&rdquo;</blockquote>
                        <p className="mt-1.5 text-xs text-text-secondary">
                          {ENGINE_SHORT[d.observation.engine] ?? d.observation.engine} · {fmtDate(d.observation.sampledAt, access.brand.timezone)}
                          {d.observation.url ? <> · <a className="break-all text-primary underline" href={d.observation.url} target="_blank" rel="noopener noreferrer nofollow">{d.observation.url}</a></> : null}
                          {" · "}
                          <Link className="text-primary underline" href={`${base}/visibility?obs=${d.observation.observationId}`}>Ham yanıtı aç</Link>
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-text-secondary">Bu öneri henüz kanıtla doğrulanmadı.</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-text-secondary">Olası neden <span className="font-normal">(hipotez)</span></p>
                    <p className="mt-1">{d.possibleCause}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                      Doğrulama: <Badge tone={d.verification === "insufficient_evidence" ? "warning" : "neutral"}>{VERIF[d.verification]}</Badge> güven %{Math.round(d.confidence * 100)}
                    </p>
                  </div>
                  <div className="rounded-md bg-surface-subtle px-4 py-3">
                    <p className="text-xs font-semibold text-text-secondary">Önerilen aksiyon</p>
                    <p className="mt-1">{d.recommendation}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader title={`Kanıt (${o.evidence.length})`} description="Soru yanıtları ve tarama bulguları; kaynak bağlantıları dış sitelere gider." />
            {o.evidence.length === 0 ? <p className="px-5 py-4 text-sm text-text-secondary">Kanıt kaydı yok.</p> : null}
            <ul className="divide-y divide-border">
              {o.evidence.map((e) => (
                <li key={e.id} className="px-5 py-3 text-sm">
                  {e.quote ? <p>&ldquo;{e.quote}&rdquo;</p> : null}
                  {e.note ? <p className="text-text-secondary">{e.note}</p> : null}
                  <p className="mt-1 text-xs text-text-secondary">
                    {e.observation ? `${ENGINE_SHORT[e.observation.engine] ?? e.observation.engine} · ${e.observation.model ?? ""} · ${fmtDate(e.observation.sampledAt, access.brand.timezone)}` : "Tarama bulgusu"}
                    {e.pageUrl ? <> · <a className="break-all text-primary underline" href={e.pageUrl} target="_blank" rel="noopener noreferrer nofollow">{e.pageUrl}</a></> : null}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <div className="hidden xl:block">{summary}</div>
          {o.actions.length ? (
            <Card>
              <CardHeader title="Aksiyonlar" />
              <ul className="divide-y divide-border">
                {o.actions.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1 px-5 py-3 text-sm">
                    <Link className="font-medium text-primary underline-offset-2 hover:underline" href={`${base}/actions/${a.id}`}>{a.title}</Link>
                    <span><ActionStatusBadge status={a.status} manual={Boolean((a.measurement as { manualPublish?: boolean } | null)?.manualPublish)} /></span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={`Skor: ${o.score ?? "hesaplanamadı"}`} description="Bileşenler ve gerekçeleri" />
            <ul className="divide-y divide-border">
              {(Object.keys(OPPORTUNITY_WEIGHTS) as Array<keyof typeof OPPORTUNITY_WEIGHTS>).map((k) => (
                <li key={k} className="px-5 py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{COMP_LABEL[k]}</span>
                    <span className="tabular">{components[k]?.value ?? "Eksik"} <span className="text-xs text-text-secondary">× {OPPORTUNITY_WEIGHTS[k].toFixed(2)}</span></span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary">{components[k]?.rationale}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Takip" />
            <div className="p-5">
              <OpportunityControls url={`${api}/opportunities/${o.id}`} status={o.status} ownerId={o.ownerId} priority={o.priority} dueAt={o.dueAt?.toISOString().slice(0, 10) ?? ""} members={members.map((m) => ({ id: m.user.id, name: m.user.name ?? m.user.email }))} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Kanal" />
            <div className="p-5 text-sm">
              <p>Organik: {o.recommendedAction}</p>
              <p className="mt-2 text-text-secondary">Ücretli: {o.paidBlockedReason ?? "Uygun"}</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
