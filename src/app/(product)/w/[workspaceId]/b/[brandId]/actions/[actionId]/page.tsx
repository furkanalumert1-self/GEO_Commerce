import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { ActionEditor } from "@/components/forms/action-editor";
import { ApiButton } from "@/components/forms/api-button";
import { ActionStatusBadge, WorkflowStepper } from "@/components/data/growth";
import { MeasurementPanel } from "@/components/data/measurement-panel";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { isUuid } from "@/modules/tenancy/access";
import { can } from "@/lib/permissions";
import { ENGINE_SHORT, fmtDate } from "@/lib/format";
import { brandMetrics } from "@/modules/monitoring/queries";
import { MIN_EFFECT_SAMPLES, measurementOutcome, measurementWindows, workflowView } from "@/lib/view-models";
import { engineAvailability, recentlyBrokenEngines } from "@/modules/monitoring/start";
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
  citation_task: "Kaynak sitelere ulaşma görevi",
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
  const [writableConnector, failedPublication, productCount] = await Promise.all([
    db.integration.findFirst({ where: { brandId, status: "healthy", capabilities: { path: ["contentWrite"], equals: true } } }),
    a.status === "failed" ? db.publication.findFirst({ where: { workspaceId, actionId: a.id, status: "failed" }, orderBy: { createdAt: "desc" } }) : null,
    db.product.count({ where: { brandId, active: true } }),
  ]);
  const measurement = a.measurement as { publishAt?: string; baselineDays?: number; followUps?: number[]; manualPublish?: boolean } | null;
  const manual = Boolean(measurement?.manualPublish);
  const currentVersion = a.versions.find((v) => v.id === a.currentVersionId) ?? a.versions[0];
  const needsFix = currentVersion ? blockingIssues(currentVersion.content as unknown as ActionContent).length > 0 : false;
  let flow = workflowView(a.status, { manualPublish: manual, needsFix });

  // Ölçüm: fırsatın soru kümesi (yoksa markanın tüm soruları), yayın anı etrafında eş uzunlukta dönemler.
  let panel: ReactNode = null;
  let remeasure: ReactNode = null;
  if (measurement?.publishAt) {
    const windows = measurementWindows(new Date(measurement.publishAt), measurement.baselineDays ?? 14);
    const promptIds = a.opportunity ? (await db.prompt.findMany({ where: { workspaceId, brandId, clusterId: a.opportunity.clusterId }, select: { id: true } })).map((p) => p.id) : undefined;
    let [before, after] = await Promise.all([
      brandMetrics(db, workspaceId, brandId, { ...windows.before, promptIds }),
      brandMetrics(db, workspaceId, brandId, { ...windows.after, promptIds }),
    ]);
    // Platformlar dönemler arasında farklıysa (ör. kredisi biten platform) yalnız ortak olanlarla karşılaştırılır.
    const engOf = (m: typeof before) => m.perEngine.map((e) => e.engine);
    const shared = engOf(before).filter((e) => engOf(after).includes(e));
    let sharedEngines: string | undefined;
    if (shared.length && (shared.length !== engOf(before).length || shared.length !== engOf(after).length)) {
      [before, after] = await Promise.all([
        brandMetrics(db, workspaceId, brandId, { ...windows.before, promptIds, engines: shared }),
        brandMetrics(db, workspaceId, brandId, { ...windows.after, promptIds, engines: shared }),
      ]);
      sharedEngines = shared.map((e) => ENGINE_SHORT[e] ?? e).join(", ");
    }
    const side = (m: typeof before) => ({ score: m.aggregate.score, samples: m.sampleCount, engines: m.perEngine.map((e) => e.engine).sort() });
    // Adım göstergesi ölçüm sonucuyla çelişmesin: etki hesaplanamıyorsa bunu açıkça söyler.
    const outcome = measurementOutcome(windows.partial, before.sampleCount, after.sampleCount, { elapsedDays: windows.elapsedDays });
    if (outcome.kind !== "computable" && (a.status === "measuring" || a.status === "completed")) {
      flow = { ...flow, label: a.status === "completed" ? "Ölçüm tamamlandı · etki hesaplanamadı" : flow.label, tone: a.status === "completed" ? "neutral" : flow.tone, next: outcome.message };
    }
    // Sonuç yalnız yeni ölçümle oluşur: aynı soru kümesini tek tıkla yeniden ölçme.
    if (a.status === "measuring" && can(ctx, "runs.start")) {
      // Küçük soru kümelerinde (ör. 3 soru × 2 platform = 6 yanıt) sorular tekrarlanır: tek ölçümde en az
      // MIN_EFFECT_SAMPLES yanıta ulaşılır (en çok 3 tur). Bozuk platformlar sayılmaz; sunucu da onları çıkarır.
      const { allowed } = engineAvailability(access);
      const broken = await recentlyBrokenEngines(db, allowed);
      const engineCount = Math.max(1, allowed.filter((e) => !broken.includes(e)).length);
      const activePrompts = promptIds?.length ? await db.prompt.count({ where: { id: { in: promptIds }, active: true, archivedAt: null } }) : 0;
      const repeats = activePrompts ? Math.min(3, Math.max(1, Math.ceil(MIN_EFFECT_SAMPLES / (activePrompts * engineCount)))) : 1;
      remeasure = (
        <div className="mt-3">
          <ApiButton
            url={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/runs`}
            body={{ engines: ["chatgpt", "gemini", "claude", "perplexity"], locales: [`${access.brand.language}-${access.brand.country}`], repeats, ...(promptIds?.length ? { promptIds } : {}) }}
            idempotent
            variant="primary"
            label={a.opportunity ? "Bu soruları şimdi yeniden ölç" : "Soruları şimdi yeniden ölç"}
            pendingLabel="Başlatılıyor…"
            redirectTo={`${base}/runs/{runId}`}
          />
          <p className="mt-1 text-xs text-text-secondary">
            {activePrompts ? `${activePrompts * engineCount * repeats} yanıt · yaklaşık ${Math.max(1, Math.ceil((activePrompts * repeats * 35) / 60))} dk (sayfa açık kalmalı). ` : ""}
            Değişikliğin AI yanıtlarına yansıması birkaç gün sürebilir; en anlamlı sonuç için birkaç gün arayla tekrar ölçün.
          </p>
        </div>
      );
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
        sharedEngines={sharedEngines}
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
            {manual ? "Sitenizde uygulandı bildirimi (sizin)" : "Yayın"}: {fmtDate(measurement.publishAt, tz, "tr-TR", true)} · Karşılaştırma dönemi {measurement.baselineDays ?? 14} gün · Sonuç için aynı soruları yeniden ölçün
          </p>
        ) : null}
        {remeasure}
      </Card>
      {needsFix && ["measuring", "completed", "published"].includes(a.status) ? (
        <div className="mb-6">
          <Alert tone="warning" title="Bu kayıtta eksikler var">
            Bu içerik uygulandı olarak işaretlenmiş, ancak kayıtlı sürümde doldurulmamış alanlar bulunuyor. Bu aşamada sürüm salt okunurdur; durumu geri almak yerine
            {a.opportunity ? <> fırsattan <a className="font-medium text-primary underline" href={`${base}/opportunities/${a.opportunity.id}`}>yeni bir taslak oluşturun</a></> : " yeni bir taslak oluşturun"}
            {productCount === 0 ? <> ve önce <a className="font-medium text-primary underline" href={`/w/${workspaceId}/b/${brandId}/catalog?return=${encodeURIComponent(`/w/${workspaceId}/b/${brandId}/actions/${actionId}`)}#adaylar`}>ürün bilgilerini tamamlayın</a></> : null}.
          </Alert>
        </div>
      ) : null}
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
        setupHref={productCount === 0 ? `/w/${workspaceId}/b/${brandId}/catalog?return=${encodeURIComponent(`/w/${workspaceId}/b/${brandId}/actions/${actionId}`)}#adaylar` : undefined}
      />
    </>
  );
}
