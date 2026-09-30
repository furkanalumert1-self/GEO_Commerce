import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, Card, CardHeader, PageHeader, Provenance } from "@/components/ui";
import { ObservationEvidence } from "@/components/data/observation-evidence";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { brandEntities } from "@/modules/monitoring/service";
import { isUuid } from "@/modules/tenancy/access";
import { ENGINE_SHORT, fmtDate, fmtPct } from "@/lib/format";

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
  return (
    <>
      <PageHeader
        title={`Ölçüm · ${fmtDate(run.scheduledAt, access.brand.timezone, "tr-TR", true)}`}
        badges={<Badge tone={run.status === "succeeded" ? "success" : run.status === "partial" ? "warning" : run.status === "failed" ? "danger" : "primary"}>{run.status}</Badge>}
        description={`${run.engines.map((e) => ENGINE_SHORT[e] ?? e).join(", ")} · ${run.locales.join(", ")} · ${run.repetitions} tekrar`}
      />
      <Card className="mb-6 p-4" aria-live="polite">
        <Provenance items={[["Planlanan", String(run.scheduledCount)], ["Başarılı", String(run.completedCount)], ["Başarısız", String(run.failedCount)], ["Coverage", fmtPct(run.coverage)], ["Config", run.configVersion], ["Tetikleyici", run.trigger]]} />
        {running ? <p className="mt-2 text-sm text-muted">Çalışıyor: {job ? `${job.progressDone}/${job.progressTotal || run.scheduledCount}` : "sırada"} — sayfayı yenileyerek ilerlemeyi görebilirsiniz; kısmi sonuçlar aşağıda.</p> : null}
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
