import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Stat, TableWrap, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/layout/filter-bar";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { hasFeature } from "@/modules/billing/plans";
import { revenueAvailability } from "@/modules/commerce/availability";
import { revenueSummary } from "@/modules/commerce/service";
import { FIRST_TOUCH, LAST_NON_DIRECT } from "@/modules/attribution/engine";
import { parseRange } from "@/modules/monitoring/queries";
import { CHANNEL_LABEL, fmtDate, fmtMoney, fmtNumber, fmtPct } from "@/lib/format";

export const metadata: Metadata = { title: "Gelir" };

export default async function RevenuePage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const base = `/w/${workspaceId}/b/${brandId}/revenue`;
  if (!hasFeature(access.entitlements, "revenue")) {
    return (
      <>
        <PageHeader title="Gelir" />
        <Alert tone="primary" title="Gelir ölçümü paketinizde yok">AI&apos;dan gelen ziyaretlerin siparişe dönüşünü görmek Commerce ve Agency paketlerinde. <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Paketleri gör</Link></Alert>
      </>
    );
  }
  const range = parseRange(sp);
  const model = sp.model === "first" ? FIRST_TOUCH : LAST_NON_DIRECT;
  const availability = await revenueAvailability(db, { workspaceId, brandId }, access.entitlements);
  if (availability.state === "inactive") {
    return (
      <>
        <PageHeader title="Gelir" />
        <Card><EmptyState title="Gelir ölçümü etkin değil" description="Bu markada sipariş kaynağı yok; bu yüzden satış gösterilmez (0 satış anlamına gelmez). Mağazanızı bağlayın veya sipariş dosyası yükleyin." action={<Link className="text-primary underline" href={`/w/${workspaceId}/b/${brandId}/integrations#gelir`}>Gelir ölçümünü etkinleştir</Link>} /></Card>
      </>
    );
  }
  const rev = await revenueSummary(db, workspaceId, brandId, { from: range.from, to: range.to, model });
  const q = (m: string) => `${base}?${new URLSearchParams({ ...(sp.range ? { range: sp.range } : {}), model: m })}`;
  return (
    <>
      <PageHeader
        title="Gözlemlenen gelir"
        description="Mağaza siparişleriyle doğrulanan, izinli ölçümle eşleşen oturumlar. Net gelir = indirim sonrası ürün toplamı − ürün iadeleri (vergi/kargo hariç). Muhasebe kaydı değildir."
        action={<span className="flex gap-1 text-sm"><Link className={model === LAST_NON_DIRECT ? "font-medium" : "text-primary underline"} href={q("last")}>Son dokunuş (varsayılan)</Link><span aria-hidden>·</span><Link className={model === FIRST_TOUCH ? "font-medium" : "text-primary underline"} href={q("first")}>İlk dokunuş</Link></span>}
      />
      <FilterBar basePath={base} sp={sp} timeZone={access.brand.timezone} showEngine={false} />
      {availability.state === "error" ? (
        <div className="mb-4">
          <Alert tone="warning" title="Siparişler güncellenemedi">
            {availability.lastSyncAt ? `Son başarılı aktarım ${fmtDate(availability.lastSyncAt, access.brand.timezone, "tr-TR", true)}; rakamlar o tarihe kadardır. ` : "Rakamlar son başarılı aktarıma kadardır. "}
            <Link className="font-medium text-primary underline" href={`/w/${workspaceId}/b/${brandId}/integrations`}>Bağlantıyı kontrol et</Link>
          </Alert>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="AI kaynaklı net gelir" value={Object.keys(rev.aiNetByCurrency).length ? <span className="flex flex-col gap-0.5 text-xl">{Object.entries(rev.aiNetByCurrency).map(([c, v]) => <span key={c}><span className="mr-2 text-xs font-medium text-text-secondary">{c}</span>{fmtMoney(v, c)}</span>)}</span> : fmtMoney(0, access.brand.currency)} hint="Para birimleri ayrı; kur dönüşümü yapılmadı" />
        <Stat label="AI siparişleri" value={fmtNumber(rev.aiOrders)} hint={`${rev.model === FIRST_TOUCH ? "İlk dokunuş" : "Son dokunuş (doğrudan hariç)"} · 30 gün pencere`} />
        <Stat label="AI oturumlarında CVR" value={fmtPct(rev.aiCvr, "tr-TR", 1)} hint={`${rev.aiSessions} ölçülebilen AI oturumu`} />
        <Stat label="Attribution kapsamı" value={fmtPct(rev.attributionCoverage)} hint={`${rev.unattributed} sipariş ilişkilendirilemedi (consent/UTM/eşleşme yok)`} />
      </div>
      <p className="mt-2 text-xs text-muted">Hesaplama zamanı: {fmtDate(rev.asOf, access.brand.timezone, "tr-TR", true)} · Geç gelen iadeler geçmiş dönemi yeniden hesaplar.</p>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader title="Kanal kırılımı" description="Sipariş başına model başına tek tahsis; assisted ayrı, toplama dahil değil." />
          <TableWrap label="Kanallar">
            <thead><tr><Th>Kanal</Th><Th numeric>Sipariş</Th><Th numeric>Net</Th></tr></thead>
            <tbody>
              {rev.channels.sort((a, b) => b.orders - a.orders).map((c) => (
                <tr key={c.channel}><Td>{CHANNEL_LABEL(c.channel)} {c.ai ? <Badge tone="primary">AI</Badge> : null}</Td><Td numeric>{c.orders}</Td><Td numeric>{Object.entries(c.netByCurrency).map(([cur, v]) => fmtMoney(v, cur)).join(" · ")}</Td></tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
        <Card>
          <CardHeader title="Sipariş detayı" description="Brüt / iade / net; müşteri kişisel verisi gösterilmez." />
          <TableWrap label="Siparişler">
            <thead><tr><Th>Sipariş</Th><Th>Tarih</Th><Th>Durum</Th><Th>Kanal</Th><Th numeric>Brüt</Th><Th numeric>İade</Th><Th numeric>Net</Th></tr></thead>
            <tbody>
              {rev.orders.map((o) => (
                <tr key={o.id}>
                  <Td>{o.externalOrderId}</Td>
                  <Td className="text-muted">{fmtDate(o.paidAt, access.brand.timezone)}</Td>
                  <Td>{o.status === "refunded" ? <Badge tone="danger">İade</Badge> : o.status === "partially_refunded" ? <Badge tone="warning">Kısmi iade</Badge> : <Badge tone="success">Ödendi</Badge>}</Td>
                  <Td>{CHANNEL_LABEL(o.channel)}</Td>
                  <Td numeric>{fmtMoney(o.grossMinor, o.currency)}</Td>
                  <Td numeric>{fmtMoney(o.refundedMinor, o.currency)}</Td>
                  <Td numeric>{fmtMoney(o.netMinor, o.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      </div>
    </>
  );
}
