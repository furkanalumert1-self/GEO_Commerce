import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardHeader, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { log } from "@/lib/observability/log";
import { requireUser } from "@/lib/page-access";
import { daysAgo, fmtDate } from "@/lib/format";
import { ProviderCheck } from "@/components/forms/provider-check";
import { ApiButton } from "@/components/forms/api-button";
import { AuditForm } from "@/components/forms/audit-form";

export const metadata: Metadata = { title: "Platform yönetimi", robots: { index: false } };

/** Platform operatörü: ayrı allowlist; kullanıcı içeriği ve PII varsayılan olarak gösterilmez. */
export default async function AdminPage() {
  const u = await requireUser("/admin");
  const user = await db.user.findUnique({ where: { id: u.id } });
  if (!user || !config().platformAdmins.includes(user.email.toLowerCase())) {
    // Sayfanın varlığı gizli kalır (404); teşhis için yalnız allowlist durumu loglanır, e-postalar yazılmaz.
    log.warn("[admin] access_denied", { allowlistSize: config().platformAdmins.length, hint: config().platformAdmins.length ? "Oturumdaki e-posta listede değil" : "PLATFORM_ADMIN_ALLOWLIST boş veya okunamadı (Production ortamına eklenip redeploy edildi mi?)" });
    notFound();
  }
  const since = daysAgo(30);
  const [tenants, dead, costs, inboxErrors] = await Promise.all([
    db.workspace.findMany({ select: { id: true, status: true, isDemo: true, createdAt: true, subscription: { select: { planKey: true, status: true, overrideExpiresAt: true } }, _count: { select: { brands: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.jobRecord.findMany({ where: { status: "dead" }, orderBy: { updatedAt: "desc" }, take: 25, select: { id: true, type: true, deadReason: true, lastError: true, workspaceId: true, updatedAt: true } }),
    db.costLedger.groupBy({ by: ["provider", "succeeded"], where: { createdAt: { gte: since } }, _sum: { costMicros: true }, _count: { _all: true } }),
    db.inboxEvent.count({ where: { error: { not: null } } }),
  ]);
  return (
    <main id="main" className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
      <PageHeader title="Platform yönetimi" description="Tenant/billing sağlığı, sağlayıcı maliyetleri, DLQ. PII varsayılan olarak gizli; tüm müdahaleler gerekçeyle audit log'a yazılır." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Tenant'lar" description="Kimlikler pseudonymous gösterilir" />
          <TableWrap label="Tenantlar"><thead><tr><Th>Workspace</Th><Th>Paket</Th><Th numeric>Marka</Th><Th>Oluşturma</Th><Th>Test erişimi</Th></tr></thead>
            <tbody>{tenants.map((t) => <tr key={t.id}><Td className="font-mono text-xs">{t.id.slice(0, 8)}{t.isDemo ? " (demo)" : ""}</Td><Td>{t.subscription ? `${t.subscription.planKey} · ${t.subscription.status}` : "—"}{t.subscription?.overrideExpiresAt && t.subscription.overrideExpiresAt > new Date() ? <span className="block text-xs text-warning">Test erişimi: {fmtDate(t.subscription.overrideExpiresAt)}</span> : null}</Td><Td numeric>{t._count.brands}</Td><Td className="text-muted">{fmtDate(t.createdAt)}</Td><Td>{!t.isDemo && t.subscription ? <ApiButton url={`/api/v1/admin/workspaces/${t.id}/override`} body={{ days: 7, reason: "Ödeme öncesi uçtan uca test (teşhis + Fix with AI)" }} label="7 gün Fix with AI" onSuccessMessage="Verildi" /> : "—"}</Td></tr>)}</tbody>
          </TableWrap>
        </Card>
        <Card>
          <CardHeader title="Sağlayıcı maliyeti (30 gün)" description={`Webhook inbox hataları: ${inboxErrors}`} />
          <TableWrap label="Maliyet"><thead><tr><Th>Sağlayıcı</Th><Th>Sonuç</Th><Th numeric>Deneme</Th><Th numeric>USD</Th></tr></thead>
            <tbody>{costs.map((c, i) => <tr key={i}><Td>{c.provider}</Td><Td>{c.succeeded ? "başarılı" : "başarısız"}</Td><Td numeric>{c._count._all}</Td><Td numeric>{(Number(c._sum.costMicros ?? 0n) / 1e6).toFixed(2)}</Td></tr>)}</tbody>
          </TableWrap>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Test analizi (GEO Audit)" description="Gerçek alan adıyla sıfırdan analiz. Yönetici olarak 30 günlük ücretsiz analiz limiti uygulanmaz; günlük maliyet tavanı geçerlidir. Sonuç sayfasındaki “Kaydet” ile raporu hesabınıza alıp detaylı raporu açabilirsiniz." />
        <div className="max-w-xl p-4">
          <AuditForm demo={false} />
        </div>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Sağlayıcı testi" description="AI anahtarlarını ve e-posta gönderimini kuyruk/worker olmadan doğrular." />
        <ProviderCheck />
      </Card>
      <Card className="mt-6">
        <CardHeader title="DLQ (dead jobs)" description="Yeniden oynatma: POST /api/v1/admin/jobs/:id/retry (gerekçe zorunlu)" />
        <TableWrap label="DLQ"><thead><tr><Th>Job</Th><Th>Tür</Th><Th>Neden</Th><Th>Zaman</Th></tr></thead>
          <tbody>{dead.map((j) => <tr key={j.id}><Td className="font-mono text-xs">{j.id.slice(0, 8)}</Td><Td>{j.type}</Td><Td className="text-xs text-muted">{j.deadReason}: {j.lastError?.slice(0, 120)}</Td><Td className="text-muted">{fmtDate(j.updatedAt, "UTC", "tr-TR", true)}</Td></tr>)}</tbody>
        </TableWrap>
      </Card>
    </main>
  );
}
