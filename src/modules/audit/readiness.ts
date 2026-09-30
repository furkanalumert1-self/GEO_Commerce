import type { CrawlResult } from "./crawler";

/**
 * Site / GEO ve Ads readiness — ayrı puanlar (§4). Bulunamayan pixel "kurulu değil" değil,
 * "tespit edilemedi"dir. Kamu crawl'ı checkout'un çalıştığını kanıtlamaz.
 */
export type CheckStatus = "pass" | "fail" | "not_detected" | "requires_verification";

export interface ReadinessCheck {
  id: string;
  group: "geo" | "ads";
  label: string;
  status: CheckStatus;
  detail: string;
  priority: "high" | "medium" | "low";
}

export interface ReadinessResult {
  geoScore: number | null;
  adsScore: number | null;
  checks: ReadinessCheck[];
}

function score(checks: ReadinessCheck[]): number | null {
  const measurable = checks.filter((c) => c.status === "pass" || c.status === "fail");
  if (measurable.length === 0) return null;
  return Math.round((measurable.filter((c) => c.status === "pass").length / measurable.length) * 100);
}

export function evaluateReadiness(crawl: CrawlResult): ReadinessResult {
  const pages = crawl.pages;
  const home = pages.find((p) => p.pageType === "home") ?? pages[0];
  const productPages = pages.filter((p) => p.pageType === "product");
  const products = pages.flatMap((p) => p.facts.products);
  const hasPolicy = (re: RegExp) => pages.some((p) => re.test(p.url.toLowerCase()));
  const allTypes = new Set(pages.flatMap((p) => p.facts.schemaTypes));
  const trackers = new Set(pages.flatMap((p) => p.facts.trackers));
  const noindexCount = pages.filter((p) => p.facts.robotsNoindex).length;
  const thin = pages.filter((p) => p.facts.textLength < 300).length;
  const completeProducts = products.filter((p) => p.name && p.price && p.currency && p.availability).length;

  const checks: ReadinessCheck[] = [
    {
      id: "crawl_access",
      group: "geo",
      label: "Tarama erişimi (robots.txt)",
      status: crawl.robotsDisallowAll ? "fail" : pages.length > 0 ? "pass" : "fail",
      detail: crawl.robotsDisallowAll ? "robots.txt tüm siteyi engelliyor" : `${pages.length} sayfa tarandı, ${crawl.skippedByRobots} sayfa robots kuralıyla atlandı`,
      priority: "high",
    },
    {
      id: "indexability",
      group: "geo",
      label: "İndekslenebilirlik",
      status: pages.length === 0 ? "not_detected" : noindexCount === 0 ? "pass" : "fail",
      detail: noindexCount ? `${noindexCount} sayfada noindex bulundu` : "Taranan sayfalarda noindex yok",
      priority: "high",
    },
    {
      id: "sitemap",
      group: "geo",
      label: "Sitemap",
      status: crawl.sitemapFound ? "pass" : "not_detected",
      detail: crawl.sitemapFound ? "Sitemap bulundu" : "Sitemap tespit edilemedi",
      priority: "medium",
    },
    {
      id: "main_content",
      group: "geo",
      label: "Ana içerik yeterliliği",
      status: pages.length === 0 ? "not_detected" : thin / pages.length <= 0.3 ? "pass" : "fail",
      detail: `${thin}/${pages.length} sayfada 300 karakterden az görünür metin`,
      priority: "medium",
    },
    {
      id: "product_structured_data",
      group: "geo",
      label: "Ürün yapılandırılmış verisi (Product)",
      status: productPages.length === 0 && products.length === 0 ? "not_detected" : completeProducts > 0 && completeProducts >= products.length * 0.8 ? "pass" : "fail",
      detail: products.length ? `${completeProducts}/${products.length} ürün ad+fiyat+para birimi+stok içeriyor` : "Ürün şeması tespit edilemedi",
      priority: "high",
    },
    {
      id: "organization_schema",
      group: "geo",
      label: "Organization / marka şeması",
      status: allTypes.has("Organization") || allTypes.has("OnlineStore") ? "pass" : "not_detected",
      detail: allTypes.has("Organization") ? "Organization şeması var" : "Organization şeması tespit edilemedi",
      priority: "low",
    },
    {
      id: "policy_pages",
      group: "geo",
      label: "İade / kargo / gizlilik sayfaları",
      status: hasPolicy(/(iade|return|refund)/) && hasPolicy(/(gizlilik|privacy|kvkk)/) ? "pass" : "not_detected",
      detail: "Politika sayfaları bağlantılarda aranır; bulunamaması olmadığı anlamına gelmez",
      priority: "medium",
    },
    {
      id: "contact_page",
      group: "geo",
      label: "İletişim bilgisi",
      status: hasPolicy(/(iletisim|contact)/) ? "pass" : "not_detected",
      detail: hasPolicy(/(iletisim|contact)/) ? "İletişim sayfası bulundu" : "İletişim sayfası tespit edilemedi",
      priority: "low",
    },
    {
      id: "measurement",
      group: "geo",
      label: "Ölçüm kurulumu kanıtı",
      status: trackers.size > 0 ? "pass" : "not_detected",
      detail: trackers.size > 0 ? `Tespit edilen: ${[...trackers].join(", ")}` : "Pixel/etiket tespit edilemedi (kurulu olmadığı kesin değildir)",
      priority: "medium",
    },
    {
      id: "ads_landing",
      group: "ads",
      label: "İndekslenebilir, içerikli landing sayfaları",
      status: home && !home.facts.robotsNoindex && home.facts.textLength >= 300 ? "pass" : "fail",
      detail: home ? `Ana sayfa metin uzunluğu ${home.facts.textLength}` : "Ana sayfaya erişilemedi",
      priority: "high",
    },
    {
      id: "ads_price_clarity",
      group: "ads",
      label: "Fiyat ve stok açıklığı",
      status: products.length === 0 ? "not_detected" : completeProducts > 0 ? "pass" : "fail",
      detail: "Feed/landing'de fiyat ve stok bilgisinin açık olması",
      priority: "high",
    },
    {
      id: "ads_policies",
      group: "ads",
      label: "İade/gizlilik politikaları erişilebilir",
      status: hasPolicy(/(iade|return|refund)/) && hasPolicy(/(gizlilik|privacy|kvkk)/) ? "pass" : "not_detected",
      detail: "Reklam platformları genellikle görünür politika sayfası ister",
      priority: "medium",
    },
    {
      id: "ads_eligibility",
      group: "ads",
      label: "Ülke / sektör / hesap uygunluğu",
      status: "requires_verification",
      detail: "Güncel sağlayıcı kuralları ve hesap doğrulaması gerekir; crawl ile belirlenemez",
      priority: "medium",
    },
    {
      id: "ads_checkout",
      group: "ads",
      label: "Checkout işleyişi",
      status: "requires_verification",
      detail: "Kamu crawl'ı checkout'un çalıştığını kanıtlamaz",
      priority: "low",
    },
  ];

  return {
    geoScore: score(checks.filter((c) => c.group === "geo")),
    adsScore: score(checks.filter((c) => c.group === "ads")),
    checks,
  };
}
