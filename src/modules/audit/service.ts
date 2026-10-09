import type { PrismaClient } from "@/generated/prisma/client";
import { config } from "@/lib/config";
import { log } from "@/lib/observability/log";
import { hashToken, randomToken, sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/http/errors";
import { assertJobsRunnable, enqueue } from "@/lib/queue";
import { assertPublicUrl } from "@/lib/http/safe-fetch";
import { getAiAdapters } from "@/adapters/ai/providers";
import { ProviderError, type AiMonitorAdapter, type EngineKey } from "@/adapters/ai/types";
import { purposeTemplates } from "@/modules/prompts/quality";
import { crawlProxyFor } from "@/lib/http/safe-fetch";
import { classifySiteError, crawlSite, normalizeDomain, liveFetcherFor, type Fetcher } from "./crawler";
import { fixtureFetcher } from "./fixture-site";
import { evaluateReadiness } from "./readiness";
import { extract } from "@/modules/monitoring/extract";
import { visibilityScore, aggregateScore } from "@/modules/monitoring/metrics";
import { scoreCommercialIntent, classifyIntentType } from "@/modules/prompts/intent";
import { PLANS, TRIAL } from "@/modules/billing/plans";
import { periodKey } from "@/modules/billing/quota";
import { demoAudit, isDemoDomain, isDemoEmail } from "@/lib/demo";
import { isCompetitorCandidate } from "./competitor-filter";
import { seedPrompts } from "@/modules/prompts/seed";
import { recentlyBrokenEngines } from "@/modules/monitoring/start";
import { candidateFacts, importProductFacts } from "@/modules/catalog/candidates";
import type { ProductFacts } from "./html";
import { buildQuestionSet, categorySuggestions, detectBusiness, homeBrandName, menuCategories, preferMenuGroups, diverseGroups, hasGiftSection, productGroups, siteBrandName, topicsFor, type AuditQuestion, type BusinessProfile, type QuestionKind, type TopicGroup } from "./business";

/**
 * Free GEO Audit (§4). Link: tahmin edilemeyen token, 7 gün TTL, noindex; full rapor varsayılan özel.
 * Abuse: domain ve fingerprint başına 30 günde 1; global günlük maliyet tavanı.
 */
export const AUDIT_TTL_DAYS = 7;
const FREE_WINDOW_DAYS = 30;
const AUDIT_PROMPTS = 5;
const AUDIT_ENGINES: EngineKey[] = ["chatgpt", "gemini"];
/**
 * Yapılandırılmışsa kapsama eklenen platformlar. Yapılandırılmamışsa ölçümü "kısmi" yapmaz; kapsam dışı ve
 * "şu anda kullanılamıyor" olarak gösterilir. Kapsam audit'in soru adımında sabitlenir (devam eden işte değişmez).
 */
const OPTIONAL_AUDIT_ENGINES: EngineKey[] = ["claude"];

/** Kredisi/anahtarı bozuk platformlar kapsamdan çıkarılır; hepsi bozuksa kapsam aynen kalır (hata görünür olsun). */
async function withoutBrokenEngines(db: PrismaClient, engines: EngineKey[]): Promise<EngineKey[]> {
  const broken = await recentlyBrokenEngines(db, engines);
  const kept = engines.filter((e) => !broken.includes(e));
  return kept.length ? kept : engines;
}

/** Ücretsiz ölçümün başlamadan önce gösterilen platform kapsamı (sunucu yapılandırmasına göre). */
export function auditEngineScope(adapters: Record<EngineKey, AiMonitorAdapter> = getAiAdapters()) {
  const usable = (e: EngineKey) => ["ready", "demo"].includes(adapters[e]?.status() ?? "");
  return { engines: [...AUDIT_ENGINES, ...OPTIONAL_AUDIT_ENGINES.filter(usable)], unavailable: OPTIONAL_AUDIT_ENGINES.filter((e) => !usable(e)) };
}

/** `adminBypass`: platform admin testi — 30 günlük ücretsiz audit kuralını atlar; günlük maliyet tavanı yine geçerlidir. */
export async function startAudit(db: PrismaClient, input: { domain: string; locale: string; fingerprint: string; adminBypass?: boolean }) {
  const cfg = config();
  assertJobsRunnable();
  let domain: string;
  try {
    domain = normalizeDomain(input.domain);
  } catch {
    throw new AppError("validation_error", "Geçerli bir alan adı girin", { fieldErrors: { domain: ["Geçersiz alan adı"] } });
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new AppError("validation_error", "Geçerli bir alan adı girin", { fieldErrors: { domain: ["Geçersiz alan adı"] } });
  const demo = demoAudit(domain, cfg);
  if (isDemoDomain(domain) && !demo) {
    throw new AppError("validation_error", "Örnek (.example) alan adları yalnız demo ortamında taranabilir", { fieldErrors: { domain: ["Gerçek bir alan adı girin"] } });
  }
  // Gerçek alan adı: herkese açık adres kontrolü (private/localhost ve yönlendirmeyle bunlara erişim engellenir).
  if (!demo) await assertPublicUrl(`https://${domain}/`);
  const since = new Date(Date.now() - FREE_WINDOW_DAYS * 86_400_000);
  const fingerprintHash = sha256(`fp:${input.fingerprint}`);
  if (!demo) {
    // Başarısız (veri üretmemiş) audit'ler ücretsiz hakkı tüketmez; sürmekte olanlar ve sonuç üretmiş olanlar tüketir.
    const recent = await db.audit.findFirst({
      where: {
        OR: [{ domain }, { fingerprintHash }],
        createdAt: { gte: since },
        AND: [
          { OR: [{ status: { in: ["queued", "running"] } }, { status: { in: ["succeeded", "partial"] }, resultSummary: { path: ["visibility", "sampleCount"], gt: 0 } }] },
          // Onaylanmadan 24 saatten uzun bekleyen ölçüm (hiç ücretli çağrı yapılmadı) hakkı tüketmez.
          { NOT: { stage: "confirm", updatedAt: { lt: new Date(Date.now() - 86_400_000) } } },
        ],
      },
    });
    if (recent && !input.adminBypass) throw new AppError("rate_limited", "Bu alan adı veya cihaz için son 30 günde ücretsiz audit yapıldı", { resetAt: new Date(recent.createdAt.getTime() + FREE_WINDOW_DAYS * 86_400_000).toISOString() });
    await assertDailyCostCap(db);
  }
  const token = randomToken(24);
  const audit = await db.audit.create({
    data: { domain, locale: input.locale, tokenHash: hashToken(token), fingerprintHash, expiresAt: new Date(Date.now() + AUDIT_TTL_DAYS * 86_400_000), progressTotal: 5 },
  });
  const startPath = (() => {
    try {
      const u = new URL(/^https?:\/\//i.test(input.domain.trim()) ? input.domain.trim() : `https://${input.domain.trim()}`);
      return u.pathname.length > 1 && u.pathname.length <= 100 ? u.pathname : undefined;
    } catch {
      return undefined;
    }
  })();
  const job = await enqueue(db, { type: "audit", operationId: `audit:${audit.id}`, payload: { auditId: audit.id, ...(startPath ? { startPath } : {}) } });
  return { token, auditId: audit.id, jobId: job.id };
}

export async function assertDailyCostCap(db: PrismaClient) {
  const since = new Date(Date.now() - 86_400_000);
  const agg = await db.costLedger.aggregate({ where: { createdAt: { gte: since } }, _sum: { costMicros: true } });
  const spentUsd = Number(agg._sum.costMicros ?? 0n) / 1_000_000;
  if (spentUsd >= config().DAILY_PROVIDER_COST_CAP_USD) {
    throw new AppError("dependency_unavailable", "Günlük sağlayıcı maliyet tavanına ulaşıldı; lütfen daha sonra deneyin", { retryable: true });
  }
}

export async function getAuditByToken(db: PrismaClient, token: string) {
  if (!token || token.length > 100) return null;
  const a = await db.audit.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!a || a.expiresAt < new Date()) return null;
  return a;
}

/** Public, sanitize edilmiş sonuç — ham yanıt/PII yok, fırsat detayları kilitli (yalnız ilk 3 özet). */
/**
 * Sağlayıcı yapılandırma/hata ayrıntısı (env adı, faturalandırma, ham mesaj) yalnız platform yöneticisine gösterilir;
 * müşteri "Şu anda kullanılamıyor" / "yanıt alınamadı" görür. Kayıtlı özet değiştirilmez.
 */
export function customerSafeSummary(summary: unknown): unknown {
  if (!summary || typeof summary !== "object") return summary;
  const s = summary as { unavailableEngines?: Array<{ engine: string; reason: string | null }>; failedCalls?: string[]; failedDetails?: unknown };
  const { failedDetails: _hidden, crawlDiagnostics: _diag, ...rest } = s as typeof s & { crawlDiagnostics?: unknown };
  void _hidden;
  void _diag;
  return {
    ...rest,
    ...(s.unavailableEngines ? { unavailableEngines: s.unavailableEngines.map((u) => ({ engine: u.engine, reason: "Şu anda kullanılamıyor" })) } : {}),
    ...(s.failedCalls ? { failedCalls: [...new Set(s.failedCalls.map((f) => `${f.split(":")[0]}:unavailable`))] } : {}),
  };
}

/** Onay/yanıt aşamasındaki ara durum (tarama ayrıntıları) istemciye gönderilmez. */
function withoutPendingWork(summary: unknown): unknown {
  if (!summary || typeof summary !== "object" || !("pendingWork" in summary)) return summary;
  const { pendingWork: _p, ...rest } = summary as Record<string, unknown>;
  void _p;
  return rest;
}

export function publicAuditView(a: NonNullable<Awaited<ReturnType<typeof getAuditByToken>>>, opts: { admin?: boolean } = {}) {
  return {
    domain: a.domain,
    status: a.status,
    stage: a.stage,
    progress: { done: a.progressDone, total: a.progressTotal },
    expiresAt: a.expiresAt.toISOString(),
    claimed: Boolean(a.claimedAt),
    result: withoutPendingWork(opts.admin ? a.resultSummary : customerSafeSummary(a.resultSummary)) ?? null,
    errorCode: a.errorCode,
  };
}

/**
 * Soru üretimi için genel kategori terimleri. Ürün kategori yollarından ("Mobilya > Mocca Katlanır Koltuk")
 * birden çok ürünün paylaştığı ortak son ek ("Katlanır Koltuk") ve üst kategoriler ("Mobilya") tercih edilir;
 * markanın kendi model adları (yalnız tek ürüne özgü) soruya taşınmaz.
 */
/** Kategori olarak kullanılamayacak gezinme/filtre etiketleri. */
const NAV_LABEL = /(kategori|liste|site ?haritası|arama)|^(tümü|tümünü gör|tüm ürünler|kampanya.*|indirim.*|fırsat.*|yeni.*|outlet|çok satan.*|blog|hakkımızda|iletişim|.* göre)$/i;

/** "Yatak Modelleri ve Fiyatları | Sleeptown" → "Yatak". */
function titleCategory(raw: string): string {
  return raw
    .split(/\s[|–—-]\s/)[0]!
    .replace(/\s+(modelleri|çeşitleri|fiyatları|ürünleri)(\s+ve\s+(fiyatları|modelleri|çeşitleri))?$/i, "")
    .trim();
}

/** Büyük/küçük harf farkı gözetmeden tekilleştirir (ilk yazım korunur), en çok 10. */
export function uniqueCategories(list: string[]): string[] {
  const seen = new Set<string>();
  return list.map((c) => c.trim()).filter((c) => {
    const k = c.toLocaleLowerCase("tr-TR");
    if (!c || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 10);
}

export function deriveCategoryTerms(pages: Array<{ pageType: string; facts: { h1: string | null; title: string | null; products: Array<{ category?: string | null }>; breadcrumbs?: string[] } }>): string[] {
  const paths = pages.flatMap((p) => p.facts.products.map((x) => x.category ?? "")).filter(Boolean).map((c) => c.split(/\s*[>/|»]\s*/).map((x) => x.trim()).filter(Boolean));
  const leaves = [...new Set(paths.map((s) => s[s.length - 1]!))];
  const tops = paths.filter((s) => s.length > 1).map((s) => s[0]!);
  const suffixCount = new Map<string, number>();
  for (const leaf of leaves) {
    const w = leaf.split(/\s+/);
    for (const n of [2, 1]) if (w.length > n) suffixCount.set(w.slice(-n).join(" "), (suffixCount.get(w.slice(-n).join(" ")) ?? 0) + 1);
  }
  const shared = [...suffixCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[0].split(" ").length - a[0].split(" ").length || b[1] - a[1]).map(([t]) => t);
  const pageCats = pages.filter((p) => p.pageType === "category").map((p) => p.facts.h1 ?? p.facts.title ?? "").filter(Boolean).map((c) => c.split("|")[0]!.trim());
  // Ürün şeması olmayan sitelerde: breadcrumb'ın ilk düzeyi ("Yatak") en güvenilir kategori ipucudur.
  const crumbCount = new Map<string, number>();
  for (const p of pages) {
    const top = (p.facts.breadcrumbs ?? []).find((c) => !NAV_LABEL.test(c));
    if (top) crumbCount.set(top, (crumbCount.get(top) ?? 0) + 1);
  }
  // Birden çok sayfada tekrar eden üst düzey (asıl kategori) varsa tekil gürültü atlanır.
  const repeated = [...crumbCount.values()].some((c) => c >= 2);
  const crumbTops = [...crumbCount.entries()].filter(([, c]) => !repeated || c >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  // "X Modelleri ve Fiyatları" kalıbındaki başlıklar kategori sayfasıdır.
  const titled = pages
    .map((p) => p.facts.title ?? "")
    .filter((t) => /(modelleri|çeşitleri|fiyatları)/i.test(t))
    .map(titleCategory)
    .filter((t) => t && !NAV_LABEL.test(t));
  // Sayfa başlıkları çoğu zaman model/koleksiyon adıdır; yalnız ürün kategori verisi yoksa kullanılır.
  const ordered = shared.length || tops.length ? [...shared, ...tops, ...crumbTops] : [...leaves, ...crumbTops, ...titled, ...pageCats];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of ordered) {
    const k = t.toLocaleLowerCase("tr-TR");
    // "Seti" gibi, zaten seçilmiş çok kelimeli bir terimin son eki olan tek kelimeler atlanır.
    if (t.length <= 2 || seen.has(k) || (!k.includes(" ") && out.some((o) => o.toLocaleLowerCase("tr-TR").endsWith(` ${k}`)))) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, 5);
}

export function auditPrompts(categories: string[], country: string): string[] {
  const place = country === "TR" ? "Türkiye'de" : "";
  if (!categories.length) {
    // Kategori tespit edilemediyse bozuk ("ürünler markaları") yerine genel ama doğal sorular.
    return [
      `${place} güvenilir online alışveriş siteleri hangileri?`,
      `${place} kaliteli ürünleri uygun fiyata nereden alabilirim?`,
      "Online alışverişte bir markanın güvenilir olduğunu nasıl anlarım?",
      `${place} hızlı kargo ve kolay iade sunan e-ticaret siteleri hangileri?`,
      "Yerli markalardan alışveriş yaparken nelere dikkat etmeliyim?",
    ].slice(0, AUDIT_PROMPTS).map((x) => x.replace(/\s+/g, " ").trim());
  }
  // Tek amaçlı kalıplar (soru kalitesi modülü); birden çok kategori varsa sırayla dağıtılır.
  return Array.from({ length: AUDIT_PROMPTS }, (_, i) => purposeTemplates(categories[i % categories.length]!, country)[i]!.text);
}

/** Kategorilerden ticari niyetli sorular: her şablon sırayla tüm kategorilere uygulanır (kategoriler dengeli dağılır). */
export function categoryPrompts(categories: string[], country: string, max: number): string[] {
  const cats = categories.map((c) => c.trim()).filter(Boolean);
  if (!cats.length) return [];
  const perCat = cats.map((c) => auditPrompts([c], country));
  const out: string[] = [];
  for (let t = 0; t < 5; t++) for (const list of perCat) if (list[t]) out.push(list[t]!);
  return out.slice(0, max);
}

type AuditAnswer = { engine: string; model: string; surface: string; prompt: string; ok: boolean; mentioned: boolean; recommended: boolean; ownCitation: boolean; citedDomains: string[]; sampledAt: string; errorCode?: string; errorDetail?: string };

/** Adımlar arası kalıcı audit ara durumu (JobRecord.cursor.step). */
export interface AuditProposal {
  business: Pick<BusinessProfile, "type" | "confidence" | "reasons" | "evidenceUrls" | "offerings" | "softwareOfferings" | "agencyWording">;
  topics: string[];
  /** Ürün grubu kanıtı (ölçüm kapsamı): grup, alan, örnek ürünler, kaynak URL'ler. */
  groups?: TopicGroup[];
  questions: AuditQuestion[];
  incomplete: string | null;
  brandName: string;
  /** Ürün grubu çıkarılamadığında kullanıcıya önerilen kategoriler (menü ve ana sayfa açıklamasından). */
  suggestions?: string[];
}

export interface AuditWork {
  crawl?: {
    readiness: ReturnType<typeof evaluateReadiness>;
    brandName: string;
    categories: string[];
    /** Ana menüdeki ürün kategorileri (hesapta soru grubu önerisi olur). */
    menuCategories?: string[];
    productCount: number;
    pages: number;
    failed: number;
    skippedByRobots: number;
    truncated: boolean;
    failures?: Array<{ url: string; reason: string }>;
    /** Yönlendirme sonrası taranan alan adı (girilenden farklıysa). */
    siteDomain?: string;
    /** www'suz adres hatalı olduğu için www adresiyle incelendi. */
    wwwFallback?: boolean;
    landedHost?: string;
    /** Tarama hedef ülke proxy'si üzerinden mi yapıldı (yönlendirme mesajı buna göre). */
    viaCountryProxy?: boolean;
    /** Site hiç okunamadıysa nedeni; bu durumda puan/fırsat/rakip üretilmez. */
    unreadable?: { kind: string; detail: string };
    /** Yönetici tanısı (süreler, başlangıç adresi). */
    diagnostics?: unknown;
    productFacts?: Array<{ pageUrl: string; facts: ProductFacts }>;
  };
  prompts?: string[];
  /** Soru → tür (keşif/ihtiyaç/bilgi); eski işlerde yok. */
  kinds?: Record<string, QuestionKind>;
  /** Tarama sonrası öneri: işletme türü + konu + 5 soru (onay ekranında gösterilir). */
  proposal?: AuditProposal;
  /** Kullanıcı soruları onayladı (ücretli çağrılar yalnız bundan sonra). */
  confirmed?: boolean;
  /** Süre bütçesi yüzünden hiç sayfa okunamayan tarama denemeleri (bir kez yeni adımda tekrarlanır). */
  crawlAttempts?: number;
  /** Bu audit'te sorulan platformlar (soru adımında sabitlenir). Eski işlerde yok → AUDIT_ENGINES. */
  engines?: EngineKey[];
  answers: AuditAnswer[];
  /** Eski işlerle uyum için (artık çift bazında `attempts` kullanılır). */
  pendingAttempts?: number;
  /** (soru × motor) çift sırasına göre deneme sayısı (zaman aşımı/geçici hata). */
  attempts?: Record<number, number>;
  /** Aynı sorunun platformları paralel sorulur; sırası gelmeden biten yanıtlar burada bekler. */
  ready?: Record<number, AuditAnswer>;
}

const AUDIT_CALL_ATTEMPTS = 2;
/** Adım modunda tarama adımına adım bütçesinin üstüne tanınan ek süre. */
const AUDIT_CRAWL_EXTRA_MS = 25_000;

/**
 * Audit işi: tarama → sorular → AI yanıtları → özet. Aşamalar gerçek ilerleme olarak yazılır; kısmi sonuç korunur.
 * Worker'da tek seferde biter. Adım modunda (`deadline`) bütçe dolunca ara durum `save` ile saklanır ve
 * "continue" döner; sonraki adım `load` ile kaldığı yerden devam eder (tamamlanan çağrılar tekrarlanmaz).
 */
export async function runAudit(
  db: PrismaClient,
  auditId: string,
  deps: { fetcher?: Fetcher; adapters?: Record<EngineKey, AiMonitorAdapter> } = {},
  opts: { deadline?: number; callTimeoutMs?: number; crawlMaxPages?: number; startPath?: string; requireConfirmation?: boolean; load?: () => AuditWork | null; save?: (w: AuditWork) => Promise<void> } = {},
): Promise<"done" | "continue"> {
  const cfg = config();
  const audit = await db.audit.findUniqueOrThrow({ where: { id: auditId } });
  if (audit.status === "succeeded" || audit.status === "partial" || audit.status === "failed") return "done";
  const demo = demoAudit(audit.domain, cfg);
  const fetcher = deps.fetcher ?? (demo ? fixtureFetcher : liveFetcherFor(audit.locale.split("-")[1] ?? "TR"));
  const adapters = deps.adapters ?? getAiAdapters(cfg, { demo });
  const stage = (s: string, done: number) => db.audit.update({ where: { id: auditId }, data: { stage: s, progressDone: done, status: "running" } });
  const overBudget = () => opts.deadline !== undefined && Date.now() > opts.deadline;
  // Onaydan sonra başlayan yanıt işi, onay ekranında saklanan ara durumdan devam eder (tarama tekrarlanmaz).
  const pending = (audit.resultSummary as { phase?: string; pendingWork?: AuditWork } | null)?.phase === "answers" ? (audit.resultSummary as { pendingWork?: AuditWork }).pendingWork : undefined;
  const work: AuditWork = opts.load?.() ?? (pending ? structuredClone(pending) : null) ?? { answers: [] };
  const save = async () => opts.save?.(work);

  if (!work.crawl) {
    await stage("crawling", 1);
    // Adım modunda tarama kendi adımıdır ve AI çağrısı yapmadığı için bütçesi daha geniştir (yavaş site veya ülke
    // proxy'si): advance rotasının süre sınırı (maxDuration 120 sn) içinde kalır.
    const crawlDeadline = opts.deadline !== undefined ? opts.deadline + AUDIT_CRAWL_EXTRA_MS : undefined;
    const crawl = await crawlSite({ domain: audit.domain, startPath: opts.startPath, maxPages: opts.crawlMaxPages ?? PLANS.free_audit.limits.crawlUrls, fetcher, delayMs: demo ? 0 : 250, deadline: crawlDeadline });
    log.info("audit.crawl", { auditId, pages: crawl.pages.length, failed: crawl.failed.length, truncated: crawl.truncated, homeError: crawl.homeError?.kind ?? null, ...(crawl.diagnostics ?? {}) });
    // Süre bütçesi sayfa okunmadan bittiyse (yavaş sunucu/sitemap) bir kez yeni adımda tekrar denenir; site
    // "okunamadı" sayılmaz.
    if (crawl.pages.length === 0 && !crawl.homeError && crawl.truncated && (work.crawlAttempts ?? 0) < 1) {
      work.crawlAttempts = (work.crawlAttempts ?? 0) + 1;
      await save();
      return "continue";
    }
    const home = crawl.pages.find((p) => p.pageType === "home");
    const business = detectBusiness(crawl.pages, crawl.domain);
    const brandForQuestions = siteBrandName(crawl.pages, crawl.domain);
    const lang = (audit.locale.split("-")[0] ?? "tr").toLowerCase();
    // Kanıtlı ürün grupları (alan → grup → alt tür); yoksa doğrulanmış konu adları.
    // Ana menüdeki kategoriler öne alınır: küçük tarama örnekleminde ikincil ürünler asıl işin önüne geçmesin.
    const menu = menuCategories(crawl.pages, lang, 8, brandForQuestions);
    const groups = ["service", "saas", "service_saas"].includes(business.type) ? [] : diverseGroups(preferMenuGroups(productGroups(crawl.pages, lang), menu), 2);
    const topics = groups.length ? groups.map((g) => g.label) : topicsFor(business, crawl.pages, deriveCategoryTerms(crawl.pages), lang);
    const set = buildQuestionSet(business, topics, { country: audit.locale.split("-")[1] ?? "TR", brandName: brandForQuestions, groups, gift: hasGiftSection(crawl.pages) });
    work.proposal = { business: { type: business.type, confidence: business.confidence, reasons: business.reasons, evidenceUrls: business.evidenceUrls.slice(0, 3), offerings: business.offerings, softwareOfferings: business.softwareOfferings, agencyWording: business.agencyWording }, topics: set.topics, groups, questions: set.questions, incomplete: set.incomplete, brandName: brandForQuestions, suggestions: set.questions.length ? [] : categorySuggestions(crawl.pages, menu, brandForQuestions) };
    work.crawl = {
      readiness: evaluateReadiness(crawl),
      brandName: homeBrandName(home, audit.domain),
      categories: deriveCategoryTerms(crawl.pages),
      menuCategories: menu,
      productCount: new Set(crawl.pages.flatMap((p) => p.facts.products.map((x) => x.sku ?? x.name))).size,
      pages: crawl.pages.length,
      failed: crawl.failed.length,
      skippedByRobots: crawl.skippedByRobots,
      truncated: crawl.truncated,
      failures: crawl.failed.slice(0, 3),
      ...(crawl.redirectedFrom ? { siteDomain: crawl.domain } : {}),
      ...(crawl.wwwFallback ? { wwwFallback: true } : {}),
      ...(crawl.landedHost ? { landedHost: crawl.landedHost, viaCountryProxy: Boolean(!deps.fetcher && crawlProxyFor(audit.locale.split("-")[1] ?? "TR")) } : {}),
      diagnostics: crawl.diagnostics ?? null,
      // Hesaba kaydedilince kataloğa aktarılmak üzere taramada bulunan ürünler (yalnız ürün sayfaları; en çok 30).
      productFacts: crawl.pages.flatMap((p) => {
        const f = candidateFacts(p.pageType, p.facts.products);
        return f ? [{ pageUrl: p.url, facts: f }] : [];
      }).slice(0, 30),
      ...(crawl.pages.length === 0
        ? { unreadable: crawl.homeError ?? (crawl.robotsDisallowAll || (crawl.failed.length === 0 && crawl.skippedByRobots > 0) ? { kind: "robots", detail: crawl.robotsDisallowAll ? "robots.txt tüm siteyi kapatıyor" : `robots.txt kuralları incelenecek ${crawl.skippedByRobots} sayfanın hepsini kapatıyor` } : { kind: crawl.failed[0] ? classifySiteError(crawl.failed[0].reason) : crawl.truncated ? "incomplete" : "network", detail: crawl.failed[0]?.reason ?? (crawl.truncated ? "Süre sınırında hiç sayfa okunamadı" : "Sayfa alınamadı") }) }
        : {}),
    };
    await save();
    // Adım modunda tarama adımı burada biter; sorular ve AI çağrıları sonraki adımlarda.
    if (opts.deadline !== undefined) return "continue";
  }
  const { brandName, categories } = work.crawl;
  // Site okunamadıysa genel sorularla ölçüm yapılmaz: puan, fırsat ve rakip adayı anlamsız olur (ve ücretli çağrı harcanır).
  if (work.crawl.unreadable) {
    await db.audit.update({
      where: { id: auditId },
      data: {
        status: "failed",
        errorCode: "site_unreachable",
        stage: "done",
        progressDone: 5,
        resultSummary: {
          brandName,
          demo,
          siteUnreadable: { ...work.crawl.unreadable, wwwTried: true },
          readiness: { geoScore: null, adsScore: null, checks: [] },
          crawl: { pages: 0, failed: work.crawl.failed, skippedByRobots: work.crawl.skippedByRobots, products: 0, categories: [], truncated: false, failures: work.crawl.failures ?? [] },
          prompts: [],
        },
      },
    });
    return "done";
  }

  const country = audit.locale.split("-")[1] ?? "TR";
  const language = audit.locale.split("-")[0] ?? "tr";
  if (!work.prompts) {
    await stage("prompts", 2);
    const scopeNow = auditEngineScope(adapters);
    // Siteden kanıtlı soru seti çıkmadıysa (ör. az sayfa okunabildi) rapor boş bitmez: kullanıcı kategorisini
    // yazar, sorular oluşturulur ve onayıyla ölçüm sürer.
    const needsTopic = Boolean(work.proposal && work.proposal.questions.length === 0);
    if ((opts.requireConfirmation || needsTopic) && !work.confirmed) {
      // Ücretli çağrılardan önce tür, konular, sorular ve platformlar kullanıcıya gösterilir; onay gelene kadar
      // AI platformlarına soru sorulmaz. Ara durum audit kaydında saklanır (yeni iş taramayı tekrarlamaz).
      await save();
      await db.audit.update({
        where: { id: auditId },
        data: {
          status: "running",
          stage: "confirm",
          progressDone: 2,
          resultSummary: { phase: "confirm", brandName, demo, proposal: (work.proposal ?? null) as unknown as object, scopeEngines: scopeNow.engines, unavailableEngines: scopeNow.unavailable.map((e) => ({ engine: e, reason: adapters[e]?.statusReason() ?? null })), crawl: { pages: work.crawl.pages, products: work.crawl.productCount }, pendingWork: work as unknown as object },
        },
      });
      return "done";
    }
    const proposed = work.proposal?.questions ?? [];
    if (!proposed.length && work.proposal) {
      // Kanıtlı kapsam oluşturulamadı: genel sorularla puan uydurulmaz; site kontrolleri sunulur, AI çağrısı yapılmaz.
      await db.audit.update({
        where: { id: auditId },
        data: {
          status: "partial",
          stage: "done",
          progressDone: 5,
          resultSummary: {
            brandName,
            demo,
            scopeUnavailable: work.proposal.incomplete ?? "Ölçülecek ürün grubu veya hizmet doğrulanamadı.",
            displayName: work.proposal.brandName,
            business: { type: work.proposal.business.type, confidence: work.proposal.business.confidence, reasons: work.proposal.business.reasons, topics: [] },
            visibility: { score: null, smallSample: true, sampleCount: 0, scheduled: 0, partial: true, missingEngines: [] },
            engines: [],
            unavailableEngines: [],
            scopeEngines: [],
            provenance: { models: [], surface: "api_grounded", country, language, sampledAt: new Date().toISOString(), sampleCount: 0 },
            readiness: { geoScore: work.crawl.readiness.geoScore, adsScore: work.crawl.readiness.adsScore, checks: work.crawl.readiness.checks as unknown as object[] },
            crawl: { pages: work.crawl.pages, failed: work.crawl.failed, skippedByRobots: work.crawl.skippedByRobots, products: work.crawl.productCount, categories, menuCategories: work.crawl.menuCategories ?? [], truncated: work.crawl.truncated, failures: work.crawl.failures ?? [], siteDomain: work.crawl.siteDomain ?? null, wwwFallback: work.crawl.wwwFallback ?? false, landedHost: work.crawl.landedHost ?? null, viaCountryProxy: work.crawl.viaCountryProxy ?? false, productFacts: (work.crawl.productFacts ?? []) as unknown as object[] },
            competitorCandidates: [],
            opportunityCount: 0,
            opportunityAnalyzed: false,
            examples: [],
            prompts: [],
            questions: [],
          },
        },
      });
      return "done";
    }
    work.prompts = proposed.length ? proposed.map((q) => q.text) : auditPrompts(categories, country);
    work.kinds = Object.fromEntries(proposed.map((q) => [q.text, q.kind]));
    work.engines = await withoutBrokenEngines(db, scopeNow.engines);
    await save();
  }
  const prompts = work.prompts;

  await stage("asking_engines", 3);
  const scope = work.engines ?? AUDIT_ENGINES;
  const available = scope.map((e) => adapters[e]).filter((a) => a.status() === "ready" || a.status() === "demo");
  const unavailable = scope.filter((e) => !available.some((a) => a.engine === e)).map((e) => ({ engine: e, reason: adapters[e]?.statusReason() ?? null }));
  // Kapsam dışı kalan isteğe bağlı platformlar: yalnız bilgi (kısmi sayılmaz, skora girmez).
  // Kredisi biten (geçici olarak dışarıda tutulan) zorunlu platformlar da bu gruptadır: ölçümü "kısmi" yapmaz.
  const outOfScope = [...AUDIT_ENGINES, ...OPTIONAL_AUDIT_ENGINES].filter((e) => !scope.includes(e)).map((e) => ({ engine: e, reason: adapters[e]?.statusReason() ?? "Şu anda kullanılamıyor" }));
  const siteDomain = work.crawl.siteDomain ?? audit.domain;
  const entity = { id: "self", type: "brand" as const, name: brandName, aliases: [], domain: siteDomain };
  const pairs = prompts.flatMap((prompt) => available.map((a) => ({ prompt, a })));
  // Aynı sorunun platformları paralel sorulur (adım süresi ≈ en yavaş platform); sonuçlar çift sırasıyla eklenir.
  const ready = (work.ready ??= {});
  const attempts = (work.attempts ??= {});
  const failRow = (i: number, errorCode: string, errorDetail?: string): AuditAnswer => {
    const { prompt, a } = pairs[i]!;
    return { engine: a.engine, model: "", surface: a.surface, prompt, ok: false, mentioned: false, recommended: false, ownCitation: false, citedDomains: [], sampledAt: new Date().toISOString(), errorCode, ...(errorDetail ? { errorDetail } : {}) };
  };
  const callOne = async (i: number): Promise<AuditAnswer | null> => {
    const { prompt, a } = pairs[i]!;
    // Aynı platformda kalıcı hata (anahtar/model) alındıysa tekrar çağrılmaz.
    const permanent = work.answers.find((x) => x.engine === a.engine && !x.ok && ["auth", "not_configured", "http_400", "http_404", "insufficient_quota", "search_unavailable"].includes(x.errorCode ?? ""));
    if (permanent) return failRow(i, permanent.errorCode!);
    try {
      const ans = await a.ask({ prompt, country, language, signal: opts.callTimeoutMs ? AbortSignal.timeout(opts.callTimeoutMs) : undefined });
      await db.costLedger.create({ data: { workspaceId: null, provider: ans.provider, model: ans.model, operation: "audit", attemptId: `audit:${auditId}:${a.engine}:${sha256(prompt).slice(0, 8)}:${Date.now()}`, costMicros: ans.costMicros ?? 0n, succeeded: true } });
      const ex = extract(ans.text, ans.urls, [entity]);
      const m = ex.mentions.find((x) => x.entityId === "self" && x.kind !== "negative" && !x.needsReview);
      return {
        engine: a.engine, model: ans.model, surface: ans.surface, prompt, ok: true, mentioned: Boolean(m), recommended: m?.kind === "recommendation",
        ownCitation: ex.citations.some((c) => c.association === "own"), citedDomains: ex.citations.filter((c) => c.association !== "own").map((c) => c.domain), sampledAt: new Date().toISOString(),
      };
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      const n = (attempts[i] ?? 0) + 1;
      if (pe?.retryable && n < AUDIT_CALL_ATTEMPTS) {
        // Geçici hata/zaman aşımı: aynı çift bir kez daha denenir (bir sonraki döngü veya adım).
        attempts[i] = n;
        return null;
      }
      return failRow(i, pe?.code ?? "error", ((e as Error).message ?? "").slice(0, 240));
    }
  };
  const perPrompt = Math.max(1, available.length);
  while (work.answers.length < pairs.length) {
    if (overBudget()) {
      await save();
      return "continue";
    }
    const first = Math.floor(work.answers.length / perPrompt) * perPrompt;
    const batch = Array.from({ length: Math.min(perPrompt, pairs.length - first) }, (_, k) => first + k).filter((i) => i >= work.answers.length && !ready[i]);
    const results = await Promise.all(batch.map(callOne));
    batch.forEach((i, k) => {
      if (results[k]) ready[i] = results[k]!;
    });
    while (ready[work.answers.length]) {
      const i = work.answers.length;
      work.answers.push(ready[i]!);
      delete ready[i];
      delete attempts[i];
    }
    await save();
  }
  const answers = work.answers;

  await stage("summarizing", 4);
  const perEngine = available.map((a) => {
    const list = answers.filter((x) => x.engine === a.engine);
    return visibilityScore(list.map((x) => ({ engine: x.engine, surface: "api_grounded", valid: x.ok, weight: 1, mentioned: x.mentioned, recommended: x.recommended, ownCitation: x.ownCitation, supportsCitations: true })), prompts.length);
  });
  const agg = aggregateScore(perEngine);
  const domainCounts = new Map<string, number>();
  // Kamu/eğitim, haber/medya, sosyal ağ ve pazaryeri alan adları kaynak olarak kalır, rakip önerilmez.
  for (const x of answers) for (const d of new Set(x.citedDomains)) if (isCompetitorCandidate(d, audit.domain) && isCompetitorCandidate(d, siteDomain)) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  const competitorCandidates = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([domain, count]) => ({ domain, observations: count }));
  const kindOf = (prompt: string): QuestionKind | null => work.kinds?.[prompt] ?? null;
  // Fırsat sinyali: keşif/ihtiyaç sorusunda (bilgi sorusu değil) geçerli yanıt var, marka anılmadı ve ticari bir
  // rakip adayı kaynak gösterildi. Yalnız başka alan adı atfı veya marka yokluğu tek başına yeterli değildir.
  const lost = answers.filter((x) => x.ok && !x.mentioned && kindOf(x.prompt) !== "info" && x.citedDomains.some((d) => isCompetitorCandidate(d, audit.domain) && isCompetitorCandidate(d, siteDomain)));
  const opportunityCount = new Set(lost.map((x) => x.prompt)).size;
  // Örnekler soru başına birleştirilir (aynı soru farklı platformlarda tekrar listelenmez).
  const byPrompt = new Map<string, { engines: string[]; domains: string[] }>();
  for (const x of lost) {
    const cur = byPrompt.get(x.prompt) ?? { engines: [], domains: [] };
    if (!cur.engines.includes(x.engine)) cur.engines.push(x.engine);
    for (const d of x.citedDomains) if (!cur.domains.includes(d) && isCompetitorCandidate(d, audit.domain)) cur.domains.push(d);
    byPrompt.set(x.prompt, cur);
  }
  const examples = [...byPrompt.entries()].slice(0, 3).map(([prompt, v]) => ({ prompt, engine: v.engines[0]!, engines: v.engines, competitorDomains: v.domains.slice(0, 4), intentScore: scoreCommercialIntent(prompt, categories).total, intentType: classifyIntentType(prompt) }));
  // Soru türüne göre ayrı sonuç: keşif/ihtiyaç ile bilgi soruları aynı beklentiyle okunmaz.
  const kindStats = Object.fromEntries((["discovery", "need", "info"] as const).map((k) => {
    const list = answers.filter((x) => x.ok && kindOf(x.prompt) === k);
    return [k, { answers: list.length, mentioned: list.filter((x) => x.mentioned).length, ownCitation: list.filter((x) => x.ownCitation).length }];
  }));
  const models = [...new Set(answers.filter((x) => x.ok).map((x) => `${x.engine}:${x.model}`))];
  const okCount = answers.filter((x) => x.ok).length;
  const failedErrors = [...new Set(answers.filter((x) => !x.ok).map((x) => `${x.engine}:${x.errorCode ?? "error"}`))];
  // Platform başına ilk sağlayıcı hata mesajı (tanı için; anahtar içermez).
  const failedDetails = Object.fromEntries(available.map((a) => [a.engine, answers.find((x) => x.engine === a.engine && !x.ok && x.errorDetail)?.errorDetail]).filter(([, d]) => d));
  const partial = unavailable.length > 0 || okCount < prompts.length * scope.length || work.crawl.failed > 0 || work.crawl.truncated;

  await db.audit.update({
    where: { id: auditId },
    data: {
      status: okCount === 0 && work.crawl.pages === 0 ? "failed" : partial ? "partial" : "succeeded",
      errorCode: okCount === 0 && work.crawl.pages === 0 ? "no_data" : null,
      stage: "done",
      progressDone: 5,
      resultSummary: {
        brandName,
        demo,
        visibility: { score: agg.score, smallSample: true, sampleCount: okCount, scheduled: prompts.length * scope.length, partial: agg.partial, missingEngines: [...agg.missingEngines, ...unavailable.map((u) => u.engine)] },
        engines: perEngine.map((e) => ({ engine: e.engine, score: e.score, coverage: e.coverage })),
        unavailableEngines: [...unavailable, ...outOfScope],
        scopeEngines: scope,
        failedCalls: failedErrors,
        failedDetails,
        provenance: { models, surface: "api_grounded", country, language, sampledAt: new Date().toISOString(), sampleCount: okCount },
        readiness: { geoScore: work.crawl.readiness.geoScore, adsScore: work.crawl.readiness.adsScore, checks: work.crawl.readiness.checks as unknown as object[] },
        crawl: { pages: work.crawl.pages, failed: work.crawl.failed, skippedByRobots: work.crawl.skippedByRobots, products: work.crawl.productCount, categories, menuCategories: work.crawl.menuCategories ?? [], truncated: work.crawl.truncated, failures: work.crawl.failures ?? [], siteDomain: work.crawl.siteDomain ?? null, wwwFallback: work.crawl.wwwFallback ?? false, landedHost: work.crawl.landedHost ?? null, viaCountryProxy: work.crawl.viaCountryProxy ?? false, productFacts: (work.crawl.productFacts ?? []) as unknown as object[] },
        competitorCandidates,
        opportunityCount,
        opportunityAnalyzed: answers.some((x) => x.ok && kindOf(x.prompt) !== "info"),
        examples,
        prompts,
        questions: prompts.map((text) => ({ text, kind: kindOf(text), topic: work.proposal?.questions.find((q) => q.text === text)?.topic ?? null })),
        groups: (work.proposal?.groups ?? []) as unknown as object[],
        displayName: work.proposal?.brandName ?? null,
        // Anılma, önerilme ve kendi sayfanın kaynak gösterilmesi ayrı sayılır (geçerli yanıtlar üzerinden).
        counts: { answers: okCount, mentioned: answers.filter((x) => x.ok && x.mentioned).length, recommended: answers.filter((x) => x.ok && x.recommended).length, ownCitation: answers.filter((x) => x.ok && x.ownCitation).length },
        kindStats,
        business: work.proposal ? { type: work.proposal.business.type, confidence: work.proposal.business.confidence, reasons: work.proposal.business.reasons, topics: work.proposal.topics } : null,
        crawlDiagnostics: work.crawl.diagnostics ?? null,
      },
    },
  });
  return "done";
}

/**
 * Claim: login sonrası tek kullanımlık, atomik. Domain eşleşmesi tek başına sahiplik sayılmaz
 * (brand verifiedAt null kalır; yazma/tracking için ayrı doğrulama gerekir).
 * Trial hesap başına tek: kullanıcı daha önce bir trial başlattıysa yeni trial açılmaz.
 */
export async function claimAudit(db: PrismaClient, token: string, userId: string) {
  const audit = await getAuditByToken(db, token);
  if (!audit) throw new AppError("not_found", "Audit bulunamadı veya süresi doldu");
  if (audit.status !== "succeeded" && audit.status !== "partial") throw new AppError("conflict", "Audit henüz tamamlanmadı", { retryable: true });
  // Demo hesapları yalnız örnek alan adını, ayrı etiketli demo workspace'e kaydedebilir; gerçek hesaplar örnek alan adını kaydedemez.
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  const demoUser = isDemoEmail(user.email);
  if (demoUser !== isDemoDomain(audit.domain)) {
    throw new AppError("forbidden", demoUser ? "Demo hesabı gerçek bir alan adını kaydedemez" : "Örnek (.example) audit gerçek hesaba kaydedilemez");
  }
  const out = await db.$transaction(async (tx) => {
    const consumed = await tx.audit.updateMany({ where: { id: audit.id, claimedAt: null }, data: { claimedAt: new Date(), claimUserId: userId } });
    if (consumed.count === 0) throw new AppError("conflict", "Bu audit zaten sahiplenildi");
    const summary = (audit.resultSummary ?? {}) as { brandName?: string; prompts?: string[]; questions?: Array<{ text: string; topic?: string | null }>; business?: { topics?: string[] } | null; crawl?: { categories?: string[]; menuCategories?: string[] }; competitorCandidates?: Array<{ domain: string }> };
    // Raporda ölçülen ürün grupları hesapta kategori olur; sorular aynı gruplara bağlanır (isim tahmini yok).
    const reportTopics = (summary.business?.topics ?? []).filter(Boolean);
    const existingTrial = await tx.membership.findFirst({ where: { userId, role: "owner", workspace: { subscription: { isNot: null } } } });
    const slugBase = audit.domain.replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const ws = await tx.workspace.create({
      data: { name: summary.brandName ?? audit.domain, slug: `${slugBase}-${randomToken(4).toLowerCase()}`, ownerId: userId, isDemo: demoUser, memberships: { create: { userId, role: "owner", isApprover: true } } },
    });
    const now = new Date();
    if (!existingTrial) {
      const end = new Date(now.getTime() + TRIAL.days * 86_400_000);
      await tx.subscription.create({ data: { workspaceId: ws.id, planKey: "starter", status: "trialing", currentPeriodStart: now, currentPeriodEnd: end, trialEnd: end } });
    }
    const brand = await tx.brand.create({
      // Ölçülen gruplar önce; ardından ana menü kategorileri (soru seçiminde ayrı grup olarak önerilir, soru eklenmez).
      data: { workspaceId: ws.id, domain: audit.domain, name: summary.brandName ?? audit.domain, categories: uniqueCategories([...(reportTopics.length ? reportTopics : (summary.crawl?.categories ?? [])), ...(summary.crawl?.menuCategories ?? [])]), onboarding: { step: 2, fromAuditId: audit.id } },
    });
    await tx.audit.update({ where: { id: audit.id }, data: { workspaceId: ws.id } });
    // Analizdeki sorular + kategorilerden üretilenler aktif prompt olarak eklenir; ilk ölçüm hemen başlatılabilir.
    const country = audit.locale.split("-")[1] ?? "TR";
    const categories = reportTopics.length ? reportTopics : (summary.crawl?.categories ?? []);
    const promptLimit = existingTrial ? PLANS.free_audit.limits.activePrompts : TRIAL.activePrompts;
    await seedPrompts(tx, {
      workspaceId: ws.id,
      brandId: brand.id,
      brandName: brand.name,
      locale: audit.locale,
      source: "audit",
      activeLimit: promptLimit,
      texts: summary.questions?.some((q) => q.topic)
        ? summary.questions.map((q) => ({ text: q.text, category: q.topic ?? undefined }))
        : [...(summary.prompts ?? []).map((text) => ({ text, category: categories.find((c) => text.toLocaleLowerCase("tr-TR").includes(c.toLocaleLowerCase("tr-TR"))) })), ...categoryPrompts(categories, country, promptLimit).map((text) => ({ text, category: categories.find((c) => text.toLocaleLowerCase("tr-TR").includes(c.toLocaleLowerCase("tr-TR"))) }))],
    });
    // Eski raporlardaki adaylar da aynı filtreden geçer.
    for (const c of (summary.competitorCandidates ?? []).filter((c) => isCompetitorCandidate(c.domain, audit.domain)).slice(0, PLANS.starter.limits.competitorsPerBrand)) {
      await tx.competitor.create({ data: { workspaceId: ws.id, brandId: brand.id, name: c.domain.split(".")[0]!.replace(/^./, (x) => x.toLocaleUpperCase("tr-TR")), domain: c.domain, source: "domain_finding" } });
    }
    await tx.auditLog.create({ data: { workspaceId: ws.id, actorId: userId, actorType: "user", scope: "audit", action: "audit.claimed", target: audit.id } });
    return { workspaceId: ws.id, brandId: brand.id, trialStarted: !existingTrial, period: periodKey(now) };
  });
  // Ücretsiz ölçüm taramasında bulunan, bilgisi tam ürünler kataloğa otomatik eklenir (eksikler eklenmez).
  const facts = ((audit.resultSummary as { crawl?: { productFacts?: Array<{ pageUrl: string; facts: ProductFacts }> } } | null)?.crawl?.productFacts ?? []);
  if (facts.length) {
    await importProductFacts(db, { workspaceId: out.workspaceId, brandId: out.brandId }, facts, { catalogLimit: PLANS.starter.limits.catalogProducts }).catch((e) => log.warn("audit.claim_import_failed", { auditId: audit.id, error: (e as Error).message }));
  }
  return out;
}

const INFO_Q = /(nelere dikkat|farkları|farklar|nedir|nasıl|neden|ne işe yarar)/i;
const DISCOVERY_Q = /(nereden|mağaza|online|hangi.*(marka|firma|ajans|yazılım|site|mağaza)|önerir|karşılaştır)/i;

/** Kullanıcının düzenlediği sorunun türü (öneriyle aynıysa önerinin türü korunur). */
export function questionKind(text: string): QuestionKind {
  if (INFO_Q.test(text)) return "info";
  if (DISCOVERY_Q.test(text)) return "discovery";
  return "need";
}

/** Düzenlenen soru için kalite sorunları (boşsa uygun). Marka adı içeren soru genel keşif ölçümüne girmez. */
export function questionIssues(text: string, brandName: string): string[] {
  const t = text.trim();
  const issues: string[] = [];
  if (t.length < 10) issues.push("Soru çok kısa");
  if (t.length > 200) issues.push("Soru çok uzun (en çok 200 karakter)");
  if (/https?:\/\/|www\./i.test(t)) issues.push("Soruda bağlantı olmamalı");
  const b = brandName.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9ğüşöçı]/g, "");
  const n = t.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9ğüşöçı]/g, "");
  if (b.length >= 3 && n.includes(b)) issues.push("Marka adınızı içeren sorular genel keşif ölçümüne girmez; markasız yazın");
  if (!/[?？]$/.test(t)) issues.push("Soru işaretiyle bitmeli");
  return issues;
}

type ConfirmSummary = { phase?: string; proposal?: AuditProposal; pendingWork?: AuditWork; brandName?: string; demo?: boolean };

/** Onay ekranı: tür veya konu değişince yeni soru seti (ücretli çağrı yok). */
export function previewAuditQuestions(audit: { locale: string; resultSummary: unknown }, input: { businessType?: BusinessProfile["type"]; topics?: string[] }) {
  const sum = audit.resultSummary as ConfirmSummary | null;
  if (sum?.phase !== "confirm" || !sum.proposal) throw new AppError("conflict", "Bu ölçüm soru onayı aşamasında değil");
  const p = sum.proposal;
  const type = input.businessType ?? p.business.type;
  const topics = (input.topics ?? p.topics).map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 40).slice(0, 2);
  const service = ["service", "saas", "service_saas"].includes(type);
  const set = buildQuestionSet({ ...p.business, type, offerings: service ? topics : p.business.offerings }, topics, { country: audit.locale.split("-")[1] ?? "TR", brandName: p.brandName });
  return { ...set, businessType: type, questions: set.questions.map((q) => ({ ...q, issues: questionIssues(q.text, p.brandName) })) };
}

/**
 * Soru onayı: düzenlenmiş en çok 5 soru doğrulanır, ara duruma yazılır ve yanıt işi kuyruğa alınır. Aynı onay
 * tekrar gönderilirse yeni iş/çağrı oluşmaz (operationId sabit).
 */
export async function confirmAudit(db: PrismaClient, auditId: string, input: { questions: string[]; businessType?: BusinessProfile["type"]; topics?: string[] }) {
  const audit = await db.audit.findUniqueOrThrow({ where: { id: auditId } });
  const sum = audit.resultSummary as ConfirmSummary | null;
  const operationId = `audit:${auditId}:answers`;
  if (sum?.phase === "answers" || audit.stage !== "confirm") {
    const existing = await db.jobRecord.findUnique({ where: { operationId } });
    if (existing) return { jobId: existing.id, alreadyConfirmed: true };
    throw new AppError("conflict", "Bu ölçüm soru onayı aşamasında değil");
  }
  if (!sum?.pendingWork || !sum.proposal) throw new AppError("conflict", "Ölçüm ara durumu bulunamadı; yeniden başlatın");
  const seen = new Set<string>();
  const questions = input.questions.map((q) => q.replace(/\s+/g, " ").trim()).filter((q) => {
    const k = q.toLocaleLowerCase("tr-TR");
    if (!q || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (questions.length === 0 || questions.length > AUDIT_PROMPTS) throw new AppError("validation_error", `1–${AUDIT_PROMPTS} soru seçin`);
  const bad = questions.map((q) => ({ q, issues: questionIssues(q, sum.proposal!.brandName) })).filter((x) => x.issues.length);
  if (bad.length) throw new AppError("validation_error", `Düzenlenmesi gereken soru: “${bad[0]!.q}” — ${bad[0]!.issues[0]}`);
  const proposedKinds = new Map(sum.proposal.questions.map((q) => [q.text, q.kind]));
  const cfg = config();
  const demo = demoAudit(audit.domain, cfg);
  const work: AuditWork = { ...sum.pendingWork, prompts: questions, kinds: Object.fromEntries(questions.map((q) => [q, proposedKinds.get(q) ?? questionKind(q)])), engines: await withoutBrokenEngines(db, auditEngineScope(getAiAdapters(cfg, { demo })).engines), confirmed: true, answers: [] };
  // Kullanıcının onay ekranında girdiği konular raporda gösterilir (öneriyle farklıysa).
  const topics = (input.topics ?? []).map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 40).slice(0, 2);
  if (topics.length && work.proposal) work.proposal = { ...work.proposal, topics };
  if (input.businessType && work.proposal) work.proposal = { ...work.proposal, business: { ...work.proposal.business, type: input.businessType, confidence: "high", reasons: [...work.proposal.business.reasons, "Tür kullanıcı tarafından onaylandı"] } };
  const job = await enqueue(db, { type: "audit", operationId, payload: { auditId, phase: "answers" } });
  await db.audit.update({ where: { id: auditId }, data: { stage: "asking_engines", status: "running", progressDone: 3, resultSummary: { phase: "answers", brandName: sum.brandName ?? null, demo: sum.demo ?? false, proposal: (work.proposal ?? null) as unknown as object, pendingWork: work as unknown as object } } });
  return { jobId: job.id, alreadyConfirmed: false };
}

/** Audit'in güncel işi: onaydan sonra yanıt işi, önce tarama işi. */
export async function currentAuditJob(db: PrismaClient, auditId: string) {
  return (await db.jobRecord.findUnique({ where: { operationId: `audit:${auditId}:answers` }, select: { id: true } })) ?? db.jobRecord.findUnique({ where: { operationId: `audit:${auditId}` }, select: { id: true } });
}
