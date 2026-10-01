import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { ApiButton } from "@/components/forms/api-button";
import { CompetitorForm } from "@/components/forms/competitor-form";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { brandMetrics, parseRange } from "@/modules/monitoring/queries";
import { fmtNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Rakipler" };

export default async function CompetitorsPage({ params }: { params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  const range = parseRange({});
  const [comps, metrics] = await Promise.all([db.competitor.findMany({ where: { brandId, workspaceId }, orderBy: [{ archivedAt: "asc" }, { createdAt: "asc" }] }), brandMetrics(db, workspaceId, brandId, { from: range.from, to: range.to })]);
  const sov = Object.fromEntries(metrics.sov.map((s) => [s.id, s.value]));
  const active = comps.filter((c) => c.confirmedAt && !c.archivedAt).length;
  const api = `/api/v1/workspaces/${workspaceId}/brands/${brandId}/competitors`;
  return (
    <>
      <PageHeader title="Rakipler" description="Yalnız onaylı rakipler SOV ve fırsat hesabına girer. Kaldırma arşivler; tarihsel ölçüm korunur." badges={<Badge>{active} / {access.entitlements.competitorsPerBrand} onaylı</Badge>} />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Rakip listesi" description="Rekabet payı: son 30 gün, aynı soru kümesi" />
          {comps.length === 0 ? <EmptyState title="Rakip yok" description="Formdan rakip ekleyin veya audit'teki adayları onaylayın." /> : (
            <TableWrap label="Rakipler">
              <thead><tr><Th>Rakip</Th><Th>Kaynak</Th><Th>Durum</Th><Th numeric>SOV</Th><Th>İşlem</Th></tr></thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={c.id}>
                    <Td><p className="font-medium">{c.name}</p><p className="text-xs text-muted">{c.domain}</p></Td>
                    <Td className="text-muted">{c.source === "ai_candidate" ? "AI adayı" : c.source === "domain_finding" ? "Alan adı bulgusu" : "Kullanıcı"}</Td>
                    <Td>{c.archivedAt ? <Badge>Arşivde</Badge> : c.confirmedAt ? <Badge tone="success">Onaylı</Badge> : <Badge tone="warning">Onay bekliyor</Badge>}</Td>
                    <Td numeric>{c.confirmedAt && !c.archivedAt && sov[c.id] != null ? `%${fmtNumber(sov[c.id]!, "tr-TR", 1)}` : "—"}</Td>
                    <Td>
                      {c.archivedAt || !c.confirmedAt ? (
                        <ApiButton url={`${api}/${c.id}`} method="PATCH" label="Onayla" disabled={active >= access.entitlements.competitorsPerBrand} disabledReason="Paket limiti dolu" />
                      ) : (
                        <ApiButton url={`${api}/${c.id}`} method="DELETE" label="Arşivle" confirm={`${c.name} arşivlensin mi? Rekabet payı karşılaştırma kümesi değişir; geçmiş veriler korunur.`} />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
        <Card>
          <CardHeader title="Rakip ekle" />
          <div className="p-4"><CompetitorForm url={api} /></div>
        </Card>
      </div>
    </>
  );
}
