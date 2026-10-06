import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, Card, CardHeader, PageHeader, Provenance } from "@/components/ui";
import { ObservationEvidence } from "@/components/data/observation-evidence";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { brandEntities } from "@/modules/monitoring/service";
import { isUuid } from "@/modules/tenancy/access";
import { ENGINE_SHORT, fmtDate, fmtPct, RUN_STATUS_LABEL } from "@/lib/format";
import { customerJobError, executionMode } from "@/lib/queue";
import { InlineJobDriver } from "@/components/data/inline-job-driver";
import { isStalled, runProgress } from "@/modules/monitoring/run-status";

export const metadata: Metadata = { title: "Ölçüm çalıştırması" };

export default async function RunPage({ params }: { params: Promise<{ workspaceId: string; brandId: string; runId: string }> }) {
  const { workspaceId, brandId, runId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  if (!isUuid(runId)) notFound();
  const run = await db.monitoringRun.findFirst({ where: { id: runId, workspaceId, brandId } });
  if (!run) notFound();
  const [observations, entities, job] = await Promise.all([
    db.observation.findMany({ where: { runId }, include: { mentions: true, citations: true, promptVersion: { select: { text: true, version: true } } }, orderBy: [{ engine: "asc" }, { sampledAt: "asc" }], take: 200 }),
    brandEntities(db, brandId),
    db.jobRecord.findFirst({ where: { workspaceId, payloadRef: { path: ["runId"], equals: runId } } }),
  ]);
  const names = Object.fromEntries(entities.map((e) => [e.id, e.name]));
  const running = run.status === "queued" || run.status === "running";
  // Sayaçlar gözlemlerden canlı (çalışma bitene kadar 0/… kalmaz).
  const live = (await runProgress(db, [run])).get(run.id)!;
  const stalled = isStalled(run, live);
  const inline = executionMode() === "inline";
  return (
    <>
      <PageHeader
        title={`Ölçüm · ${fmtDate(run.scheduledAt, access.brand.timezone, "tr-TR", true)}`}
        badges={stalled ? <Badge tone="warning">Durakladı</Badge> : <Badge tone={run.status === "succeeded" ? "success" : run.status === "partial" ? "warning" : run.status === "failed" ? "danger" : "primary"}>{RUN_STATUS_LABEL[run.status] ?? run.status}</Badge>}
        description={`${run.engines.map((e) => ENGINE_SHORT[e] ?? e).join(", ")} · ${run.locales.join(", ")} · ${run.repetitions} tekrar`}
      />
      <Card className="mb-6 p-4" aria-live="polite">
        <Provenance items={[["Planlanan", String(run.scheduledCount)], ["Başarılı", String(live.succeeded)], ["Başarısız", String(live.failed)], ["Bekleyen", String(live.pending)], ["Tamamlanan ölçüm", fmtPct(run.scheduledCount ? live.succeeded / run.scheduledCount : null)], ["Config", run.configVersion], ["Tetikleyici", run.trigger]]} />
        {stalled ? <p className="mt-2 text-sm text-warning" role="status">Bu ölçüm {live.lastActivity ? fmtDate(live.lastActivity, access.brand.timezone, "tr-TR", true) : "başlangıçtan"} beri ilerlemedi. {inline ? "Redis'siz modda ölçüm yalnız bu sayfa açıkken ilerler; aşağıdan devam ettirebilirsiniz." : "İşlem kuyruğu kontrol ediliyor; sorun sürerse yeni ölçüm başlatın."} Sonuçlar tamamlanana kadar nihai değildir.</p> : null}
        {running && inline && job && !["succeeded", "partial", "dead", "canceled"].includes(job.status) ? (
          <div className="mt-3">
            <InlineJobDriver advanceUrl={`/api/v1/jobs/${job.id}/advance`} initialStatus={job.status} label="Ölçüm" />
          </div>
        ) : running ? (
          <p className="mt-2 text-sm text-muted">Çalışıyor: {live.succeeded + live.failed}/{run.scheduledCount} yanıt işlendi — sayfayı yenileyerek ilerlemeyi görebilirsiniz; kısmi sonuçlar aşağıda ve nihai değildir.</p>
        ) : null}
        {job?.status === "dead" ? <p className="mt-2 text-sm text-danger" role="alert">Ölçüm tamamlanamadı: {customerJobError(job.lastError ?? job.deadReason)}. Ayrılan kota serbest bırakıldı; yeni bir ölçüm başlatabilirsiniz.</p> : null}
        {run.status === "partial" ? <p className="mt-2 text-sm text-warning">Bazı yanıtlar alınamadı; başarısız sorgular kota tüketmez ve görünürlük düşüşü sayılmaz.</p> : null}
      </Card>
      <div className="flex flex-col gap-4">
        {observations.map((o) => (
          <Card key={o.id}>
            <CardHeader title={`${ENGINE_SHORT[o.engine] ?? o.engine} · ${o.promptVersion.text}`} />
            <div className="p-4">
              <ObservationEvidence o={o} names={names} timeZone={access.brand.timezone} />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
