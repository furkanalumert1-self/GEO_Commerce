import { registrableLabel } from "./competitor-filter";
import type { PageFacts } from "./html";

/**
 * İşletme türü tespiti ve türe uygun ücretsiz ölçüm soruları. Tür bir tahmindir: gerekçe, kaynak URL ve güven
 * düzeyiyle saklanır; düşük güvende kullanıcı onay ekranında türü seçer. Ürün markası çeşitliliği tek sinyaldir;
 * site açıklaması, hizmet/çözüm sayfaları ve yapılandırılmış veri birlikte değerlendirilir.
 */
export type BusinessType = "manufacturer" | "retailer" | "brand_store" | "marketplace" | "service" | "saas" | "service_saas" | "unknown";
export type Confidence = "high" | "medium" | "low";

export const BUSINESS_LABEL: Record<BusinessType, string> = {
  manufacturer: "Üretici / kendi markası",
  retailer: "Çok markalı mağaza",
  brand_store: "Kendi markası + mağaza (karma)",
  marketplace: "Pazaryeri",
  service: "Hizmet / ajans",
  saas: "Yazılım (SaaS)",
  service_saas: "Hizmet + yazılım (karma)",
  unknown: "Belirlenemedi",
};

export interface BusinessProfile {
  type: BusinessType;
  confidence: Confidence;
  reasons: string[];
  evidenceUrls: string[];
  /** Hizmet/çözüm adları (menü başlıkları değil, gerçek teklifler). */
  offerings: string[];
  /** Yazılım çözümleri (karma işletmede hizmetlerden ayrı tutulur). */
  softwareOfferings: string[];
  /** Ajans dili ("ajans/agency") sitede geçiyor mu — soru metninde "ajans" mı "firma" mı denileceği. */
  agencyWording: boolean;
}

type Page = { url: string; pageType: string; facts: Pick<PageFacts, "title" | "h1" | "metaDescription" | "schemaTypes" | "products" | "ogSiteName" | "links" | "breadcrumbs" | "lang"> & { anchors?: Array<{ url: string; text: string }> } };

const MARKETPLACES = new Set(["trendyol", "hepsiburada", "n11", "amazon", "ciceksepeti", "pttavm", "etsy", "ebay", "aliexpress", "temu", "pazarama", "idefix"]);
const SERVICE_PATH = /\/(hizmet(ler|lerimiz)?|services?)\/([^/?#]+)|\/[^/?#]*-(hizmeti|hizmetleri|hizmet)\/?$/i;
/** Yasal/politika sayfaları teklif değildir ("Hizmet Şartları", "Bilgi Toplumu Hizmetleri", "Terms of Service"). */
const LEGAL = /(sartlar|şartlar|terms|kosullar|koşullar|sozlesme|sözleşme|gizlilik|privacy|kvkk|bilgi[- ]toplumu|cookie|cerez|çerez|policy|politika|aydinlatma|aydınlatma|legal)/i;
const SOLUTION_PATH = /\/(cozumler(imiz)?|ai-cozumlerimiz|solutions?|urunler|products?|platform|yazilim|software)\/([^/?#]+)/i;
/** Hizmet bölümü breadcrumb'ı ("Hizmetlerimiz > SEO") — son halka teklif adıdır. */
const SERVICE_CRUMB = /^(hizmetlerimiz|hizmetler|services|our services)$/i;
const SAAS_PATH = /\/(pricing|fiyatlandirma|fiyatlar|plans|paketler|demo|signup|sign-up|kayit-ol|ucretsiz-dene|free-trial|integrations|entegrasyonlar|docs|api)(\/|$)/i;
/** Menü başlıkları ve gezinme metinleri — teklif adı değildir. */
const NAV_TEXT = /^(tüm .*|all .*|hizmetlerimiz|hizmetler|ürünlerimiz|ürünler|çözümlerimiz|çözümler|ai çözümlerimiz|services|our services|solutions|products|tümü|tümünü gör|detaylı bilgi|detay|incele|devamı|daha fazla|read more|learn more|keşfet|hemen başla|iletişim|hakkımızda|blog|anasayfa|ana sayfa|home)$/i;
const AGENCY_RE = /\b(ajans|ajansı|agency|dijital pazarlama ajansı)\b/i;

const norm = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/[^a-z0-9ğüşöç]/g, "");

/** Başlıklarda markaya eklenen genel ifadeler ("Online Alışveriş", "Resmi Web Sitesi", "Official Store"). */
const TITLE_FILLER = /\s*[-–—:,]?\s*(online alışveriş( sitesi| mağazası)?|online mağaza(sı)?|resmi (web )?(sitesi|mağazası)|official (web)?site|official (online )?store|online shop(ping)?|alışveriş sitesi|e-?ticaret sitesi)\s*$/i;

/**
 * Sayfa başlığı/site adından yalın marka adı: "English Home Online Alışveriş | English Home" → "English Home",
 * "Folinea® – Advanced Hair Growth" → "Folinea". Parçalardan alan adıyla eşleşen seçilir; yoksa ilk parça
 * genel eklerinden arındırılır. Hiçbir şey kalmazsa alan adı etiketi döner.
 */
export function cleanBrandName(raw: string | null | undefined, domain: string): string;
export function cleanBrandName(raw: string | null | undefined, domain: string, opts: { strict: true }): string | null;
export function cleanBrandName(raw: string | null | undefined, domain: string, opts?: { strict?: boolean }): string | null {
  const label = registrableLabel(domain);
  const parts = (raw ?? "")
    .replace(/[®™©]/g, "")
    .split(/\s[–—|-]\s|\s?\|\s?/)
    .map((x) => x.replace(TITLE_FILLER, "").trim())
    .filter((x) => x.length >= 2);
  const own = parts.find((x) => norm(x) === norm(label)) ?? parts.find((x) => norm(label).length >= 4 && norm(x).includes(norm(label)) && x.split(/\s+/).length <= 4);
  if (opts?.strict) return own ?? null;
  return own ?? parts[0] ?? label;
}

/** Ana sayfadan marka adı: site adı (og:site_name) güvenilir; başlık/H1 yalnız alan adıyla eşleşen parça varsa kullanılır. */
export function homeBrandName(home: Page | undefined, domain: string): string {
  const f = home?.facts;
  if (f?.ogSiteName?.trim()) return cleanBrandName(f.ogSiteName, domain);
  return cleanBrandName(f?.title, domain, { strict: true }) ?? cleanBrandName(f?.h1, domain, { strict: true }) ?? registrableLabel(domain);
}

/** Sitenin kendi marka adı: og:site_name, yoksa alan adı etiketi. */
export function siteBrandName(pages: Page[], domain: string): string {
  const og = pages.map((p) => p.facts.ogSiteName).find((x) => x && x.trim().length >= 2);
  if (og) return cleanBrandName(og, domain);
  return homeBrandName(pages.find((p) => p.pageType === "home"), domain);
}

/** "WhatsApp Marketing Hizmeti" → "WhatsApp Marketing"; "SEO Hizmetleri" → "SEO". */
function offeringName(text: string): string {
  return text
    .replace(/[›»>→↗]+/g, "")
    .replace(/\s+(hizmeti|hizmetleri|hizmet|services?)$/i, "")
    .replace(/^profesyonel\s+/i, "")
    .trim();
}

/**
 * Gerçek teklif adları: ilgili yoldaki bağlantı metinleri, hizmet breadcrumb'ının son halkası ve taranan teklif
 * sayfasının H1'i. Menü başlıkları ("Hizmetlerimiz") ve gezinme metinleri alınmaz. Sıra: kaç sayfada göründüğü,
 * eşitlikte menüdeki ilk görünme sırası (öne çıkarılan hizmet önce).
 */
function offeringsFrom(pages: Page[], pathRe: RegExp, crumbRe: RegExp | null): string[] {
  const counts = new Map<string, { text: string; n: number; first: number }>();
  let order = 0;
  const add = (raw: string, w: number) => {
    const text = offeringName(raw);
    if (text.length < 2 || text.length > 48 || NAV_TEXT.test(text) || /\?|^\d+$/.test(text)) return;
    const k = norm(text);
    const cur = counts.get(k);
    counts.set(k, { text: cur?.text ?? text, n: (cur?.n ?? 0) + w, first: cur?.first ?? order++ });
  };
  const pathOf = (u: string) => {
    try {
      return decodeURIComponent(new URL(u).pathname);
    } catch {
      return "";
    }
  };
  for (const p of pages) {
    for (const a of p.facts.anchors ?? []) if (pathRe.test(pathOf(a.url)) && !LEGAL.test(a.url) && !LEGAL.test(a.text)) add(a.text, 1);
    const crumbs = (p.facts as { breadcrumbs?: string[] }).breadcrumbs ?? [];
    if (crumbRe && crumbs.length >= 2 && crumbRe.test(crumbs[0]!)) add(crumbs[crumbs.length - 1]!, 2);
    else if (pathRe.test(pathOf(p.url)) && !LEGAL.test(p.url) && p.facts.h1) add(p.facts.h1, 2);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first).map((x) => x.text).slice(0, 6);
}

export function detectBusiness(pages: Page[], domain: string): BusinessProfile {
  const label = registrableLabel(domain);
  const brand = siteBrandName(pages, domain);
  const reasons: string[] = [];
  const evidence = new Set<string>();
  const products = new Map<string, { brand: string | null; url: string }>();
  for (const p of pages) for (const x of p.facts.products) if (x.name) products.set(norm(x.name), { brand: x.brand ?? null, url: p.url });
  const branded = [...products.values()].filter((x) => x.brand);
  const brandKeys = new Map<string, number>();
  for (const x of branded) brandKeys.set(norm(x.brand!), (brandKeys.get(norm(x.brand!)) ?? 0) + 1);
  const ownKeys = [norm(brand), norm(label)].filter((k) => k.length >= 3);
  const isOwn = (k: string) => ownKeys.some((o) => k.includes(o) || o.includes(k));
  const ownCount = [...brandKeys.entries()].filter(([k]) => isOwn(k)).reduce((s, [, n]) => s + n, 0);
  const otherBrands = [...brandKeys.keys()].filter((k) => !isOwn(k)).length;
  const ownShare = branded.length ? ownCount / branded.length : null;

  const allText = pages.map((p) => [p.facts.title, p.facts.h1, p.facts.metaDescription].filter(Boolean).join(" ")).join(" ");
  const schema = new Set(pages.flatMap((p) => p.facts.schemaTypes));
  const allLinks = pages.flatMap((p) => p.facts.links);
  const serviceLinks = allLinks.filter((u) => SERVICE_PATH.test(u) && !LEGAL.test(u));
  const saasLinks = allLinks.filter((u) => SAAS_PATH.test(u));
  // Yazılım sinyali: şema veya fiyatlandırma + deneme/kayıt birlikte (tek "demo"/"api" bağlantısı yetmez).
  const hasPricing = allLinks.some((u) => /\/(pricing|fiyatlandirma|plans|paketler)(\/|$)/i.test(u));
  const hasTrial = allLinks.some((u) => /\/(signup|sign-up|kayit-ol|ucretsiz-dene|free-trial|register|try)(\/|$)/i.test(u));
  const offerings = offeringsFrom(pages, SERVICE_PATH, SERVICE_CRUMB);
  const serviceSignal = schema.has("Service") || schema.has("ProfessionalService") || (serviceLinks.length >= 2 && offerings.length >= 1) || AGENCY_RE.test(allText);
  const saasSignal = schema.has("SoftwareApplication") || schema.has("WebApplication") || (hasPricing && hasTrial);
  const agencyWording = AGENCY_RE.test(allText);
  for (const u of [...serviceLinks, ...saasLinks].slice(0, 3)) evidence.add(u);

  const base = { offerings, softwareOfferings: [] as string[], agencyWording };

  if (MARKETPLACES.has(label)) {
    return { ...base, type: "marketplace", confidence: "high", reasons: ["Bilinen pazaryeri alan adı"], evidenceUrls: [`https://${domain}/`] };
  }
  if (products.size >= 2) {
    for (const x of [...products.values()].slice(0, 3)) evidence.add(x.url);
    if (branded.length >= 3 && otherBrands >= 3 && (ownShare ?? 0) < 0.5) {
      reasons.push(`${products.size} üründe ${otherBrands} farklı üretici markası görüldü; kendi markası payı %${Math.round((ownShare ?? 0) * 100)}`);
      return { ...base, type: "retailer", confidence: otherBrands >= 4 && branded.length >= 5 ? "high" : "medium", reasons, evidenceUrls: [...evidence] };
    }
    if (branded.length >= 2 && ownShare !== null && ownShare >= 0.7) {
      reasons.push(`Ürünlerin %${Math.round(ownShare * 100)}'i sitenin kendi markası (${brand})`);
      return { ...base, type: "manufacturer", confidence: branded.length >= 4 ? "high" : "medium", reasons, evidenceUrls: [...evidence] };
    }
    if (branded.length >= 2 && ownCount > 0 && otherBrands > 0) {
      reasons.push(`Kendi markası (${brand}) ve ${otherBrands} başka marka birlikte satılıyor`);
      return { ...base, type: "brand_store", confidence: "medium", reasons, evidenceUrls: [...evidence] };
    }
    if (branded.length >= 3 && otherBrands >= 2) {
      reasons.push(`${otherBrands} farklı marka görüldü; kendi markası ürünlerde görülmedi`);
      return { ...base, type: "retailer", confidence: "medium", reasons, evidenceUrls: [...evidence] };
    }
    reasons.push("Ürün satışı var ama ürünlerde marka bilgisi yetersiz; tür kullanıcıya sorulmalı");
    return { ...base, type: "brand_store", confidence: "low", reasons, evidenceUrls: [...evidence] };
  }
  if (serviceSignal && saasSignal) {
    reasons.push("Hem hizmet sayfaları hem yazılım (fiyatlandırma/demo/entegrasyon) sinyalleri var");
    return { ...base, type: "service_saas", confidence: "medium", softwareOfferings: offeringsFrom(pages, SOLUTION_PATH, null), reasons, evidenceUrls: [...evidence] };
  }
  if (saasSignal) {
    reasons.push(schema.has("SoftwareApplication") ? "SoftwareApplication yapılandırılmış verisi var" : "Fiyatlandırma/demo/entegrasyon sayfaları var");
    return { ...base, type: "saas", confidence: schema.has("SoftwareApplication") ? "high" : "medium", softwareOfferings: offerings, reasons, evidenceUrls: [...evidence] };
  }
  if (serviceSignal) {
    reasons.push(offerings.length ? `Hizmet sayfaları bulundu: ${offerings.slice(0, 3).join(", ")}` : "Hizmet/ajans ifadeleri var");
    return { ...base, type: "service", confidence: offerings.length >= 2 ? "high" : "medium", reasons, evidenceUrls: [...evidence] };
  }
  reasons.push("Ürün, hizmet veya yazılım sinyali yeterli değil");
  return { ...base, type: "unknown", confidence: "low", reasons, evidenceUrls: [`https://${domain}/`] };
}

export type QuestionKind = "discovery" | "need" | "info";

export const KIND_LABEL: Record<QuestionKind, string> = { discovery: "Keşif", need: "İhtiyaç", info: "Bilgi" };

export interface AuditQuestion {
  text: string;
  kind: QuestionKind;
  /** Hangi kategori/hizmet için. */
  topic: string;
}

export interface QuestionSet {
  questions: AuditQuestion[];
  /** Seçilen en çok 2 temsilî kategori/hizmet. */
  topics: string[];
  /** 5'ten az soru varsa nedeni (uydurma ile tamamlanmaz). */
  incomplete: string | null;
}

const lowerTr = (s: string) => s.toLocaleLowerCase("tr-TR");
const capTr = (s: string) => (s ? s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1) : s);
/** Kısaltmaları (SEO, GEO, CRM) koruyarak küçük harfe çevirir. */
const soft = (s: string) => s.split(/\s+/).map((w) => ((w.match(/[A-ZÇĞİÖŞÜ]/g)?.length ?? 0) >= 2 ? w : lowerTr(w))).join(" ");

/**
 * Ücretsiz ölçüm soru seti: 2 keşif + 2 ihtiyaç + 1 bilgi, en çok 2 konu. Konu yoksa (veri yetersiz) eksik set
 * döner; 5'e tamamlamak için genel soru uydurulmaz. Marka adı geçen soru üretilmez (genel keşif ölçülür).
 */
export function buildQuestionSet(profile: Pick<BusinessProfile, "type" | "offerings" | "softwareOfferings" | "agencyWording">, categories: string[], opts: { country: string; brandName: string; groups?: TopicGroup[]; gift?: boolean }): QuestionSet {
  const place = opts.country === "TR" ? "Türkiye'de " : "";
  const brandKeyG = norm(opts.brandName);
  // Kanıtlı ürün grupları varsa (mağaza/üretici/karma) somut soru seti; menü/oda adıyla genel soru üretilmez.
  const groups = diverseGroups((opts.groups ?? []).filter((g) => !(brandKeyG.length >= 3 && norm(g.label).includes(brandKeyG))), 2);
  if (groups.length && !["service", "saas", "service_saas"].includes(profile.type)) {
    const seenG = new Set<string>();
    const outG = groupQuestions(profile.type, groups, { country: opts.country, gift: Boolean(opts.gift) }).filter((x) => {
      const k = norm(x.text);
      if (seenG.has(k) || (brandKeyG.length >= 3 && k.includes(brandKeyG))) return false;
      seenG.add(k);
      return true;
    });
    return { questions: outG, topics: groups.map((g) => g.label), incomplete: outG.length < 5 ? "Bazı sorular tekrar ettiği için çıkarıldı." : null };
  }
  const service = ["service", "service_saas"].includes(profile.type);
  const software = ["saas", "service_saas"].includes(profile.type);
  const rawTopics = service || software ? profile.offerings : categories;
  const brandKey = norm(opts.brandName);
  const topics = rawTopics.map((t) => t.trim()).filter((t) => t.length >= 3 && !(brandKey.length >= 3 && norm(t).includes(brandKey))).slice(0, 2);
  const softTopics = (profile.type === "service_saas" ? profile.softwareOfferings : profile.offerings).filter((t) => !(brandKey.length >= 3 && norm(t).includes(brandKey))).slice(0, 2);
  if (!topics.length && !(software && softTopics.length)) {
    return { questions: [], topics: [], incomplete: profile.type === "unknown" ? "İşletme türü ve kategoriler belirlenemedi; ürün/hizmet kategorinizi girin." : "Temsilî kategori/hizmet bulunamadı; kategorinizi girin." };
  }
  const [a, b] = [topics[0] ?? softTopics[0]!, topics[1] ?? topics[0] ?? softTopics[0]!];
  const A = soft(a);
  const B = soft(b);
  // "Mutfak" → "mutfak ürünleri"; zaten çoğul olan konuya ("nemlendiriciler") ek eklenmez.
  const goods = (t: string) => (/l[ae]r$/i.test(t) ? t : `${t} ürünleri`);
  const AG = goods(A);
  const BG = goods(B);
  const firms = profile.agencyWording ? "ajansları" : "firmaları";
  const firmsNom = profile.agencyWording ? "ajanslar" : "firmalar";
  const q = (text: string, kind: QuestionKind, topic: string): AuditQuestion => ({ text: capTr(text.replace(/\s+/g, " ").trim()), kind, topic });
  let list: AuditQuestion[];
  switch (profile.type) {
    case "retailer":
    case "marketplace":
      list = [
        q(`${place}${AG} satın alabileceğim online mağazalar hangileri?`, "discovery", a),
        q(`${capTr(BG)} için hangi online mağazaları karşılaştırabilirim?`, "discovery", b),
        q(`${place}uygun fiyatlı ve kaliteli ${AG} için nereden alışveriş yapabilirim?`, "need", a),
        q(`${capTr(BG)} için geniş seçenek ve kolay iade sunan mağazalar hangileri?`, "need", b),
        q(`${capTr(AG)} seçerken nelere dikkat etmeliyim?`, "info", a),
      ];
      break;
    case "manufacturer":
      list = [
        q(`${place}en iyi ${A} markaları hangileri?`, "discovery", a),
        q(a !== b ? `${capTr(BG)} için hangi markaları önerirsin?` : `${capTr(AG)} için hangi markaları karşılaştırabilirim?`, "discovery", b),
        q(`${capTr(AG)} alacağım; hangi seçenekleri değerlendirmeliyim?`, "need", a),
        q(`${capTr(BG)} için fiyat/performans açısından hangi markalar öne çıkıyor?`, "need", b),
        q(`${capTr(AG)} seçerken nelere dikkat etmeliyim?`, "info", a),
      ];
      break;
    case "brand_store":
    case "unknown":
      list = [
        q(`${place}${AG} satın alabileceğim online mağazalar hangileri?`, "discovery", a),
        q(`${capTr(BG)} için hangi markaları önerirsin?`, "discovery", b),
        q(`${place}uygun fiyatlı ve kaliteli ${AG} için nereden alışveriş yapabilirim?`, "need", a),
        q(`${place}kaliteli ve güvenilir ${BG} arıyorum, hangi markaları değerlendirmeliyim?`, "need", b),
        q(`${capTr(AG)} seçerken nelere dikkat etmeliyim?`, "info", a),
      ];
      break;
    case "service":
      list = [
        q(`${place}${A} hizmeti veren ${firms} karşılaştırır mısın?`, "discovery", a),
        q(`${capTr(B)} için hangi ${profile.agencyWording ? "ajanslarla" : "firmalarla"} çalışabilirim?`, "discovery", b),
        q(a !== b ? `${capTr(A)} ve ${B} hizmetlerini birlikte sunan ${firmsNom} hangileri?` : `${place}${A} için güvenilir bir ${profile.agencyWording ? "ajans" : "firma"} arıyorum, kimleri önerirsin?`, "need", a),
        q(`${place}${B} konusunda deneyimli ${firmsNom} hangileri?`, "need", b),
        q(`${capTr(A)} hizmeti alırken nelere dikkat etmeliyim?`, "info", a),
      ];
      break;
    case "saas": {
      list = [
        q(`${capTr(A)} için hangi yazılımları önerirsin?`, "discovery", a),
        q(a !== b ? `${capTr(B)} araçlarını karşılaştırır mısın?` : `En çok kullanılan ${A} araçları hangileri?`, "discovery", b),
        q(`Ekibimiz için ${A} çözümü arıyoruz; hangi seçenekleri değerlendirmeliyiz?`, "need", a),
        q(`${capTr(B)} süreçlerini kolaylaştıran yazılımlar hangileri?`, "need", b),
        q(`${capTr(A)} yazılımı seçerken nelere dikkat etmeliyim?`, "info", a),
      ];
      break;
    }
    case "service_saas": {
      const s = softTopics[0] ?? b;
      const S = soft(s);
      list = [
        q(`${place}${A} hizmeti veren ${firms} karşılaştırır mısın?`, "discovery", a),
        q(`${capTr(S)} için hangi yazılımları önerirsin?`, "discovery", s),
        q(`${place}${A} konusunda deneyimli ${firmsNom} hangileri?`, "need", a),
        q(`Ekibimiz için ${S} çözümü arıyoruz; hangi seçenekleri değerlendirmeliyiz?`, "need", s),
        q(`${capTr(A)} hizmeti alırken nelere dikkat etmeliyim?`, "info", a),
      ];
      break;
    }
  }
  // Tekrar/çok benzer soruları ele; marka adı geçen soru genel keşif skoruna girmez.
  const seen = new Set<string>();
  const out = list.filter((x) => {
    const k = norm(x.text);
    if (seen.has(k) || (brandKey.length >= 3 && k.includes(brandKey))) return false;
    seen.add(k);
    return true;
  });
  return { questions: out, topics: [...new Set([a, b])], incomplete: out.length < 5 ? "Bazı sorular tekrar ettiği için çıkarıldı; eksik soruları düzenleyerek ekleyebilirsiniz." : null };
}

/**
 * Temsilî konu seçimi: kategori terimlerinden en çok ürün/sayfada geçen ilk 2'si (sayfa sırasına göre körlemesine
 * değil). Eşitlikte orijinal sıra korunur.
 */
export function representativeTopics(terms: string[], pages: Page[], max = 2): string[] {
  const hay = pages.flatMap((p) => [p.facts.title, p.facts.h1, ...p.facts.products.map((x) => `${x.name ?? ""} ${(x as { category?: string | null }).category ?? ""}`)].filter(Boolean).map((t) => lowerTr(t!)));
  const scored = terms.map((t, i) => {
    const k = lowerTr(t);
    const stem = k.length > 5 ? k.slice(0, k.length - 2) : k;
    return { t, i, n: hay.filter((h) => h.includes(stem)).length };
  });
  return scored.sort((x, y) => y.n - x.n || x.i - y.i).slice(0, max).map((x) => x.t);
}

const GENERIC_SEGMENT = new Set(["products", "product", "urun", "urunler", "p", "collections", "kategori", "category", "c", "tr", "en"]);
const JUNK_TOPIC = /^(products?|all|tümü|tüm ürünler|ürünler|koleksiyon|collection|anasayfa|ana sayfa|kampanya.*|indirim.*|outlet|yeni.*|çok satan.*|.*rehberi?|.*guide|blog|ilham.*|trend.*|fırsat.*|hediye( fikirleri)?|marka(lar)?|mağaza(lar)?|stores?)$/i;
/** Vitrin/satış etiketleri ve beden/ölçü filtreleri: ürün grubu değildir (ör. "Basics", "Best Sellers", "28-30 inch Inseam"). */
const MERCH_TOPIC = /^(basics?|essentials?|new( arrivals?| in)?|best ?sellers?|top sellers?|sale|clearance|last chance|en yeniler|yeni gelenler|sezon.*|temel( parçalar| ürünler)?|online('?a)? özel.*|sadece online.*|.*\bsale)$|\b\d+([-–/]\d+)?\s?(inch|inç|cm|beden)\b|\binseam\b|\bbeden\b/i;
const ENGLISH_HINT = /\b(and|for|the|with|treatments?|serums?|shampoos?|hair|loss|acids?|products?|collection|care|face|skin|body|men|women|kids|home|kitchen)\b/i;

/** "Collection: Saç Bakımı" → "Saç Bakımı"; gürültü ve (Türkçe sitede) İngilizce ürün tipi etiketleri elenir. */
export function cleanTopic(raw: string, language: string): string | null {
  const t = raw.replace(/^(collection|koleksiyon|kategori)\s*:\s*/i, "").split(/\s[|–—]\s/)[0]!.trim();
  if (t.length < 3 || t.length > 40 || JUNK_TOPIC.test(t) || MERCH_TOPIC.test(t)) return null;
  if (language === "tr" && /^[\x00-\x7F]+$/.test(t) && ENGLISH_HINT.test(t)) return null;
  return t;
}

/**
 * Mağazada temsilî ana kategoriler: ürün adreslerinin ilk yol bölümü (/ev-tekstili/…) ana sayfa menüsünde bir
 * bölümse, o bölümün menü adı alınır; bölümler menüdeki alt bağlantı sayısına göre sıralanır (ürün yelpazesi
 * genişliği). Shopify gibi /products/ yapısında bölüm yoktur → boş döner.
 */
export function menuSections(pages: Page[]): string[] {
  const seg = (u: string) => {
    try {
      return decodeURIComponent(new URL(u).pathname).split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
    } catch {
      return "";
    }
  };
  const productSegs = new Set(pages.filter((p) => p.pageType === "product").map((p) => seg(p.url)).filter((x) => x && !GENERIC_SEGMENT.has(x)));
  if (!productSegs.size) return [];
  const home = pages.find((p) => p.pageType === "home") ?? pages[0];
  const names = new Map<string, string>();
  const width = new Map<string, number>();
  for (const a of home?.facts.anchors ?? []) {
    const s = seg(a.url);
    if (!productSegs.has(s)) continue;
    width.set(s, (width.get(s) ?? 0) + 1);
    let path = "";
    try {
      path = new URL(a.url).pathname.replace(/\/+$/, "");
    } catch {
      continue;
    }
    if (path.toLowerCase() === `/${s}` && !names.has(s)) names.set(s, a.text);
  }
  return [...names.entries()].sort((a, b) => (width.get(b[0]) ?? 0) - (width.get(a[0]) ?? 0)).map(([, n]) => n);
}

/**
 * Soru konuları (en çok 2): hizmet/yazılımda gerçek teklifler; mağazada menü ana bölümleri, yoksa breadcrumb üst
 * düzeyi; üreticide kategori terimleri. Hepsi doğrulanmış site içeriğinden gelir; uydurulmaz.
 */
export function topicsFor(profile: Pick<BusinessProfile, "type" | "offerings">, pages: Page[], terms: string[], language: string): string[] {
  if (["service", "saas", "service_saas"].includes(profile.type)) return profile.offerings.slice(0, 2);
  const crumbTops = new Map<string, number>();
  for (const p of pages) {
    const top = (p.facts.breadcrumbs ?? [])[0];
    if (top) crumbTops.set(top, (crumbTops.get(top) ?? 0) + 1);
  }
  const categoryH1 = pages.filter((p) => p.pageType === "category").map((p) => p.facts.h1 ?? "").filter(Boolean);
  const clean = (list: string[]) => [...new Set(list.map((t) => cleanTopic(t, language)).filter((t): t is string => Boolean(t)))];
  if (["retailer", "marketplace", "brand_store", "unknown"].includes(profile.type)) {
    const sections = clean(menuSections(pages));
    if (sections.length) return sections.slice(0, 2);
    const tops = clean([...crumbTops.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t));
    if (tops.length) return tops.slice(0, 2);
  }
  return representativeTopics(clean([...terms, ...categoryH1, ...crumbTops.keys()]), pages);
}

/** Ölçüm grubu: ana alan → anlamlı ürün grubu (→ alt tür), tarama kanıtıyla. */
export interface TopicGroup {
  label: string;
  area: string | null;
  subtype: string | null;
  products: string[];
  evidenceUrls: string[];
  /** Grup ürün adlarının en az ikisinde geçen malzeme/özellik (doğrulanmış). */
  attributes: string[];
  /** Grup ürünlerinden en az biri set (ör. "Aile Seti"). */
  hasSet: boolean;
  /** Grup ürünlerinin TL fiyatları (yalnız sayfada TRY fiyatı olanlar); bütçe sorusu için. */
  prices?: number[];
}

/** Oda/alan adları tek başına ölçüm grubu olamaz ("Banyo" vitrifiye mi tekstil mi belirsiz). */
const AREA_ONLY = /^(banyo|mutfak|sofra( (&|ve) mutfak)?|yatak odası|salon|oturma odası|ev|bahçe|balkon|ev ve yaşam|yaşam|ev dekorasyonu|dekorasyon|mobilya|giyim|kadın|erkek|çocuk|bebek( (&|ve) çocuk)?|aksesuar(lar)?|hediye.*|kozmetik|kişisel bakım)$/i;
const MATERIALS = ["%100 pamuk", "pamuk", "ranforce", "saten", "pike", "gofre", "müslin", "flanel", "penye", "mikrofiber", "viskon", "jakarlı", "nakışlı", "bambu", "keten", "porselen", "seramik", "cam", "ahşap", "metal", "kadife", "deri", "yün", "kaşmir", "denim", "organik", "paslanmaz çelik", "döküm", "bakır", "mermer", "rattan", "hasır"];

/**
 * Ürün sayfalarının breadcrumb'larından (yoksa ürün kategori yolundan) gruplar: alan = 1. düzey, grup = 2. düzey,
 * alt tür = 3. düzey. Oda/alan adı tek başına grup sayılmaz (alt düzeye inilir). Sıralama: grupta kanıtlı ürün
 * sayısı (taranan örneklemde), eşitlikte ilk görülme. Hiçbiri yoksa boş döner (uydurma yok).
 */
export function productGroups(pages: Page[], language: string): TopicGroup[] {
  const acc = new Map<string, { label: string; area: string | null; first: number; products: string[]; urls: string[]; subtypes: Map<string, number>; prices: number[] }>();
  let order = 0;
  for (const p of pages) {
    if (p.pageType !== "product") continue;
    const name = p.facts.products.find((x) => x.name)?.name?.trim() ?? p.facts.h1?.trim() ?? "";
    if (!name) continue;
    let path = (p.facts.breadcrumbs ?? []).map((c) => c.trim()).filter(Boolean);
    if (path.length && norm(path[path.length - 1]!) === norm(name)) path = path.slice(0, -1);
    if (!path.length) {
      const cat = p.facts.products.find((x) => (x as { category?: string | null }).category)?.category;
      if (cat) path = cat.split(/\s*[>/|»]\s*/).map((x) => x.trim()).filter(Boolean);
    }
    path = path.map((c) => cleanTopic(c, language) ?? "").filter(Boolean);
    if (!path.length) continue;
    let gi = path.length >= 2 ? 1 : 0;
    while (gi < path.length - 1 && (AREA_ONLY.test(path[gi]!) || AUDIENCE_LABEL.test(path[gi]!))) gi++;
    const label = path[gi]!;
    if (AREA_ONLY.test(label) || AUDIENCE_LABEL.test(label)) continue;
    const k = norm(label);
    const cur = acc.get(k) ?? { label, area: gi > 0 ? path[0]! : null, first: order++, products: [] as string[], urls: [] as string[], subtypes: new Map<string, number>(), prices: [] as number[] };
    if (!cur.products.includes(name)) {
      cur.products.push(name);
      cur.urls.push(p.url);
      const pf = p.facts.products.find((x) => x.price);
      const price = Number(pf?.price);
      if (pf && (pf.currency ?? "TRY").toUpperCase() === "TRY" && Number.isFinite(price) && price > 0) cur.prices.push(price);
    }
    const sub = path[gi + 1];
    if (sub) cur.subtypes.set(sub, (cur.subtypes.get(sub) ?? 0) + 1);
    acc.set(k, cur);
  }
  if (acc.size === 0) return listingGroups(pages, language);
  return [...acc.values()]
    .sort((a, b) => b.products.length - a.products.length || a.first - b.first)
    .map((g) => {
      const names = g.products.map((n) => lowerTr(n));
      // Ürün adında geçen malzeme/özellik doğrulanmış bilgidir; çok ürünlü grupta en az iki üründe aranır.
      const attributes = MATERIALS.filter((m) => names.filter((n) => n.includes(m)).length >= Math.min(2, names.length)).filter((m, i, all) => !all.some((o, j) => j < i && o.includes(m)));
      const subtype = [...g.subtypes.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { prices: g.prices, label: withAudience(g.label, g.area), area: g.area, subtype, products: g.products.slice(0, 5), evidenceUrls: g.urls.slice(0, 3), attributes: attributes.slice(0, 2), hasSet: names.some((n) => /\bset(i)?\b/.test(n)) };
    });
}

/**
 * Soru içinde doğal kullanım için tek kelimelik çoğul menü adını tekile çevirir: "Halılar" → "halı",
 * "Nemlendiriciler" → "nemlendirici". Çok kelimeli adlar ("Banyo havluları") olduğu gibi kalır.
 */
export function questionNoun(label: string): string {
  const t = soft(label);
  if (/\s/.test(t)) {
    // Çok kelimeli çoğul tamlama tekile: "yemek takımları" → "yemek takımı", "banyo havluları" → "banyo havlusu".
    const words = t.split(" ");
    const last = words[words.length - 1]!;
    const m = last.match(/^(.{2,}?)l[ae]r[ıiuü]$/u);
    if (!m) return t;
    const stem = m[1]!;
    const v = (stem.match(/[aeıioöuü](?=[^aeıioöuü]*$)/u) ?? ["a"])[0];
    const poss = v === "a" || v === "ı" ? "ı" : v === "e" || v === "i" ? "i" : v === "o" || v === "u" ? "u" : "ü";
    words[words.length - 1] = `${stem}${/[aeıioöuü]$/u.test(stem) ? "s" : ""}${poss}`;
    return words.join(" ");
  }
  if (t.length < 6) return t;
  return t.replace(/(lar|ler)$/u, "");
}

/**
 * Ürün sayfası okunamadığında (ürün listesi JavaScript ile yüklenen siteler) kategori sayfalarının breadcrumb'ları
 * kanıt olarak kullanılır: "Anasayfa › Kadın › Kadın Jean" → alan "Kadın", grup "Kadın Jean". Daha derin (daha
 * özgül) yol önce gelir; vitrin etiketleri (Yeni Gelenler, Basics) ve yalnız alan adları elenir.
 */
/** Yaş/cinsiyet segmenti ürün türü değildir ("Erkek Çocuk (5-14 Yaş)", "Kız Bebek"); bir alt seviyeye inilir. */
const AUDIENCE_LABEL = /\(\s*\d+\s*[-–]\s*\d+\s*(yaş|ay)\s*\)|^(kız|erkek) (çocuk|bebek)$|^(genç|teen)$/i;

/** Cinsiyet/yaş alanı ("Kadın", "Erkek", "Çocuk") grup adına eklenir: "Kadın › Jeans" → "Kadın Jeans". */
const AUDIENCE_AREA = /^(kadın|erkek|çocuk|kız çocuk|erkek çocuk|bebek|genç|women|men|kids)$/i;
function withAudience(label: string, area: string | null): string {
  if (!area || !AUDIENCE_AREA.test(area.trim()) || norm(label).includes(norm(area))) return label;
  return `${area.trim()} ${label}`;
}

function listingGroups(pages: Page[], language: string): TopicGroup[] {
  const acc = new Map<string, { label: string; area: string | null; depth: number; first: number; urls: string[] }>();
  let order = 0;
  for (const p of pages) {
    if (p.pageType === "product" || p.pageType === "home") continue;
    const path = (p.facts.breadcrumbs ?? []).map((c) => cleanTopic(c.trim(), language) ?? "").filter(Boolean);
    if (path.length < 2) continue;
    const label = path[path.length - 1]!;
    if (AREA_ONLY.test(label)) continue;
    const k = norm(label);
    const cur = acc.get(k) ?? { label, area: path[0]!, depth: path.length, first: order++, urls: [] as string[] };
    if (cur.urls.length < 3) cur.urls.push(p.url);
    acc.set(k, cur);
  }
  return [...acc.values()]
    .sort((a, b) => b.depth - a.depth || a.first - b.first)
    .map((g) => ({ label: withAudience(g.label, g.area), area: g.area, subtype: null, products: [], evidenceUrls: g.urls, attributes: [], hasSet: false }));
}

/** Sitede hediye bölümü/bağlantısı var mı (hediye sorusu yalnız bu kanıtla sorulur). */
export function hasGiftSection(pages: Page[]): boolean {
  return pages.some((p) => (p.facts.anchors ?? []).some((a) => /hediye|gift/i.test(a.text) || /hediye|gift/i.test(a.url)));
}

/**
 * Ürün grubu kanıtıyla somut soru seti (mağaza/üretici/karma): 1 mağaza keşfi + 1 marka/mağaza karşılaştırma +
 * 1 somut ihtiyaç (doğrulanmış alt tür/malzeme) + 1 hediye (yalnız hediye bölümü ve set ürünü varsa) veya seçenek
 * sorusu + 1 bilgi. İki grup varsa sorular gruplara dağıtılır.
 */
/** Soru eki ünlü uyumu: "ranforce mu", "saten mi", "pamuk mu", "gofre mi". */
function questionParticle(word: string): string {
  const v = (lowerTr(word).match(/[aeıioöuü](?=[^aeıioöuü]*$)/u) ?? ["e"])[0];
  return v === "a" || v === "ı" ? "mı" : v === "e" || v === "i" ? "mi" : v === "o" || v === "u" ? "mu" : "mü";
}

/** Grup fiyatlarından yuvarlak bütçe sınırı (TL): medyanın biraz üstündeki ilk eşik; "1.500 TL altı". */
export function budgetCap(prices: number[] | undefined): number | null {
  const ps = (prices ?? []).filter((p) => p > 0).sort((a, b) => a - b);
  if (ps.length < 2) return null;
  // Alt medyan: az örnekte en pahalı ürün sınırı belirlemez.
  const median = ps[Math.floor((ps.length - 1) / 2)]!;
  const steps = [250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 30000, 50000, 75000, 100000];
  return steps.find((s) => s >= median * 1.05) ?? null;
}

/**
 * İki grup aynı ürün ailesindeyse ("Tek Kişilik Nevresim Takımı" / "Çift Kişilik Nevresim Takımı") ikinci grup
 * farklı bir aileden seçilir; yoksa tek grup kalır (5 soru aynı ürünü iki kez ölçmez).
 */
export function diverseGroups(groups: TopicGroup[], n = 2): TopicGroup[] {
  const head = (g: TopicGroup) => new Set(lowerTr(g.label).split(/\s+/).filter((w) => w.length > 3).slice(-2));
  const similar = (a: TopicGroup, b: TopicGroup) => {
    const A = head(a);
    const B = head(b);
    const common = [...A].filter((w) => B.has(w)).length;
    return common > 0 && common >= Math.min(A.size, B.size) / 2;
  };
  const out: TopicGroup[] = [];
  for (const g of groups) {
    if (out.length >= n) break;
    if (out.some((o) => similar(o, g))) continue;
    out.push(g);
  }
  return out.length ? out : groups.slice(0, 1);
}

export function groupQuestions(type: BusinessType, groups: TopicGroup[], opts: { country: string; gift: boolean }): AuditQuestion[] {
  const place = opts.country === "TR" ? "Türkiye'de " : "";
  const g1 = groups[0]!;
  const g2 = groups[1] ?? g1;
  const L1 = questionNoun(g1.label);
  const L2 = questionNoun(g2.label);
  const q = (text: string, kind: QuestionKind, topic: string): AuditQuestion => ({ text: capTr(text.replace(/\s+/g, " ").trim()), kind, topic });
  const store = type === "retailer" || type === "marketplace";
  // Somut ihtiyaç: doğrulanmış malzeme/özellik + ürün türü ("%100 pamuk tek kişilik nevresim takımı").
  // Malzemesi doğrulanmış grup somut ihtiyaç sorusunda kullanılır (ilk grupta yoksa ikinci gruptan).
  const ga = [g1, g2].find((g) => g.attributes.length) ?? g1;
  const attr = ga.attributes[0];
  const kindA = ga.subtype ? soft(ga.subtype) : questionNoun(ga.label);
  const needText = attr ? `${capTr(attr)} ${kindA} arıyorum; hangi seçenekleri önerirsin?` : `${capTr(L1)} alacağım; hangi seçenekleri değerlendirmeliyim?`;
  // Hediye sorusu yalnız sitede hediye bölümü varsa ve set ürünü olan grup için sorulur.
  const giftGroup = opts.gift ? ([g2, g1].find((g) => g.hasSet) ?? null) : null;
  // Bütçe sorusu: ürün fiyatlarından (TL) yuvarlak sınır; uydurma fiyat yok, fiyat yoksa sorulmaz.
  const budgetGroup = [g2, g1].find((g) => budgetCap(g.prices)) ?? null;
  const cap = budgetGroup ? budgetCap(budgetGroup.prices) : null;
  const fourth = giftGroup
    ? q(`Hediye olarak ${questionNoun(giftGroup.label)} seti alabileceğim mağazalar hangileri?`, "need", giftGroup.label)
    : cap && budgetGroup && opts.country === "TR"
      ? q(`${cap.toLocaleString("tr-TR")} TL altı iyi bir ${questionNoun(budgetGroup.label)} önerir misin?`, "need", budgetGroup.label)
      : q(store ? `${capTr(L2)} alırken geniş seçenek sunan online mağazalar hangileri?` : `${capTr(L2)} için fiyat/performans açısından hangi markalar öne çıkıyor?`, "need", g2.label);
  // Bilgi sorusu: iki doğrulanmış malzeme varsa karşılaştırma (satın alma kararına yakın), yoksa seçim kriteri.
  const [m1, m2] = ga.attributes.filter((a) => !/^%/.test(a));
  const LA = questionNoun(ga.label);
  const info = m1 && m2 ? `${capTr(LA)} için ${m1} ${questionParticle(m1)} ${m2} ${questionParticle(m2)} daha iyi?` : `${capTr(LA)} seçerken ${ga.attributes.length ? "malzeme ve kullanım açısından " : ""}nelere dikkat etmeliyim?`;
  return [
    // Ürün sayfası olan (online satış yapan) sitede ilk soru mağaza keşfidir; üreticide marka karşılaştırması ikinci soruda.
    q(`${place}${L1} satın alabileceğim online mağazalar hangileri?`, "discovery", g1.label),
    q(store ? `${capTr(L2)} için hangi online mağazaları karşılaştırabilirim?` : `${capTr(L2)} için hangi markaları karşılaştırabilirim?`, "discovery", g2.label),
    q(needText, "need", attr ? ga.label : g1.label),
    fourth,
    q(info, "info", ga.label),
  ];
}
