import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { BrandCreateForm } from "@/components/forms/brand-create";
import { db } from "@/lib/db";
import { pageWorkspace } from "@/lib/page-access";
import { periodKey, usageSummary } from "@/modules/billing/quota";
import { fmtDate, fmtNumber } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Müşteriler" };

/** Ajans: müşteri (marka) tablosu, havuz kullanımı, uyarılar. Cross-brand toplam yalnız yetkili markaları kapsar. */
export default async function ClientsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await pageWorkspace(workspaceId);
  const brandFilter = access.brandIds === "all" ? {} : { id: { in: access.brandIds } };
  const [brands, sub, grants] = await Promise.all([
    db.brand.findMany({ where: { workspaceId, archivedAt: null, ...brandFilter }, orderBy: { createdAt: "asc" }, include: { _count: { select: { prompts: { where: { active: true } }, opportunities: true } }, runs: { orderBy: { scheduledAt: "desc" }, take: 1, select: { scheduledAt: true } } } }),
    db.subscription.findUnique({ where: { workspaceId } }),
    db.brandGrant.findMany({ where: { workspaceId }, include: { membership: { include: { user: { select: { email: true } } } } } }),
  ]);
  const usage = sub ? await usageSummary(db, workspaceId, periodKey(sub.currentPeriodStart)) : [];
  const au = usage.find((u) => u.metric === "answer_units");
  const canManage = can({ role: access.role, isApprover: access.isApprover }, "brand.manage");
  return (
    <>
      <PageHeader title="Müşteriler" description={`Havuz: ${brands.length} / ${access.entitlements.brands} marka · ${au ? `${fmtNumber(au.used)} / ${fmtNumber(au.limit)}` : "—"} yanıt birimi. Marka bütçeleri ortak havuzu aşamaz.`} />
      {au && au.pct !== null && au.pct >= 80 ? <div className="mb-4"><Alert tone="warning" title={`Havuz kullanımı %${au.pct}`}>Limitte yeni ölçümler durur; veriler okunabilir kalır.</Alert></div> : null}
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <TableWrap label="Müşteri markaları">
            <thead><tr><Th>Müşteri</Th><Th numeric>Aktif prompt</Th><Th numeric>Fırsat</Th><Th>Son veri</Th><Th>Müşteri erişimi</Th></tr></thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.id}>
                  <Td><Link className="font-medium text-primary hover:underline" href={`/w/${workspaceId}/b/${b.id}/dashboard`}>{b.name}</Link><p className="text-xs text-muted">{b.domain}</p></Td>
                  <Td numeric>{b._count.prompts}</Td>
                  <Td numeric>{b._count.opportunities}</Td>
                  <Td className="text-muted">{b.runs[0] ? fmtDate(b.runs[0].scheduledAt, b.timezone) : <Badge tone="warning">Veri yok</Badge>}</Td>
                  <Td className="text-xs text-muted">{grants.filter((g) => g.brandId === b.id).map((g) => g.membership.user.email).join(", ") || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
        {canManage ? (
          <Card>
            <CardHeader title="Müşteri ekle" />
            <div className="p-4">{brands.length >= access.entitlements.brands ? <p className="text-sm text-muted">Paket marka limiti doldu.</p> : <BrandCreateForm url={`/api/v1/workspaces/${workspaceId}/brands`} workspaceId={workspaceId} />}</div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
