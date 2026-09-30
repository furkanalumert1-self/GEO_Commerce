import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { ApiButton } from "@/components/forms/api-button";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { pageBrand } from "@/lib/page-access";
import { hasFeature } from "@/modules/billing/plans";
import { getCommerceAdapters } from "@/adapters/commerce";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "Entegrasyonlar" };

const STATE_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "primary"> = { healthy: "success", syncing: "primary", connecting: "primary", degraded: "warning", reauth_required: "warning", not_configured: "neutral", unsupported: "neutral" };
const STATE_LABEL: Record<string, string> = { healthy: "Sağlıklı", syncing: "Senkronize ediliyor", connecting: "Bağlanıyor", degraded: "Sorunlu", reauth_required: "Yeniden yetkilendirme gerekli", not_configured: "Yapılandırılmamış", unsupported: "Henüz desteklenmiyor" };

export default async function IntegrationsPage({ params }: { params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params;
  const access = await pageBrand(workspaceId, brandId);
  const allowed = hasFeature(access.entitlements, "commerce");
  const [existing, brand] = await Promise.all([db.integration.findMany({ where: { brandId, workspaceId } }), db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { trackerSiteKey: true, domain: true } })]);
  const adapters = getCommerceAdapters();
  const api = `/api/v1/workspaces/${workspaceId}/brands/${brandId}`;
  return (
    <>
      <PageHeader title="Entegrasyonlar" description="Mağaza bağlantıları, CSV/feed importu ve first-party tracker. Resmi erişim ve gerçek mağaza testi olmadan hiçbir bağlantı 'tam destek' olarak gösterilmez." />
      {!allowed ? <div className="mb-4"><Alert tone="primary" title="Mağaza entegrasyonları Commerce paketinde">CSV/feed importu ve readiness her pakette kullanılabilir. <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Paketleri gör</Link></Alert></div> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.values(adapters).map((a) => {
          const conn = existing.find((e) => e.provider === a.provider);
          const av = a.availability();
          const state = conn?.status ?? (av.state === "available" ? "not_configured" : av.state);
          return (
            <Card key={a.provider} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{a.label}</h2>
                <Badge tone={STATE_TONE[state] ?? "neutral"}>{STATE_LABEL[state] ?? state}</Badge>
              </div>
              <p className="text-xs text-muted">Yetenekler: {a.capabilities().join(", ")}</p>
              {conn ? <p className="text-xs text-muted">Mağaza: {conn.storeId} · Son senkron: {fmtDate(conn.lastSyncAt, access.brand.timezone, "tr-TR", true)}{conn.errorCode ? ` · Hata: ${conn.errorCode}` : ""}</p> : null}
              {av.reason ? <p className="text-sm text-muted">{av.reason}</p> : null}
              <div className="mt-auto flex flex-wrap gap-2">
                {a.provider === "csv_feed" ? (
                  <Link className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm sm:min-h-9" href={`/w/${workspaceId}/b/${brandId}/catalog`}>CSV içe aktar</Link>
                ) : (
                  <ApiButton url={`${api}/integrations/${a.provider}/connect`} body={{ shopDomain: brand.domain }} label={conn?.status === "reauth_required" ? "Yeniden yetkilendir" : "Bağlan"} disabled={!allowed} disabledReason={!allowed ? "Commerce paketi gerekli" : undefined} />
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="mt-6 p-4">
        <h2 className="font-semibold">First-party tracker</h2>
        <p className="mt-1 text-sm text-muted">Consent adapter ile page_view, product_view, add_to_cart, checkout_started, purchase olaylarını gönderir. Site anahtarı gizli değildir; yalnız {brand.domain} alan adından kabul edilir. Sohbet metni, form alanları ve gereksiz kişisel veri toplanmaz.</p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-bg p-3 text-xs">{`<script>
  // Consent yönetim aracınız izin verdiğinde çağırın:
  // geoTrack({ type: "page_view", consent: { analytics: true, ads: false } })
  window.GEO_SITE_KEY = "${brand.trackerSiteKey}";
  window.GEO_INGEST = "${config().TRACKER_INGEST_ORIGIN ?? config().APP_URL}/api/v1/events";
</script>`}</pre>
      </Card>
    </>
  );
}
