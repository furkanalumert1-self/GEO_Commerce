import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, cn } from "@/components/ui";
import { AdsDraftForm } from "@/components/forms/ads-draft-form";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { hasFeature } from "@/modules/billing/plans";
import { config } from "@/lib/config";
import { DEFAULT_RULE } from "@/modules/ads/rules";
import { CHATGPT_ADS_SPEC, policyIssues } from "@/modules/ads/chatgpt";
import { buildChatgptAdsPlan } from "@/modules/ads/chatgpt-plan";
import { ChatgptAdsPlan } from "@/components/ads/chatgpt-plan";

export const metadata: Metadata = { title: "Reklam" };

const TABS = [["chatgpt", "ChatGPT Ads planı"], ["readiness", "Hazırlık"], ["intelligence", "Fırsat istihbaratı"], ["campaigns", "Kampanyalar"], ["rules", "Kurallar"]] as const;

export default async function AdsPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "chatgpt";
  const base = `/w/${workspaceId}/b/${brandId}/ads`;
  if (!hasFeature(access.entitlements, "ads")) {
    return (<><PageHeader title="Reklam" /><Alert tone="primary" title="Ads modülü Commerce paketinde">Önce istihbarat ve taslak, ardından erişim ve yetkiye bağlı kontrollü otomasyon. <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Paketleri gör</Link></Alert></>);
  }
  const [accounts, opps, pages] = await Promise.all([
    db.adsAccount.findMany({ where: { brandId, workspaceId } }),
    db.opportunity.findMany({ where: { brandId, status: { in: ["new", "triaged", "in_progress"] } }, orderBy: [{ score: { sort: "desc", nulls: "last" } }], take: 8, include: { cluster: { select: { label: true, type: true } } } }),
    db.pageSnapshot.findMany({ where: { brandId }, select: { url: true, pageType: true, findings: true }, take: 200 }),
  ]);
  const usps = [sp.usp1, sp.usp2].filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.slice(0, 40));
  const chatgptPlan = tab === "chatgpt" ? await buildChatgptAdsPlan(db, { workspaceId, brandId }, { usps }) : null;
  const brandRow = await db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { country: true, categories: true } });
  const market = CHATGPT_ADS_SPEC.markets[brandRow.country];
  const policy2 = policyIssues(brandRow.categories, brandRow.country);
  const productPages = pages.filter((p) => p.pageType === "product");
  const missingOffer = productPages.filter((p) => (p.findings as { productComplete?: boolean } | null)?.productComplete === false).length;
  const policy = pages.some((p) => p.pageType === "policy");
  return (
    <>
      <PageHeader title="Reklam (ChatGPT Ads ve diğerleri)" description="İstihbarat ve taslak her zaman çalışır; kampanya/bütçe işlemleri doğrulanmış hesap erişimi, yetki ve onay gerektirir. Oluşturulan kampanyalar duraklatılmış başlar." />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`${base}?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={cn("inline-flex min-h-11 items-center border-b-2 px-3 text-sm sm:min-h-9", tab === k ? "border-primary font-medium text-primary" : "border-transparent text-muted")}>{label}</Link>
        ))}
      </div>
      {tab === "chatgpt" && chatgptPlan ? <ChatgptAdsPlan plan={chatgptPlan} action={base} usps={usps} downloadUrl={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/ads/chatgpt-plan?${new URLSearchParams(usps.map((u, i) => [`usp${i + 1}`, u]))}`} /> : null}
      {tab === "readiness" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-4 text-sm">
            <p className="font-medium">Landing ve feed kalitesi</p>
            <ul className="mt-2 flex flex-col gap-1">
              <li>{missingOffer === 0 ? <Badge tone="success">Tamam</Badge> : <Badge tone="warning">{missingOffer} ürün</Badge>} Ürün sayfalarında fiyat/stok şeması</li>
              <li>{policy ? <Badge tone="success">Bulundu</Badge> : <Badge>Tespit edilemedi</Badge>} İade/gizlilik politikaları</li>
              <li><Badge tone="warning">Doğrulama gerekli</Badge> Ülke/sektör/hesap uygunluğu — güncel sağlayıcı kurallarıyla</li>
            </ul>
          </Card>
          <Card className="p-4 text-sm md:col-span-2">
            <p className="font-medium">ChatGPT Ads uygunluğu <span className="text-xs font-normal text-muted">· kurallar {CHATGPT_ADS_SPEC.version} itibarıyla</span></p>
            <ul className="mt-2 flex flex-col gap-1">
              <li>{market?.available ? <Badge tone="success">Açık</Badge> : <Badge tone="warning">Doğrulanmadı</Badge>} Pazar ({brandRow.country}){market?.available ? `: self-serve erişim ${market.since} tarihinden beri; ${market.personalization ? "kişiselleştirme var" : "yalnız sohbet bağlamı, genel konum ve cihaz (kişiselleştirme yok)"}` : ""}</li>
              <li>{policy2.some((i) => i.level === "error") ? <Badge tone="danger">Risk</Badge> : policy2.length ? <Badge tone="warning">İnceleme</Badge> : <Badge tone="success">Uygun</Badge>} Kategori politikası{policy2.length ? `: ${policy2.map((i) => i.message).join("; ")}` : " (yasak/kısıtlı kategori tespit edilmedi)"}</li>
              <li><Badge>Bilgi</Badge> Reklamlar yalnız Free ve Go kullanıcılarına, yanıtın altında sohbet kartı olarak gösterilir; 18 yaş altı ve sağlık/siyaset gibi hassas sohbetlerde gösterilmez</li>
              <li><Badge>Bilgi</Badge> Sohbet kartı: başlık ≤{CHATGPT_ADS_SPEC.title.max}, metin ≤{CHATGPT_ADS_SPEC.body.max} karakter, kare görsel (≥{CHATGPT_ADS_SPEC.image.minPxApi}px, görselde metin yok), tek hedef URL (doğrulanmış alan adı)</li>
              <li>{missingOffer === 0 && productPages.length > 0 ? <Badge tone="success">Hazır</Badge> : <Badge tone="warning">Eksik</Badge>} Ürün feed reklamları için Google Shopping biçiminde katalog feed&apos;i gerekir (alışveriş yerleşimleri yalnız feed gönderen markalara açık)</li>
            </ul>
          </Card>
          <Card className="p-4 text-sm">
            <p className="font-medium">Hesaplar</p>
            {accounts.length === 0 ? <p className="mt-2 text-muted">Bağlı reklam hesabı yok.</p> : accounts.map((a) => (
              <div key={a.id} className="mt-2 flex flex-wrap items-center gap-2">
                <span>{a.provider} · {a.externalId}</span>
                <Badge tone={a.accessStatus === "active" ? "success" : "warning"}>{a.accessStatus === "access_required" ? "Erişim gerekli" : a.accessStatus}</Badge>
                <span className="text-xs text-muted">Yetenekler: {Object.keys(a.capabilities as object).length ? Object.keys(a.capabilities as object).join(", ") : "doğrulanmadı"}</span>
              </div>
            ))}
            <p className="mt-3 text-xs text-muted">Otomasyon: {config().ADS_AUTOMATION_ENABLED ? "platformda açık" : "platformda kapalı (ADS_AUTOMATION_ENABLED=false)"}.</p>
          </Card>
        </div>
      ) : null}
      {tab === "intelligence" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Ücretli kanal için niyet fırsatları" description="GEO niyet kümeleri ürün içi araştırma verisidir; sağlayıcıda keyword targeting karşılığı değildir. Rakip harcaması veya kullanıcı sohbeti gösterilmez." />
            <ul className="divide-y divide-border">{opps.map((o) => <li key={o.id} className="px-4 py-3 text-sm"><p className="font-medium">{o.cluster.label}</p><p className="text-muted">Skor {o.score ?? "—"} · {o.paidBlockedReason ?? "Uygun"} · ChatGPT Ads&apos;te bu niyet bağlam ipucu olarak kullanılabilir</p></li>)}</ul>
          </Card>
          <Card>
            <CardHeader title="Kampanya brief / creative taslağı" description="ChatGPT Ads: karakter sınırları, hedef URL ve kategori politikası yerel olarak kontrol edilir; kaybedilen AI sorularından bağlam ipuçları üretilir. CSV ve OpenAI Ads API (duraklatılmış) taslağı olarak indirilir; nihai inceleme Ads Manager'dadır." />
            <div className="p-4"><AdsDraftForm url={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/ads/drafts`} opportunities={opps.map((o) => ({ id: o.id, label: o.cluster.label }))} domain={access.brand.domain} currency={access.brand.currency} /></div>
          </Card>
        </div>
      ) : null}
      {tab === "campaigns" ? (
        <Card>{accounts.every((a) => a.accessStatus !== "active") ? <EmptyState title="Erişim gerekli (access_required)" description="Kampanya ve harcama verileri yalnız doğrulanmış hesap erişimiyle senkronize edilir. Örnek veya tahmini performans gösterilmez." /> : <EmptyState title="Kampanya yok" description="Senkronize kampanya bulunamadı." />}</Card>
      ) : null}
      {tab === "rules" ? (
        <Card className="p-4 text-sm">
          <p className="font-medium">Kontrollü otomasyon varsayılanları</p>
          <ul className="mt-2 list-disc pl-5 text-muted">
            <li>Seviye: kapalı → öneri → onay gerekli (varsayılan) → kullanıcı açarsa sınırlı kurallar</li>
            <li>Günlük bütçe değişimi en fazla ±%{DEFAULT_RULE.maxDailyChangePct}; {DEFAULT_RULE.cooldownHours} saat bekleme; kayan harcama tavanı; kill switch</li>
            <li>Minimum örneklem {DEFAULT_RULE.minConversions} dönüşüm; attribution gecikmesi {DEFAULT_RULE.attributionDelayHours} saat — düşük örneklemde hedef ROAS yalnız öneri</li>
            <li>Limit/policy/yetki sorunu: işlem yapılmaz (fail-closed). Harcama verisi gecikmeli olabilir.</li>
          </ul>
          <p className="mt-3"><Badge tone="warning">Hesap erişimi olmadan kural etkinleştirilemez</Badge></p>
        </Card>
      ) : null}
    </>
  );
}
