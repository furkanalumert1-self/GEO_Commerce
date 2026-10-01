import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { ApiButton } from "@/components/forms/api-button";
import { db } from "@/lib/db";
import { pageWorkspace } from "@/lib/page-access";
import { formatUsd, PAID_PLAN_ORDER, PLANS } from "@/modules/billing/plans";
import { periodKey, usageSummary } from "@/modules/billing/quota";
import { getBillingAdapter } from "@/adapters/billing";
import { can } from "@/lib/permissions";
import { fmtDate, fmtNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Abonelik" };

const METRIC: Record<string, string> = { answer_units: "Yanıt birimi", fix_units: "Fix with AI üretimi", crawl_urls: "Crawl URL", commerce_events: "Commerce event" };

export default async function BillingPage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const access = await pageWorkspace(workspaceId);
  const ctx = { role: access.role, isApprover: access.isApprover };
  if (!can(ctx, "billing.read")) {
    return <><PageHeader title="Abonelik" /><Alert tone="neutral" title="Yetkiniz yok">Abonelik bilgileri yalnız sahip, yönetici ve faturalama rolleri içindir.</Alert></>;
  }
  const sub = await db.subscription.findUnique({ where: { workspaceId } });
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const usage = sub ? await usageSummary(db, workspaceId, periodKey(sub.currentPeriodStart)) : [];
  const billing = getBillingAdapter().status();
  const manage = can(ctx, "billing.manage");
  return (
    <>
      <PageHeader title="Abonelik ve kullanım" description="Plan değişikliği yalnız ödeme sağlayıcısının imzalı bildirimiyle uygulanır; ödeme dönüş sayfası tek başına paket açmaz. Düşürme/iptal dönem sonunda geçerlidir." />
      {sp.checkout === "return" ? <div className="mb-4"><Alert tone="primary" title="Ödeme sağlayıcısından döndünüz">Onay bildirimi alındığında paketiniz güncellenir. Bu birkaç dakika sürebilir.</Alert></div> : null}
      {billing === "not_configured" ? <div className="mb-4"><Alert tone="warning" title="Ödeme sağlayıcısı yapılandırılmamış (not_configured)">Checkout ve müşteri portalı kapalı. Ödeme başarısı simüle edilmez.</Alert></div> : null}
      {access.entitlements.readOnlyReason ? <div className="mb-4"><Alert tone="danger" title="Salt okunur mod">{access.entitlements.readOnlyReason === "past_due_grace_expired" ? "Ödeme 7 günden uzun süredir gecikmiş; ücretli işler durduruldu." : "Aktif abonelik yok; veriler okunabilir, yeni işler kapalı."}</Alert></div> : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={`Mevcut paket: ${PLANS[access.entitlements.planKey].label}`} description={sub ? `Durum: ${sub.status}${sub.cancelAtPeriodEnd ? " · dönem sonunda iptal" : ""} · Dönem ${fmtDate(sub.currentPeriodStart, ws.timezone)} – ${fmtDate(sub.currentPeriodEnd, ws.timezone)} (UTC döngü)` : "Abonelik yok"} action={sub?.billingCustomerId && manage ? <ApiButton url={`/api/v1/workspaces/${workspaceId}/billing/portal`} label="Faturalar ve ödeme yöntemi" redirectTo="{url}" disabled={billing !== "ready"} disabledReason="Sağlayıcı yapılandırılmamış" /> : null} />
          <TableWrap label="Kullanım">
            <thead><tr><Th>Metrik</Th><Th numeric>Kullanılan</Th><Th numeric>Ayrılmış</Th><Th numeric>Limit</Th><Th numeric>%</Th></tr></thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.metric}><Td>{METRIC[u.metric] ?? u.metric}</Td><Td numeric>{fmtNumber(u.used)}</Td><Td numeric>{fmtNumber(u.reserved)}</Td><Td numeric>{fmtNumber(u.limit)}</Td><Td numeric>{u.pct === null ? "—" : <Badge tone={u.pct >= 100 ? "danger" : u.pct >= 80 ? "warning" : "neutral"}>%{u.pct}</Badge>}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="border-t border-border px-4 py-3 text-xs text-muted">Aylık dönem devretmez. %80 ve %100 eşiklerinde bildirim gönderilir; limitte yeni işler durur. Otomatik aşım ücreti kapalıdır.</p>
        </Card>
        <Card>
          <CardHeader title="Paket değiştir" description="USD/ay; vergi ve reklam harcaması hariç." />
          <ul className="divide-y divide-border">
            {PAID_PLAN_ORDER.map((k) => (
              <li key={k} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span><strong>{PLANS[k].label}</strong> · {formatUsd(PLANS[k].monthlyPriceUsdCents)}/ay · {PLANS[k].limits.brands} marka · {fmtNumber(PLANS[k].limits.answerUnits)} yanıt birimi</span>
                {k === access.entitlements.planKey && !access.entitlements.trial ? <Badge tone="success">Mevcut</Badge> : manage ? <ApiButton url={`/api/v1/workspaces/${workspaceId}/billing/checkout`} body={{ planKey: k }} label="Seç" redirectTo="{url}" disabled={billing !== "ready"} disabledReason="Ödeme sağlayıcısı yapılandırılmamış" /> : null}
              </li>
            ))}
            <li className="px-4 py-3 text-sm">Enterprise · teklif (sözleşme limitleri, SSO/SLA sözleşmeye bağlıdır)</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
