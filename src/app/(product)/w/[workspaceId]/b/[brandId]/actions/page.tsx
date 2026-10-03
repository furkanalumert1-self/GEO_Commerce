import Link from "next/link";
import type { Metadata } from "next";
import { Card, EmptyState, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { ActionStatusBadge } from "@/components/data/growth";
import { actionCta } from "@/lib/view-models";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { hasFeature } from "@/modules/billing/plans";
import { actionsNeedingFix } from "@/modules/actions/readiness";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Aksiyonlar" };

export default async function ActionsPage({ params }: { params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  const actions = await db.action.findMany({ where: { workspaceId, brandId }, orderBy: { updatedAt: "desc" }, take: 100, include: { opportunity: { select: { title: true } } } });
  const fix = hasFeature(access.entitlements, "fix_with_ai");
  const needsFix = await actionsNeedingFix(db, actions);
  return (
    <>
      <PageHeader title="Aksiyonlar" description="Hazırlanan değişiklikler: taslak → inceleme → onay → uygulama → ölçüm. Onay içeriği yayınlamaz; mağazada yayın için yazma destekli doğrulanmış bağlantı gerekir, yoksa dışa aktarıp manuel uygulayabilirsiniz." />
      {!fix ? <p className="mb-4 text-sm text-muted">AI ile iyileştir Growth ve üzeri paketlerde. Mevcut aksiyonları görüntüleyebilir ve dışa aktarabilirsiniz.</p> : null}
      <Card>
        {actions.length === 0 ? <EmptyState title="Aksiyon yok" description="Bir fırsat sayfasından AI ile iyileştir ile taslak oluşturun." action={<Link className="text-primary underline" href={`/w/${workspaceId}/b/${brandId}/opportunities`}>Fırsatlara git</Link>} /> : (
          <TableWrap label="Aksiyonlar">
            <thead><tr><Th>Aksiyon</Th><Th>Hedef / fırsat</Th><Th>Durum</Th><Th>Son işlem</Th><Th><span className="sr-only">İşlem</span></Th></tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <Td className="max-w-[24rem]"><Link className="font-medium hover:underline underline-offset-2" href={`/w/${workspaceId}/b/${brandId}/actions/${a.id}`}>{a.title}</Link></Td>
                  <Td className="max-w-[20rem] truncate text-text-secondary" title={a.targetUrl ?? a.opportunity?.title ?? undefined}>{a.targetUrl ?? a.opportunity?.title ?? "—"}</Td>
                  <Td><ActionStatusBadge status={a.status} manual={Boolean((a.measurement as { manualPublish?: boolean } | null)?.manualPublish)} needsFix={needsFix.has(a.id)} /></Td>
                  <Td className="whitespace-nowrap text-text-secondary">{fmtDate(a.updatedAt, access.brand.timezone, "tr-TR", true)}</Td>
                  <Td className="text-right"><Link className="inline-flex min-h-11 items-center whitespace-nowrap text-sm font-medium text-primary hover:underline sm:min-h-0" href={`/w/${workspaceId}/b/${brandId}/actions/${a.id}`} aria-label={`${actionCta(a.status)}: ${a.title}`}>{actionCta(a.status)} →</Link></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
