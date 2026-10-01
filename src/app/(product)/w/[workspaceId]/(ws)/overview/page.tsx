import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { pageWorkspace } from "@/lib/page-access";
import { PLANS } from "@/modules/billing/plans";
import { periodKey, usageSummary } from "@/modules/billing/quota";
import { fmtDate, fmtNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Genel bakış" };

export default async function OverviewPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await pageWorkspace(workspaceId);
  const brandFilter = access.brandIds === "all" ? {} : { id: { in: access.brandIds } };
  const [ws, brands, sub] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    db.brand.findMany({ where: { workspaceId, archivedAt: null, ...brandFilter }, orderBy: { createdAt: "asc" }, include: { runs: { orderBy: { scheduledAt: "desc" }, take: 1, select: { scheduledAt: true, status: true } }, _count: { select: { opportunities: { where: { status: { in: ["new", "triaged", "in_progress"] } } } } }, integrations: { select: { status: true } } } }),
    db.subscription.findUnique({ where: { workspaceId } }),
  ]);
  const usage = sub ? await usageSummary(db, workspaceId, periodKey(sub.currentPeriodStart)) : [];
  const au = usage.find((u) => u.metric === "answer_units");
  return (
    <>
      <PageHeader
        title={ws.name}
        badges={<><Badge tone="primary">{PLANS[access.entitlements.planKey].label}</Badge>{access.entitlements.trial ? <Badge tone="warning">Deneme · {fmtDate(sub?.trialEnd, ws.timezone)} bitiş</Badge> : null}{access.entitlements.readOnlyReason ? <Badge tone="danger">Salt okunur</Badge> : null}</>}
        description={`Rolünüz: ${access.role}. Dönem kullanımı: ${au ? `${fmtNumber(au.used)} / ${fmtNumber(au.limit)} yanıt birimi` : "—"}.`}
      />
      {brands.length === 0 ? (
        <Card><EmptyState title="Henüz marka yok" description="İlk markanızı ekleyerek kuruluma başlayın." action={<Link className="inline-flex min-h-11 items-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-white" href={`/w/${workspaceId}/onboarding`}>Marka ekle</Link>} /></Card>
      ) : (
        <Card>
          <CardHeader title="Markalar" description="Güncellik, açık fırsatlar ve bağlantı durumu" />
          <TableWrap label="Markalar">
            <thead><tr><Th>Marka</Th><Th>Son ölçüm</Th><Th numeric>Açık fırsat</Th><Th>Bağlantılar</Th><Th>Durum</Th></tr></thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.id}>
                  <Td><Link className="font-medium text-primary hover:underline" href={`/w/${workspaceId}/b/${b.id}/dashboard`}>{b.name}</Link><p className="text-xs text-muted">{b.domain}</p></Td>
                  <Td className="text-muted">{b.runs[0] ? `${fmtDate(b.runs[0].scheduledAt, b.timezone, "tr-TR", true)} · ${b.runs[0].status}` : "Henüz yok"}</Td>
                  <Td numeric>{b._count.opportunities}</Td>
                  <Td>{b.integrations.some((i) => i.status === "reauth_required" || i.status === "degraded") ? <Badge tone="warning">Dikkat gerekli</Badge> : b.integrations.length ? <Badge tone="success">{b.integrations.length} bağlı</Badge> : <Badge>Yok</Badge>}</Td>
                  <Td>{b.readOnly ? <Badge tone="danger">Salt okunur (paket limiti)</Badge> : b.verifiedAt ? <Badge tone="success">Alan adı doğrulandı</Badge> : <Badge>Doğrulanmadı</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
    </>
  );
}
