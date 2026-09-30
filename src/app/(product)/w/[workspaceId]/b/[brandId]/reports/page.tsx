import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { ApiButton } from "@/components/forms/api-button";
import { ShareReportButton } from "@/components/forms/share-report";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Raporlar" };

export default async function ReportsPage({ params }: { params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  const reports = await db.report.findMany({ where: { workspaceId, brandId }, orderBy: { createdAt: "desc" }, take: 50, include: { shareLinks: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } });
  const api = `/api/v1/workspaces/${workspaceId}/brands/${brandId}/reports`;
  return (
    <>
      <PageHeader
        title="Raporlar"
        description="Her rapor değişmez bir anlık görüntüdür; sonradan değişen pano rapora yansımaz. Varsayılan özeldir; paylaşım bağlantıları süreli ve iptal edilebilir."
        action={<ApiButton url={api} body={{ template: "executive", days: 30 }} variant="primary" label="Son 30 günün raporunu oluştur" onSuccessMessage="Rapor oluşturuldu" />}
      />
      <Card>
        <CardHeader title="Rapor geçmişi" description={`PDF render servisi bu sürümde HTML anlık görüntü + CSV olarak sunulur (tarayıcıdan yazdır → PDF).`} />
        {reports.length === 0 ? <EmptyState title="Rapor yok" description="İlk yönetici özetinizi oluşturun." /> : (
          <TableWrap label="Raporlar">
            <thead><tr><Th>Oluşturulma</Th><Th>Şablon</Th><Th>Dönem</Th><Th>Paylaşım</Th><Th>İşlem</Th></tr></thead>
            <tbody>
              {reports.map((r) => {
                const f = r.filters as { from: string; to: string };
                return (
                  <tr key={r.id}>
                    <Td>{fmtDate(r.snapshotAt ?? r.createdAt, access.brand.timezone, "tr-TR", true)}</Td>
                    <Td>{r.template === "executive" ? "Yönetici özeti" : r.template}</Td>
                    <Td className="text-muted">{fmtDate(f.from, access.brand.timezone)} – {fmtDate(f.to, access.brand.timezone)}</Td>
                    <Td>{r.shareLinks.length ? <Badge tone="warning">{r.shareLinks.length} aktif bağlantı</Badge> : <Badge>Özel</Badge>}</Td>
                    <Td>
                      <span className="flex flex-wrap gap-2">
                        <a className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm sm:min-h-9" href={`/w/${workspaceId}/b/${brandId}/reports/${r.id}`}>Görüntüle</a>
                        <a className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm sm:min-h-9" href={`${api}/${r.id}/csv`}>CSV</a>
                        <ShareReportButton url={`${api}/${r.id}/share`} />
                        {r.shareLinks.length ? <ApiButton url={`${api}/${r.id}/share`} method="DELETE" label="Paylaşımı iptal et" confirm="Tüm paylaşım bağlantıları iptal edilsin mi?" /> : null}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
