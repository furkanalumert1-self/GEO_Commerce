import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, EmptyState, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { hasFeature } from "@/modules/billing/plans";
import { ACTION_STATUS_LABEL, fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Aksiyonlar" };

export default async function ActionsPage({ params }: { params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  const actions = await db.action.findMany({ where: { workspaceId, brandId }, orderBy: { updatedAt: "desc" }, take: 100, include: { opportunity: { select: { title: true } } } });
  const fix = hasFeature(access.entitlements, "fix_with_ai");
  return (
    <>
      <PageHeader title="Aksiyonlar" description="Taslak → inceleme → onay → yayın/export → ölçüm. Varsayılan yalnız taslak ve export; yayın için yazma destekli, doğrulanmış bağlantı ve onay gerekir." />
      {!fix ? <p className="mb-4 text-sm text-muted">Fix with AI Growth ve üzeri paketlerde. Mevcut aksiyonları görüntüleyebilir ve dışa aktarabilirsiniz.</p> : null}
      <Card>
        {actions.length === 0 ? <EmptyState title="Aksiyon yok" description="Bir fırsat sayfasından Fix with AI ile taslak oluşturun." action={<Link className="text-primary underline" href={`/w/${workspaceId}/b/${brandId}/opportunities`}>Fırsatlara git</Link>} /> : (
          <TableWrap label="Aksiyonlar">
            <thead><tr><Th>Aksiyon</Th><Th>Tür</Th><Th>Durum</Th><Th>Fırsat</Th><Th>Güncellendi</Th></tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <Td><Link className="font-medium text-primary hover:underline" href={`/w/${workspaceId}/b/${brandId}/actions/${a.id}`}>{a.title}</Link></Td>
                  <Td>{a.type}</Td>
                  <Td><Badge tone={a.status === "approved" || a.status === "completed" ? "success" : a.status === "rejected" || a.status === "failed" ? "danger" : "primary"}>{ACTION_STATUS_LABEL[a.status]}</Badge></Td>
                  <Td className="text-muted">{a.opportunity?.title ?? "—"}</Td>
                  <Td className="text-muted">{fmtDate(a.updatedAt, access.brand.timezone, "tr-TR", true)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
