import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { ActionEditor } from "@/components/forms/action-editor";
import { ActionStatusBadge, WorkflowStepper } from "@/components/data/growth";
import { MeasurementPanel } from "@/components/data/measurement-panel";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { isUuid } from "@/modules/tenancy/access";
import { can } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import { brandMetrics } from "@/modules/monitoring/queries";
import { measurementOutcome, measurementWindows, workflowView } from "@/lib/view-models";
import { blockingIssues, type ActionContent } from "@/modules/actions/workflow";

export const metadata: Metadata = { title: "Aksiyon" };

const TYPE_LABEL: Record<string, string> = {
  content: "İçerik bloğu",
  landing: "Açılış sayfası",
  category: "Kategori metni",
  product: "Ürün açıklaması",
  comparison: "Karşılaştırma sayfası",
  faq: "SSS",
  schema: "Yapılandırılmış veri",
  citation_task: "Kaynak (outreach) görevi",
  ad_draft: "Reklam taslağı",
};

export default async function ActionPage({ params }: { params: Promise<{ workspaceId: string; brandId: string; actionId: string }> }) {
  const { workspaceId, brandId, actionId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  if (!isUuid(actionId)) notFound();
  const a = await db.action.findFirst({
    where: { id: actionId, workspaceId, brandId },
    include: { versions: { orderBy: { number: "desc" } }, approvals: { where: { revokedAt: null } }, opportunity: { select: { id: true, title: true, clusterId: true, cluster: { select: { label: true } } } } },
  });
  if (!a) notFound();
  const base = `/w/${workspaceId}/b/${brandId}`;
  const tz = access.brand.timezone;
  const ctx = { role: access.brandRole, isApprover: access.isApprover };
  const [writableConnector, failedPublication] = await Promise.all([
    db.integration.findFirst({ where: { brandId, status: "healthy", capabilities: { path: ["contentWrite"], equals: true } } }),
    a.status === "failed" ? db.publication.findFirst({ where: { workspaceId, actionId: a.id, status: "failed" }, orderBy: { createdAt: "desc" } }) : null,
  ]);
  const measurement = a.measurement as { publishAt?: string; baselineDays?: number; followUps?: number[]; manualPublish?: boolean } | null;
  const manual = Boolean(measurement?.manualPublish);
  const currentVersion = a.versions.find((v) => v.id === a.currentVersionId) ?? a.versions[0];
  const needsFix = currentVersion ? blockingIssues(currentVersion.content as unknown as ActionContent).length > 0 : false;
  let flow = workflowView(a.status, { manualPublish: manual, needsFix });

  // Ölçüm: fırsatın soru kümesi (yoksa markanın tüm soruları), yayın anı etrafında eş uzunlukta dönemler.
  let panel: ReactNode = null;
  if (measurement?.publishAt) {
    const windows = measurementWindows(new Date(measurement.publishAt), measurement.baselineDays ?? 14);
    const promptIds = a.opportunity ? (await db.prompt.findMany({ where: { workspaceId, brandId, clusterId: a.opportunity.clusterId }, select: { id: true } })).map((p) => p.id) : undefined;
    const [before, after] = await Promise.all([
      brandMetrics(db, workspaceId, brandId, { ...windows.before, promptIds }),
      brandMetrics(db, workspaceId, brandId, { ...windows.after, promptIds }),
    ]);
    const side = (m: typeof before) => ({ score: m.aggregate.score, samples: m.sampleCount, engines: m.perEngine.map((e) => e.engine).sort() });
    // Adım göstergesi ölçüm sonucuyla çelişmesin: etki hesaplanamıyorsa bunu açıkça söyler.
    const outcome = measurementOutcome(windows.partial, before.sampleCount, after.sampleCount);
    if (outcome.kind === "not_computable" && (a.status === "measuring" || a.status === "completed")) {
      flow = { ...flow, label: a.status === "completed" ? "Ölçüm tamamlandı · etki hesaplanamadı" : flow.label, tone: a.status === "completed" ? "neutral" : flow.tone, next: outcome.message };
    }
    panel = (
      <MeasurementPanel
        windows={windows}
        before={side(before)}
        after={side(after)}
        manual={manual}
        timeZone={tz}
        scopeLabel={a.opportunity ? `Soru kümesi: ${a.opportunity.cluster.label}` : "Markanın tüm soruları"}
        diagnosisHref={a.opportunity ? `${base}/opportunities/${a.opportunity.id}` : undefined}
      />
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Büyüme Fırsatları" },
          ...(a.opportunity ? [{ label: "Fırsatlar", href: `${base}/opportunities` }, { label: a.opportunity.title, href: `${base}/opportunities/${a.opportunity.id}` }] : [{ label: "Aksiyonlar", href: `${base}/actions` }]),
          { label: a.title },
        ]}
        title={a.title}
        badges={<><ActionStatusBadge status={a.status} manual={manual} needsFix={needsFix} /><Badge>{TYPE_LABEL[a.type] ?? a.type}</Badge></>}
        description={`${a.targetUrl ? `Hedef: ${a.targetUrl} · ` : ""}Son işlem ${fmtDate(a.updatedAt, tz, "tr-TR", true)}`}
      />
      <Card className="mb-6 p-5">
        <WorkflowStepper view={flow} />
        <p className="mt-3 text-sm text-text-secondary"><span className="font-medium text-text">{flow.label}.</span> {flow.next}</p>
        {measurement?.publishAt ? (
          <p className="mt-1 text-xs text-text-secondary">
            {manual ? "Manuel uygulama bildirimi" : "Yayın"}: {fmtDate(measurement.publishAt, tz, "tr-TR", true)} · Baz dönem {measurement.baselineDays ?? 14} gün · Takip {measurement.followUps?.join(" / ") ?? "—"} gün
          </p>
        ) : null}
      </Card>
      {failedPublication ? (
        <div className="mb-6">
          <Alert tone="danger" title="Yayın tamamlanamadı">
            {failedPublication.error ?? "Mağaza yanıtı başarısız."} Hedef: {failedPublication.resourceRef}. Taslak korunur; düzenleyip yeniden onaylayarak tekrar deneyebilirsiniz.
          </Alert>
        </div>
      ) : null}
      {panel ? <div className="mb-6">{panel}</div> : null}
      <ActionEditor
        api={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/actions/${a.id}`}
        action={{ id: a.id, status: a.status, version: a.version, currentVersionId: a.currentVersionId, targetUrl: a.targetUrl }}
        versions={a.versions.map((v) => ({ id: v.id, number: v.number, contentHash: v.contentHash, content: v.content as unknown as ActionContent, generated: v.generated, createdAt: v.createdAt.toISOString() }))}
        approved={a.approvals.length > 0}
        permissions={{ edit: can(ctx, "actions.draft"), approve: can(ctx, "actions.approve"), publish: can(ctx, "actions.publish"), export: can(ctx, "export") }}
        canPublishReason={writableConnector ? null : "Yazma destekli ve doğrulanmış mağaza bağlantısı yok — dışa aktarıp manuel uygulayabilirsiniz"}
        integrationsHref={`${base}/integrations`}
      />
    </>
  );
}
