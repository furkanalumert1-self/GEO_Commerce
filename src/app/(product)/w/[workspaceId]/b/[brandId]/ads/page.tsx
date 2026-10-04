import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap, Td, Th, cn } from "@/components/ui";
import { AdsPlanFlow, type FlowGroup } from "@/components/ads/ads-plan-flow";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { hasFeature } from "@/modules/billing/plans";
import { policyIssues } from "@/modules/ads/chatgpt";
import { buildChatgptAdsPlan } from "@/modules/ads/chatgpt-plan";

export const metadata: Metadata = { title: "Reklamlar" };

/** Sekme anahtarları eski bağlantılarla uyumludur (readiness → plan, rules → kampanyalar). */
const TABS = [["chatgpt", "Reklam planı"], ["intelligence", "Reklam fikirleri"], ["campaigns", "Kampanyalar"]] as const;
const TAB_ALIAS: Record<string, (typeof TABS)[number][0]> = { readiness: "chatgpt", rules: "campaigns" };

export default async function AdsPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const requested = TAB_ALIAS[sp.tab ?? ""] ?? sp.tab;
  const tab = TABS.find(([k]) => k === requested)?.[0] ?? "chatgpt";
  const base = `/w/${workspaceId}/b/${brandId}/ads`;
  if (!hasFeature(access.entitlements, "ads")) {
    return (
      <>
        <PageHeader title="Reklamlar" />
        <Alert tone="primary" title="Reklam planı Commerce paketinde">Ölçtüğünüz sorulardan reklam taslağı hazırlamak için paketinizi yükseltin. <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Paketleri gör</Link></Alert>
      </>
    );
  }
  const [accounts, plan, brandRow, categories, products, pages, activeProducts] = await Promise.all([
    db.adsAccount.findMany({ where: { brandId, workspaceId }, select: { provider: true, accessStatus: true } }),
    buildChatgptAdsPlan(db, { workspaceId, brandId }),
    db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { name: true, domain: true, country: true, categories: true } }),
    db.category.findMany({ where: { brandId, url: { not: null } }, select: { name: true, url: true } }),
    db.product.findMany({ where: { brandId, active: true, url: { not: null } }, select: { name: true, url: true, categories: { select: { category: { select: { name: true } } } } }, take: 300 }),
    db.pageSnapshot.findMany({ where: { brandId, pageType: "product" }, select: { findings: true }, take: 200 }),
    db.product.count({ where: { brandId, workspaceId, active: true } }),
  ]);
  const norm = (s: string) => s.trim().toLocaleLowerCase("tr-TR");
  const home = `https://${brandRow.domain.replace(/^www\./, "")}/`;
  const groups: FlowGroup[] = plan.adGroups.map((g) => {
    const cat = norm(g.category ?? g.label);
    const catPage = categories.find((c) => norm(c.name) === cat);
    const word = cat.split(/\s+/).filter((w) => w.length > 3).pop();
    const prods = products.filter((p) => p.categories.some((c) => norm(c.category.name) === cat) || (word ? norm(p.name).includes(word.slice(0, Math.max(4, word.length - 2))) : false)).slice(0, 3);
    // Hedef sayfalar yalnız gerçek kayıtlardan (kategori/ürün); uydurma URL yok. Ana sayfa varsayılan seçili değil.
    const targets: FlowGroup["targets"] = [
      ...(catPage?.url ? [{ url: catPage.url, label: `Kategori sayfası · ${catPage.url.replace(/^https?:\/\//, "")}`, kind: "category" as const }] : []),
      ...prods.map((p) => ({ url: p.url!, label: `Ürün · ${p.name}`, kind: "product" as const })),
      { url: home, label: `Ana sayfa · ${home.replace(/^https?:\/\//, "")}`, kind: "home" as const },
    ];
    return { clusterId: g.clusterId, label: g.label, answers: g.answers, brandMentioned: g.brandMentioned, lostTo: g.lostTo, prompts: g.prompts, promptStats: g.promptStats, copy: g.copies[0] ?? null, targets };
  });
  const activeAccount = accounts.find((a) => a.accessStatus === "active");
  const status = activeAccount
    ? "Reklam hesabınız bağlı. Yayın bu ekrandan yapılmaz; taslakları reklam platformunda kullanın."
    : accounts.length
      ? "Plan hazırlayabilirsiniz; reklam hesabınızın erişimi henüz doğrulanmadı."
      : "Plan hazırlayabilirsiniz; reklam hesabınız bağlı değil.";
  const policy = policyIssues(brandRow.categories, brandRow.country);
  const missingOffer = pages.filter((p) => (p.findings as { productComplete?: boolean } | null)?.productComplete === false).length;
  const checks: Array<{ label: string; state: "ok" | "warn" | "unknown"; text: string }> = [
    { label: "Ürün sayfalarında fiyat ve stok bilgisi", state: pages.length === 0 ? "unknown" : missingOffer ? "warn" : "ok", text: pages.length === 0 ? "Ürün sayfası incelenmedi" : missingOffer ? `${missingOffer} ürün sayfasında eksik` : "Sorun bulunmadı" },
    { label: "Ürün kategorisi reklam kuralları", state: policy.some((p) => p.level === "error") ? "warn" : policy.length ? "warn" : "unknown", text: policy.length ? policy.map((p) => p.message).join("; ") : "Yerel kontrolde sorun görülmedi; nihai karar reklam platformunda" },
    { label: "Ülke ve hesap uygunluğu", state: activeAccount ? "ok" : "unknown", text: activeAccount ? "Hesap erişimi doğrulandı" : "Doğrulanmadı — reklam platformunda kontrol edin" },
  ];

  return (
    <>
      <PageHeader title="Reklamlar" description="Ölçtüğünüz sorulardan reklam taslağı hazırlayın; taslağı kopyalayıp reklam platformunda kullanın." />
      <div className="flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 text-sm" role="status">
        <span aria-hidden className={cn("mt-1.5 h-2.5 w-2.5 flex-none rounded-full", activeAccount ? "bg-success" : "bg-warning")} />
        <span>{status}</span>
      </div>
      <div className="my-4 flex flex-wrap gap-1 border-b border-border" role="navigation" aria-label="Reklam bölümleri">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`${base}?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={cn("inline-flex min-h-11 items-center border-b-2 px-3 text-sm sm:min-h-10", tab === k ? "border-primary font-medium text-primary" : "border-transparent text-text-secondary hover:text-text")}>{label}</Link>
        ))}
      </div>

      {tab === "chatgpt" ? (
        <div className="flex flex-col gap-6">
          <AdsPlanFlow groups={groups} brandName={brandRow.name} domain={brandRow.domain.replace(/^www\./, "")} days={plan.sample.days} initialGroup={sp.group} catalogEmpty={activeProducts === 0} />
          <details className="rounded-[var(--radius-lg)] border border-border bg-surface px-5 py-3 text-sm">
            <summary className="min-h-9 cursor-pointer py-1 font-medium text-primary">Hazırlık kontrolleri</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {checks.map((c) => (
                <li key={c.label} className="flex flex-wrap items-start gap-2">
                  <Badge tone={c.state === "ok" ? "success" : c.state === "warn" ? "warning" : "neutral"}>{c.state === "ok" ? "Tamam" : c.state === "warn" ? "Kontrol edin" : "Doğrulanmadı"}</Badge>
                  <span><span className="font-medium">{c.label}:</span> <span className="text-text-secondary">{c.text}</span></span>
                </li>
              ))}
            </ul>
            <p className="mt-3"><a className="text-primary underline" href={`/api/v1/workspaces/${workspaceId}/brands/${brandId}/ads/chatgpt-plan?format=csv`}>Tüm reklam gruplarını CSV olarak indir</a></p>
          </details>
        </div>
      ) : null}

      {tab === "intelligence" ? (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Reklam fikirleri" description={`Son ${plan.sample.days} günün ${plan.sample.answers} AI yanıtından: rakiplerin öne çıktığı ürün grupları. Organik görünürlük verisidir; reklam performansı değildir.`} />
            {groups.length === 0 ? (
              <EmptyState title="Henüz fikir yok" description="Takip edeceğiniz soruları seçip bir ölçüm yapın; fikirler ölçülen yanıtlardan çıkar." action={<Link className="text-primary underline" href={`/w/${workspaceId}/b/${brandId}/prompts`}>Soruları seç</Link>} />
            ) : (
              <ul className="divide-y divide-border">
                {groups.map((g) => {
                  const lost = g.lostTo.reduce((a, b) => a + b.count, 0);
                  return (
                    <li key={g.clusterId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
                      <div className="min-w-0">
                        <p className="font-semibold">{g.label}</p>
                        <p className="text-sm text-text-secondary">{g.answers ? `${g.answers} yanıtın ${g.brandMentioned}'inde markanız anıldı${lost ? `; ${g.lostTo.slice(0, 2).map((c) => c.name).join(", ")} öne çıktı` : ""}` : "Henüz ölçüm yok"}</p>
                      </div>
                      <Link className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-subtle sm:min-h-10" href={`${base}?tab=chatgpt&group=${encodeURIComponent(g.clusterId)}`}>Bu fikirle taslak hazırla</Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {plan.competitorInsights.some((c) => c.mentions > 0) ? (
            <Card>
              <CardHeader title="Rakiplerin öne çıktığı sorular" description="Onaylı rakiplerinizin AI yanıtlarında anıldığı yerler." />
              <TableWrap label="Rakipler">
                <thead><tr><Th>Rakip</Th><Th numeric>Anıldığı yanıt</Th><Th>En sık geçtiği soru</Th></tr></thead>
                <tbody>
                  {plan.competitorInsights.filter((c) => c.mentions > 0).slice(0, 8).map((c) => (
                    <tr key={c.id}><Td className="font-medium">{c.name}</Td><Td numeric>{c.mentions}</Td><Td className="text-text-secondary [overflow-wrap:anywhere]">{c.topPrompts[0] ?? "—"}</Td></tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "campaigns" ? (
        <Card>
          {activeAccount ? (
            <EmptyState title="Kampanya verisi henüz gelmedi" description="Hesabınız bağlı; kampanya ve harcama verileri eşitlendikçe burada görünür. Örnek veya tahmini performans gösterilmez." />
          ) : (
            <EmptyState
              title="Kampanyalarınız burada görünmez"
              description="Reklam hesabı bağlı olmadığı için kampanya ve harcama verisi yok. Şimdilik Reklam planı sekmesinde taslak hazırlayıp reklam platformunda kampanyanızı elle oluşturabilirsiniz."
              action={<Link className="text-primary underline" href={`${base}?tab=chatgpt`}>Reklam planına git</Link>}
            />
          )}
        </Card>
      ) : null}
    </>
  );
}
