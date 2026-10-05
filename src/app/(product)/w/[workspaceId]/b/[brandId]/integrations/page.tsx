import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { ApiButton } from "@/components/forms/api-button";
import { ShopifyConnectForm } from "@/components/forms/shopify-connect";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { pageBrand } from "@/lib/page-access";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/modules/billing/plans";
import { getCommerceAdapters } from "@/adapters/commerce";
import { shopifyConfigured } from "@/modules/commerce/connect";
import { fmtDate } from "@/lib/format";
import { revenueAvailability } from "@/modules/commerce/availability";

export const metadata: Metadata = { title: "Mağaza bağlantıları" };

/** Bağlantı durumları (UI): gerçek kontrol sonucu olmadan "Bağlı" gösterilmez. */
const STATE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "primary" }> = {
  not_configured: { label: "Bağlı değil", tone: "neutral" },
  connecting: { label: "Bağlanıyor", tone: "primary" },
  syncing: { label: "Doğrulanıyor", tone: "primary" },
  healthy: { label: "Bağlı", tone: "success" },
  reauth_required: { label: "Yetki süresi doldu", tone: "warning" },
  degraded: { label: "Hata", tone: "danger" },
  unsupported: { label: "Desteklenmiyor", tone: "neutral" },
};

function resolution(code: string | null): string | null {
  if (!code) return null;
  if (code === "auth_rejected") return "Mağaza erişimi reddedildi veya iptal edildi. Yeniden bağlanın.";
  if (code === "app_uninstalled") return "Uygulama mağazadan kaldırılmış. Yeniden bağlanın.";
  if (code.startsWith("missing_scopes")) return `Gerekli izinler verilmedi (${code.split(":")[1]}). Yeniden bağlanırken tüm izinleri onaylayın.`;
  if (code === "sync_failed") return "Son senkronizasyon başarısız. Biraz sonra yeniden deneyin; sürerse yeniden bağlanın.";
  if (code === "connect_failed") return "Bağlantı tamamlanamadı. Yeniden deneyin.";
  if (code.startsWith("webhooks_failed")) return "Anlık sipariş bildirimleri kurulamadı; siparişler yine düzenli eşitlemeyle gelir. Sorun sürerse yeniden bağlanın veya destekle iletişime geçin.";
  return "Beklenmeyen bir sorun oluştu. Biraz sonra yeniden deneyin; sürerse yeniden bağlanın.";
}

const CALLBACK_ERROR: Record<string, string> = {
  missing_scopes: "Gerekli izinler verilmediği için bağlantı tamamlanmadı.",
  connect_failed: "Shopify bağlantısı doğrulanamadı; mağaza erişimi kurulmadı.",
  unauthenticated: "Bağlantı isteği doğrulanamadı veya süresi doldu. Yeniden başlatın.",
  forbidden: "Bağlantıyı başlatan kullanıcı ile oturum eşleşmiyor veya yetkiniz yok.",
  not_configured: "Shopify uygulaması sunucuda yapılandırılmamış.",
};

export default async function IntegrationsPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const allowed = hasFeature(access.entitlements, "commerce");
  const manage = can({ role: access.brandRole, isApprover: access.isApprover }, "integrations.manage");
  const [existing, brand, revenue] = await Promise.all([
    db.integration.findMany({ where: { brandId, workspaceId }, orderBy: { updatedAt: "desc" } }),
    db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { trackerSiteKey: true, domain: true } }),
    revenueAvailability(db, { workspaceId, brandId }, access.entitlements),
  ]);
  const adapters = getCommerceAdapters();
  const api = `/api/v1/workspaces/${workspaceId}/brands/${brandId}`;
  const tz = access.brand.timezone;
  const blockReason = !allowed ? "Commerce paketi gerekli" : !manage ? "Bu işlem için entegrasyon yönetme yetkisi gerekli" : access.isDemo ? "Demo çalışma alanında gerçek mağaza bağlanamaz" : undefined;
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Ayarlar" }, { label: "Mağaza bağlantıları" }]}
        title="Mağaza bağlantıları"
        description="Ürün ve sipariş bilgilerinizi GeoAdra'ya aktarın. Bir bağlantı yalnız gerçek yetki kontrolünden sonra “Bağlı” görünür."
      />
      {revenue.state !== "not_in_plan" ? (
        <Card id="gelir" className="mb-6 flex flex-col gap-2 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Gelir ölçümü</h2>
            <Badge tone={revenue.state === "active" ? "success" : revenue.state === "error" ? "warning" : "neutral"}>{revenue.state === "active" ? "Etkin" : revenue.state === "error" ? "Güncellenemedi" : "Etkin değil"}</Badge>
          </div>
          {revenue.state === "inactive" ? (
            <>
              <p className="text-sm text-text-secondary">AI&apos;dan gelen ziyaretlerin siparişe dönüşünü görmek için iki şey gerekir: sipariş kaynağı (mağaza bağlantısı veya sipariş dosyası) ve sitenizdeki ölçüm kodu (aşağıda).</p>
              <Link className="inline-flex min-h-11 items-center self-start rounded-md border border-primary bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover sm:min-h-10" href={`/w/${workspaceId}/b/${brandId}/catalog?import=orders#urun-aktar`}>Gelir ölçümünü etkinleştir</Link>
            </>
          ) : revenue.state === "error" ? (
            <p className="text-sm">Siparişler son eşitlemede alınamadı{revenue.lastSyncAt ? `; son başarılı aktarım ${fmtDate(revenue.lastSyncAt, tz, "tr-TR", true)}` : ""}. Aşağıdaki bağlantının çözüm önerisini izleyin.</p>
          ) : (
            <p className="text-sm text-text-secondary">Siparişler okunuyor{revenue.lastSyncAt ? ` · son aktarım ${fmtDate(revenue.lastSyncAt, tz, "tr-TR", true)}` : ""}. Sonuçlar Gelir sayfasında.</p>
          )}
        </Card>
      ) : null}
      {sp.connected === "shopify" ? <div className="mb-4"><Alert tone="success" title="Shopify bağlandı">Mağaza erişimi doğrulandı. Katalog ve sipariş senkronizasyonu kuyruğa alındı; tamamlandığında son senkronizasyon zamanı güncellenir.</Alert></div> : null}
      {sp.error ? <div className="mb-4"><Alert tone="danger" title="Bağlantı tamamlanmadı">{CALLBACK_ERROR[sp.error] ?? "Bağlantı sırasında hata oluştu; yeniden deneyin."}</Alert></div> : null}
      {!allowed ? <div className="mb-4"><Alert tone="primary" title="Mağaza entegrasyonları Commerce paketinde">Ürün dosyası yükleme her pakette kullanılabilir. <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Paketleri gör</Link></Alert></div> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.values(adapters).map((a) => {
          const conn = existing.find((e) => e.provider === a.provider && e.status !== "not_configured") ?? existing.find((e) => e.provider === a.provider);
          const av = a.availability();
          const state = conn?.status ?? (av.state === "available" ? "not_configured" : av.state);
          const st = STATE[state] ?? { label: state, tone: "neutral" as const };
          const fix = resolution(conn?.errorCode ?? null);
          const shopifyReady = a.provider === "shopify" && av.state === "available" && shopifyConfigured();
          return (
            <Card key={a.provider} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{a.label}</h2>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
              {conn && conn.status !== "not_configured" ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-text-secondary">Mağaza</dt>
                  <dd className="min-w-0 break-all">{conn.storeId}</dd>
                  <dt className="text-text-secondary">Son başarılı senkronizasyon</dt>
                  <dd>{conn.lastSyncAt ? fmtDate(conn.lastSyncAt, tz, "tr-TR", true) : "Henüz yok"}</dd>
                  {conn.scopes.length ? (
                    <>
                      <dt className="text-text-secondary">İzinler</dt>
                      <dd className="min-w-0 break-words">{conn.scopes.join(", ")}</dd>
                    </>
                  ) : null}
                </dl>
              ) : (
                <p className="text-xs text-text-secondary">{a.capabilities().includes("ordersRead") ? "Ürün ve sipariş bilgileri aktarılır." : "Ürün bilgileri aktarılır."}</p>
              )}
              {fix ? <p className="rounded-md bg-surface-subtle px-3 py-2 text-sm"><span className="font-medium">Çözüm: </span>{fix}</p> : null}
              {av.reason && !conn ? <p className="text-sm text-text-secondary">{av.state === "not_configured" ? "Doğrudan bağlantı henüz etkin değil." : av.reason}</p> : null}
              <div className="mt-auto flex flex-col gap-2">
                {a.provider === "csv_feed" ? (
                  <Link className="inline-flex min-h-11 items-center self-start rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-subtle sm:min-h-10" href={`/w/${workspaceId}/b/${brandId}/catalog?import=1#urun-aktar`}>Dosya yükle</Link>
                ) : a.provider === "shopify" ? (
                  !shopifyReady ? (
                    <p className="text-sm text-text-secondary">Shopify bağlantısı şu an kullanılamıyor; ürün ve sipariş dosyası yükleyebilirsiniz.</p>
                  ) : conn && (conn.status === "healthy" || conn.status === "degraded") ? (
                    <div className="flex flex-wrap gap-2">
                      <ApiButton url={`${api}/integrations/shopify/sync`} label="Şimdi senkronize et" pendingLabel="Kuyruğa alınıyor…" onSuccessMessage="Senkronizasyon kuyruğa alındı" disabled={Boolean(blockReason)} disabledReason={blockReason} />
                      <ApiButton url={`${api}/integrations/shopify`} method="DELETE" variant="danger" label="Bağlantıyı kes" confirm="Shopify bağlantısı kesilsin mi? Erişim anahtarı iptal edilir; aktarılmış veriler korunur." disabled={Boolean(blockReason)} />
                    </div>
                  ) : (
                    <ShopifyConnectForm url={`${api}/integrations/shopify/connect`} initialShop={conn?.storeId} label={conn && conn.status !== "not_configured" ? "Yeniden bağlan" : "Bağlan"} disabledReason={blockReason} />
                  )
                ) : (
                  <p className="text-sm text-text-secondary">Bu mağaza için doğrudan bağlantı henüz yok; mağaza panelinizden dışa aktardığınız dosyayı yükleyin.</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="mt-6 p-5">
        <h2 className="font-semibold">Ölçüm kodu</h2>
        <p className="mt-1 text-sm text-text-secondary">AI kaynaklı ziyaret ve siparişleri eşleştirmek için sitenize eklenir; yalnız kullanıcı izni (consent) varsa olay gönderir. Site anahtarı gizli değildir; yalnız {brand.domain} alan adından kabul edilir. Sohbet metni, form alanları ve gereksiz kişisel veri toplanmaz.</p>
        <details className="mt-3 text-sm">
          <summary className="min-h-9 cursor-pointer py-1 font-medium text-primary">Teknik ayrıntı: sitenize eklenecek kod</summary>
          <p className="mt-1 text-xs text-text-secondary">Bu kodu sitenizin geliştiricisi veya mağaza panelinizin “özel kod” alanı aracılığıyla ekleyin.</p>
          <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-surface-subtle p-3 text-xs">{`<script>
  // Consent yönetim aracınız izin verdiğinde çağırın:
  // geoTrack({ type: "page_view", consent: { analytics: true, ads: false } })
  window.GEO_SITE_KEY = "${brand.trackerSiteKey}";
  window.GEO_INGEST = "${config().TRACKER_INGEST_ORIGIN ?? config().APP_URL}/api/v1/events";
</script>`}</pre>
        </details>
      </Card>
    </>
  );
}
