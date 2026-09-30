import type { Metadata } from "next";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ApiButton } from "@/components/forms/api-button";
import { db } from "@/lib/db";
import { pageWorkspace, requireUser } from "@/lib/page-access";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Bildirimler" };

const TYPE: Record<string, string> = { "opportunity.high": "Yüksek fırsat", "integration.degraded": "Bağlantı sorunu", "usage.threshold": "Kullanım eşiği", "audit.completed": "Audit hazır", "report.ready": "Rapor hazır", "visibility.drop": "Görünürlük düşüşü", "publish.failed": "Yayın başarısız", "billing.trial": "Deneme" };

function summary(type: string, p: Record<string, unknown>) {
  if (type === "usage.threshold") return `${String(p.metric)} kullanımı %${String(p.pct)}`;
  if (type === "integration.degraded") return `${String(p.provider)}: ${String(p.reason)}`;
  return String(p.title ?? "");
}

export default async function NotificationsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await pageWorkspace(workspaceId);
  const user = await requireUser();
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const rows = await db.notification.findMany({ where: { workspaceId, userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return (
    <>
      <PageHeader title="Bildirimler" description="Uygulama içi bildirimler; e-posta tercihleri ve özet sıklığı ayarlardan yönetilir. Güvenlik/fatura bildirimleri kapatılamaz." action={rows.some((r) => !r.readAt) ? <ApiButton url={`/api/v1/workspaces/${workspaceId}/notifications`} method="PATCH" body={{ markAllRead: true }} label="Tümünü okundu işaretle" /> : null} />
      <Card>
        {rows.length === 0 ? <EmptyState title="Bildirim yok" description="Önemli olaylar burada görünür." /> : (
          <ul className="divide-y divide-border">
            {rows.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="flex items-center gap-2">{!n.readAt ? <Badge tone="primary">Yeni</Badge> : null}<strong>{TYPE[n.type] ?? n.type}</strong> {summary(n.type, n.payload as Record<string, unknown>)}</span>
                <span className="text-xs text-muted">{fmtDate(n.createdAt, ws.timezone, "tr-TR", true)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
