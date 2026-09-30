import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, PageHeader } from "@/components/ui";
import { ActionEditor } from "@/components/forms/action-editor";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { isUuid } from "@/modules/tenancy/access";
import { can } from "@/lib/permissions";
import { ACTION_STATUS_LABEL, fmtDate } from "@/lib/format";
import type { ActionContent } from "@/modules/actions/workflow";

export const metadata: Metadata = { title: "Aksiyon" };

export default async function ActionPage({ params }: { params: Promise<{ workspaceId: string; brandId: string; actionId: string }> }) {
  const { workspaceId, brandId, actionId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  if (!isUuid(actionId)) notFound();
  const a = await db.action.findFirst({ where: { id: actionId, workspaceId, brandId }, include: { versions: { orderBy: { number: "desc" } }, approvals: { where: { revokedAt: null } }, opportunity: { select: { id: true, title: true } } } });
  if (!a) notFound();
  const ctx = { role: access.brandRole, isApprover: access.isApprover };
  const writableConnector = await db.integration.findFirst({ where: { brandId, status: "healthy", capabilities: { path: ["contentWrite"], equals: true } } });
  const measurement = a.measurement as { publishAt?: string; baselineDays?: number; followUps?: number[] } | null;
  return (
    <>
      <PageHeader
        title={a.title}
        badges={<><Badge tone="primary">{ACTION_STATUS_LABEL[a.status]}</Badge><Badge>{a.type}</Badge></>}
        description={a.opportunity ? <>Fırsat: <Link className="text-primary underline" href={`/w/${workspaceId}/b/${brandId}/opportunities/${a.opportunity.id}`}>{a.opportunity.title}</Link></> : undefined}
      />
      {measurement?.publishAt ? (
        <div className="mb-4 rounded-md border border-border bg-surface p-4 text-sm">
          <p className="font-medium">Ölçüm döngüsü</p>
          <p className="text-muted">Yayın: {fmtDate(measurement.publishAt, access.brand.timezone)} · Baz dönem {measurement.baselineDays} gün · Takip {measurement.followUps?.join(" / ")} gün. Görünürlük, citation, trafik ve gelir farkları ayrı gösterilir; bu değişikliğin satış yarattığı iddia edilmez. Aynı dönemdeki site/model/stok değişiklikleri karıştırıcı etken olabilir.</p>
        </div>
      ) : null}
      <ActionEditor
        api={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/actions/${a.id}`}
        action={{ id: a.id, status: a.status, version: a.version, currentVersionId: a.currentVersionId, targetUrl: a.targetUrl }}
        versions={a.versions.map((v) => ({ id: v.id, number: v.number, contentHash: v.contentHash, content: v.content as unknown as ActionContent, generated: v.generated, createdAt: v.createdAt.toISOString() }))}
        approved={a.approvals.length > 0}
        permissions={{ edit: can(ctx, "actions.draft"), approve: can(ctx, "actions.approve"), publish: can(ctx, "actions.publish"), export: can(ctx, "export") }}
        canPublishReason={writableConnector ? null : "Yazma destekli ve doğrulanmış mağaza bağlantısı yok — export ile manuel yayımlayın"}
      />
    </>
  );
}
