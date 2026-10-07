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
import { parsePricing } from "@/lib/ai-pricing";

const OPERATION: Record<string, string> = { monitor: "Hesap içi ölçüm", audit: "Ücretsiz ölçüm", generate: "AI ile iyileştir", check: "Sağlayıcı kontrolü" };

export const metadata: Metadata = { title: "Platform yönetimi", robots: { index: false } };

function describeEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return { masked: `${local.slice(0, 3)}***@${domain}`, length: email.length, nonAscii: /[^\x21-\x7e]/.test(email) };
}

/** Platform operatörü: ayrı allowlist; kullanıcı içeriği ve PII varsayılan olarak gösterilmez. */
export default async function AdminPage() {
  const u = await requireUser("/admin");
  const user = await db.user.findUnique({ where: { id: u.id } });
  if (!user || !config().platformAdmins.includes(user.email.toLowerCase())) {
    // Sayfanın varlığı gizli kalır (404). Teşhis için e-postalar maskeli loglanır (ilk 3 karakter + alan adı,
    // uzunluk ve görünmez/ASCII dışı karakter işareti); tam adres yazılmaz.
    const admins = config().platformAdmins;
    log.warn("[admin] access_denied", {
      allowlistSize: admins.length,
      session: user ? describeEmail(user.email) : "kullanıcı kaydı yok",
      allowlist: admins.map(describeEmail),
      hint: admins.length ? "Oturumdaki e-posta listede değil" : "PLATFORM_ADMIN_ALLOWLIST boş veya okunamadı (Production ortamına eklenip redeploy edildi mi?)",
    });
    notFound();
  }
  const since = daysAgo(30);
  const pricing = parsePricing(config().AI_PRICING);
  // Her bölüm ayrı yüklenir: biri hata verirse sayfa çökmez, kartta sebep gösterilir ve loglanır.
  const errors: Record<string, string> = {};
  const safe = async <T,>(key: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors[key] = msg.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 300) ?? "Bilinmeyen hata";
      log.error("[admin] section_failed", { section: key, error: msg.slice(0, 1000) });
      return fallback;
    }
  };
  const [tenants, dead, costs, inboxErrors] = await Promise.all([
    safe("tenants", db.workspace.findMany({ select: { id: true, status: true, isDemo: true, createdAt: true, subscription: { select: { planKey: true, status: true, overrideExpiresAt: true } }, _count: { select: { brands: true } } }, orderBy: { createdAt: "desc" }, take: 50 }), []),
    safe("dlq", db.jobRecord.findMany({ where: { status: "dead" }, orderBy: { updatedAt: "desc" }, take: 25, select: { id: true, type: true, deadReason: true, lastError: true, workspaceId: true, updatedAt: true } }), []),
    safe("costs", db.costLedger.groupBy({ by: ["provider", "operation", "succeeded"], where: { createdAt: { gte: since } }, _sum: { costMicros: true }, _count: { _all: true }, orderBy: [{ provider: "asc" }, { operation: "asc" }] }), []),
    safe("inbox", db.inboxEvent.count({ where: { error: { not: null } } }), 0),
  ]);
  const sectionError = (key: string) => (errors[key] ? <p role="alert" className="px-4 py-3 text-sm text-danger">Bu bölüm yüklenemedi: {errors[key]}</p> : null);
  return (
    <main id="main" className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
      <PageHeader title="Platform yönetimi" description="Tenant/billing sağlığı, sağlayıcı maliyetleri, DLQ. PII varsayılan olarak gizli; tüm müdahaleler gerekçeyle audit log'a yazılır." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Tenant'lar" description="Kimlikler pseudonymous gösterilir" />
          {sectionError("tenants")}
          <TableWrap label="Tenantlar"><thead><tr><Th>Workspace</Th><Th>Paket</Th><Th numeric>Marka</Th><Th>Oluşturma</Th><Th>Test erişimi</Th></tr></thead>
            <tbody>{tenants.map((t) => <tr key={t.id}><Td className="font-mono text-xs">{t.id.slice(0, 8)}{t.isDemo ? " (demo)" : ""}</Td><Td>{t.subscription ? `${t.subscription.planKey} · ${t.subscription.status}` : "—"}{t.subscription?.overrideExpiresAt && t.subscription.overrideExpiresAt > new Date() ? <span className="block text-xs text-warning">Test erişimi: {fmtDate(t.subscription.overrideExpiresAt)}</span> : null}</Td><Td numeric>{t._count.brands}</Td><Td className="text-muted">{fmtDate(t.createdAt)}</Td><Td>{!t.isDemo ? <span className="flex flex-col gap-1"><ApiButton url={`/api/v1/admin/workspaces/${t.id}/override`} body={{ days: 7, reason: "Ödeme öncesi uçtan uca test (teşhis + Fix with AI)" }} label="7 gün Fix with AI" onSuccessMessage="Verildi" /><ApiButton url={`/api/v1/admin/workspaces/${t.id}/override`} body={{ days: 7, scope: "commerce", reason: "Ödeme öncesi uçtan uca test (Commerce: gelir, sipariş, Ads)" }} label="7 gün Commerce testi" onSuccessMessage="Verildi" /></span> : "—"}</Td></tr>)}</tbody>
          </TableWrap>
        </Card>
        <Card>
          <CardHeader title="Sağlayıcı maliyeti (30 gün)" description={`Yalnız yöneticiler görür; müşteri ekranlarında ve API'de yer almaz. Birim fiyatlar AI_PRICING ayarından. Webhook inbox hataları: ${inboxErrors}`} />
          {sectionError("costs")}
          {sectionError("inbox")}
          <TableWrap label="Maliyet"><thead><tr><Th>Sağlayıcı</Th><Th>İşlem</Th><Th>Sonuç</Th><Th numeric>Çağrı</Th><Th numeric>Toplam USD</Th><Th numeric>Çağrı başına USD</Th></tr></thead>
            <tbody>{costs.map((c, i) => {
              const usd = Number(c._sum.costMicros ?? 0n) / 1e6;
              const priced = Boolean(pricing[c.provider]) || c.provider === "perplexity";
              return <tr key={i}><Td>{c.provider}</Td><Td>{OPERATION[c.operation] ?? c.operation}</Td><Td>{c.succeeded ? "başarılı" : "başarısız"}</Td><Td numeric>{c._count._all}</Td><Td numeric>{priced || usd > 0 ? usd.toFixed(2) : "fiyat tanımlı değil"}</Td><Td numeric>{(priced || usd > 0) && c._count._all ? (usd / c._count._all).toFixed(4) : "—"}</Td></tr>;
            })}</tbody>
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
        {sectionError("dlq")}
        <TableWrap label="DLQ"><thead><tr><Th>Job</Th><Th>Tür</Th><Th>Neden</Th><Th>Zaman</Th></tr></thead>
          <tbody>{dead.map((j) => <tr key={j.id}><Td className="font-mono text-xs">{j.id.slice(0, 8)}</Td><Td>{j.type}</Td><Td className="text-xs text-muted">{j.deadReason}: {j.lastError?.slice(0, 120)}</Td><Td className="text-muted">{fmtDate(j.updatedAt, "UTC", "tr-TR", true)}</Td></tr>)}</tbody>
        </TableWrap>
      </Card>
    </main>
  );
}
