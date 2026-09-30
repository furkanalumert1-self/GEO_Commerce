import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, PageHeader, TableWrap, Td, Th } from "@/components/ui";
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
  const o = await db.opportunity.findFirst({ where: { id: opportunityId, workspaceId, brandId }, include: { cluster: true, evidence: { include: { observation: { select: { engine: true, sampledAt: true, model: true } } } }, actions: { select: { id: true, title: true, status: true } } } });
  if (!o) notFound();
  if (unlocked !== "all" && !unlocked.has(o.id)) {
    return (
      <>
        <PageHeader title="Kilitli fırsat" />
        <Alert tone="primary" title="Bu fırsatın detayı paketinizde yok">Starter ilk 10 fırsatın detayını gösterir. <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Paketleri gör</Link></Alert>
      </>
    );
  }
  const components = o.components as unknown as OpportunityComponents;
  const diagnosis = (o.diagnosis ?? []) as unknown as DiagnosisStep[];
  const members = await db.membership.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, email: true } } } });
  const fixAllowed = hasFeature(access.entitlements, "fix_with_ai");
  const api = `/api/v1/workspaces/${workspaceId}/brands/${brandId}`;
  return (
    <>
      <PageHeader
        title={o.title}
        badges={<><Badge tone="primary">{OPP_STATUS_LABEL[o.status]}</Badge><Badge>{GAP_LABEL[o.gapType]}</Badge>{o.provisional ? <Badge tone="warning">Geçici skor</Badge> : null}</>}
        description={`${o.cluster.label} · ${o.locale} · güven %${Math.round(o.confidence * 100)}`}
        action={
          fixAllowed ? (
            <ApiButton url={`${api}/actions`} body={{ opportunityId: o.id, type: o.gapType === "structured_data" ? "schema" : o.gapType === "citation_gap" ? "citation_task" : o.gapType === "missing_comparison" ? "comparison" : "content", targetURL: o.targetUrl }} idempotent variant="primary" label="Fix with AI: taslak oluştur" pendingLabel="Taslak hazırlanıyor…" redirectTo={`/w/${workspaceId}/b/${brandId}/actions/{id}`} />
          ) : (
            <span className="flex flex-col items-end gap-1">
              <button className="min-h-11 cursor-not-allowed rounded-md border border-border px-4 text-sm opacity-60" disabled>Fix with AI</button>
              <span className="text-xs text-muted">Growth ve üzeri paketlerde · <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Yükselt</Link></span>
            </span>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Neden kaybediyorum?" description="Gözlem → olası neden → doğrulama → öneri. Korelasyon nedensellik değildir." />
            <ol className="divide-y divide-border">
              {diagnosis.map((d, i) => (
                <li key={i} className="flex flex-col gap-2 px-4 py-4 text-sm">
                  {d.observation ? (
                    <div>
                      <p className="text-xs text-muted">Gözlem · {ENGINE_SHORT[d.observation.engine] ?? d.observation.engine} · {fmtDate(d.observation.sampledAt, access.brand.timezone)}</p>
                      <blockquote className="mt-1 border-l-2 border-border pl-3">&ldquo;{d.observation.quote}&rdquo;</blockquote>
                      {d.observation.url ? <a className="text-xs break-all text-primary underline" href={d.observation.url} target="_blank" rel="noopener noreferrer nofollow">{d.observation.url}</a> : null}
                      <p className="mt-1"><Link className="text-xs text-primary underline" href={`/w/${workspaceId}/b/${brandId}/visibility?obs=${d.observation.observationId}`}>Ham yanıtı aç</Link></p>
                    </div>
                  ) : null}
                  <p><span className="text-muted">Olası neden:</span> {d.possibleCause}</p>
                  <p className="flex flex-wrap items-center gap-2"><span className="text-muted">Doğrulama:</span> <Badge tone={d.verification === "insufficient_evidence" ? "warning" : "neutral"}>{VERIF[d.verification]}</Badge> <span className="text-xs text-muted">güven %{Math.round(d.confidence * 100)}</span></p>
                  <p><span className="text-muted">Öneri:</span> {d.recommendation}</p>
                </li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader title={`Kanıt (${o.evidence.length})`} />
            <ul className="divide-y divide-border">
              {o.evidence.map((e) => (
                <li key={e.id} className="px-4 py-3 text-sm">
                  {e.quote ? <p>&ldquo;{e.quote}&rdquo;</p> : null}
                  {e.note ? <p className="text-muted">{e.note}</p> : null}
                  <p className="mt-1 text-xs text-muted">
                    {e.observation ? `${ENGINE_SHORT[e.observation.engine] ?? e.observation.engine} · ${e.observation.model ?? ""} · ${fmtDate(e.observation.sampledAt, access.brand.timezone)}` : "Tarama bulgusu"}
                    {e.pageUrl ? <> · <a className="break-all text-primary underline" href={e.pageUrl} target="_blank" rel="noopener noreferrer nofollow">{e.pageUrl}</a></> : null}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title={`Skor: ${o.score ?? "hesaplanamadı"}`} description="Bileşenler ve gerekçeleri" />
            <TableWrap label="Skor bileşenleri">
              <thead><tr><Th>Bileşen</Th><Th numeric>Ağırlık</Th><Th numeric>Değer</Th></tr></thead>
              <tbody>
                {(Object.keys(OPPORTUNITY_WEIGHTS) as Array<keyof typeof OPPORTUNITY_WEIGHTS>).map((k) => (
                  <tr key={k}>
                    <Td>
                      <p>{COMP_LABEL[k]}</p>
                      <p className="text-xs text-muted">{components[k]?.rationale}</p>
                    </Td>
                    <Td numeric>{OPPORTUNITY_WEIGHTS[k].toFixed(2)}</Td>
                    <Td numeric>{components[k]?.value ?? "Eksik"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
          <Card>
            <CardHeader title="Takip" />
            <div className="p-4">
              <OpportunityControls url={`${api}/opportunities/${o.id}`} status={o.status} ownerId={o.ownerId} priority={o.priority} dueAt={o.dueAt?.toISOString().slice(0, 10) ?? ""} members={members.map((m) => ({ id: m.user.id, name: m.user.name ?? m.user.email }))} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Kanal" />
            <div className="p-4 text-sm">
              <p>Organik: {o.recommendedAction}</p>
              <p className="mt-2 text-muted">Ücretli: {o.paidBlockedReason ?? "Uygun"}</p>
            </div>
          </Card>
          {o.actions.length ? (
            <Card>
              <CardHeader title="Aksiyonlar" />
              <ul className="divide-y divide-border">
                {o.actions.map((a) => (
                  <li key={a.id} className="px-4 py-3 text-sm"><Link className="text-primary underline" href={`/w/${workspaceId}/b/${brandId}/actions/${a.id}`}>{a.title}</Link> <Badge>{a.status}</Badge></li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
