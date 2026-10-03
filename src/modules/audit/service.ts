import type { PrismaClient } from "@/generated/prisma/client";
import { config } from "@/lib/config";
import { hashToken, randomToken, sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/http/errors";
import { assertJobsRunnable, enqueue } from "@/lib/queue";
import { assertPublicUrl } from "@/lib/http/safe-fetch";
import { getAiAdapters } from "@/adapters/ai/providers";
import { ProviderError, type AiMonitorAdapter, type EngineKey } from "@/adapters/ai/types";
import { crawlSite, normalizeDomain, liveFetcher, type Fetcher } from "./crawler";
import { fixtureFetcher } from "./fixture-site";
import { evaluateReadiness } from "./readiness";
import { extract } from "@/modules/monitoring/extract";
import { visibilityScore, aggregateScore } from "@/modules/monitoring/metrics";
import { scoreCommercialIntent, classifyIntentType } from "@/modules/prompts/intent";
import { PLANS, TRIAL } from "@/modules/billing/plans";
import { periodKey } from "@/modules/billing/quota";
import { demoAudit, isDemoDomain, isDemoEmail } from "@/lib/demo";

/**
 * Free GEO Audit (§4). Link: tahmin edilemeyen token, 7 gün TTL, noindex; full rapor varsayılan özel.
 * Abuse: domain ve fingerprint başına 30 günde 1; global günlük maliyet tavanı.
 */
export const AUDIT_TTL_DAYS = 7;
const FREE_WINDOW_DAYS = 30;
const AUDIT_PROMPTS = 5;
const AUDIT_ENGINES: EngineKey[] = ["chatgpt", "gemini"];

export async function startAudit(db: PrismaClient, input: { domain: string; locale: string; fingerprint: string }) {
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
        AND: [{ OR: [{ status: { in: ["queued", "running"] } }, { status: { in: ["succeeded", "partial"] }, resultSummary: { path: ["visibility", "sampleCount"], gt: 0 } }] }],
      },
    });
    if (recent) throw new AppError("rate_limited", "Bu alan adı veya cihaz için son 30 günde ücretsiz audit yapıldı", { resetAt: new Date(recent.createdAt.getTime() + FREE_WINDOW_DAYS * 86_400_000).toISOString() });
    await assertDailyCostCap(db);
  }
  const token = randomToken(24);
  const audit = await db.audit.create({
    data: { domain, locale: input.locale, tokenHash: hashToken(token), fingerprintHash, expiresAt: new Date(Date.now() + AUDIT_TTL_DAYS * 86_400_000), progressTotal: 5 },
  });
  const job = await enqueue(db, { type: "audit", operationId: `audit:${audit.id}`, payload: { auditId: audit.id } });
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
export function publicAuditView(a: NonNullable<Awaited<ReturnType<typeof getAuditByToken>>>) {
  return {
    domain: a.domain,
    status: a.status,
    stage: a.stage,
    progress: { done: a.progressDone, total: a.progressTotal },
    expiresAt: a.expiresAt.toISOString(),
    claimed: Boolean(a.claimedAt),
    result: a.resultSummary ?? null,
    errorCode: a.errorCode,
  };
}

/**
 * Soru üretimi için genel kategori terimleri. Ürün kategori yollarından ("Mobilya > Mocca Katlanır Koltuk")
 * birden çok ürünün paylaştığı ortak son ek ("Katlanır Koltuk") ve üst kategoriler ("Mobilya") tercih edilir;
 * markanın kendi model adları (yalnız tek ürüne özgü) soruya taşınmaz.
 */
export function deriveCategoryTerms(pages: Array<{ pageType: string; facts: { h1: string | null; title: string | null; products: Array<{ category?: string | null }> } }>): string[] {
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
  // Sayfa başlıkları çoğu zaman model/koleksiyon adıdır; yalnız ürün kategori verisi yoksa kullanılır.
  const ordered = shared.length || tops.length ? [...shared, ...tops] : [...leaves, ...pageCats];
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
  const base = categories.length ? categories : ["ürünler"];
  const templates = [
    (c: string) => `${place} en iyi ${c.toLocaleLowerCase("tr-TR")} markaları hangileri?`,
    (c: string) => `Küçük bir ev için hangi ${c.toLocaleLowerCase("tr-TR")} modellerini önerirsin?`,
    (c: string) => `Uygun fiyatlı ve kaliteli ${c.toLocaleLowerCase("tr-TR")} nereden alabilirim?`,
    (c: string) => `${c.toLocaleLowerCase("tr-TR")} alırken nelere dikkat etmeliyim, hangi markaları karşılaştırmalıyım?`.replace(/^./, (x) => x.toLocaleUpperCase("tr-TR")),
    (c: string) => `Popüler ${c.toLocaleLowerCase("tr-TR")} markalarına alternatif ne var?`,
  ];
  return templates.slice(0, AUDIT_PROMPTS).map((t, i) => t(base[i % base.length]!).replace(/\s+/g, " ").trim());
}

const KNOWN_THIRD_PARTY = /(forum|haber|news|blog|rehber|yorum|review|wiki|medium|youtube|instagram|facebook|twitter|x\.com|reddit|sikayet|trendyol|hepsiburada|amazon|n11|cimri|akakce)/;

type AuditAnswer = { engine: string; model: string; surface: string; prompt: string; ok: boolean; mentioned: boolean; recommended: boolean; ownCitation: boolean; citedDomains: string[]; sampledAt: string; errorCode?: string; errorDetail?: string };

/** Adımlar arası kalıcı audit ara durumu (JobRecord.cursor.step). */
export interface AuditWork {
  crawl?: {
    readiness: ReturnType<typeof evaluateReadiness>;
    brandName: string;
    categories: string[];
    productCount: number;
    pages: number;
    failed: number;
    skippedByRobots: number;
    truncated: boolean;
    failures?: Array<{ url: string; reason: string }>;
  };
  prompts?: string[];
  answers: AuditAnswer[];
  /** Sıradaki (soru × motor) çiftinin deneme sayısı (zaman aşımı/geçici hata). */
  pendingAttempts?: number;
}

const AUDIT_CALL_ATTEMPTS = 2;

/**
 * Audit işi: tarama → sorular → AI yanıtları → özet. Aşamalar gerçek ilerleme olarak yazılır; kısmi sonuç korunur.
 * Worker'da tek seferde biter. Adım modunda (`deadline`) bütçe dolunca ara durum `save` ile saklanır ve
 * "continue" döner; sonraki adım `load` ile kaldığı yerden devam eder (tamamlanan çağrılar tekrarlanmaz).
 */
export async function runAudit(
  db: PrismaClient,
  auditId: string,
  deps: { fetcher?: Fetcher; adapters?: Record<EngineKey, AiMonitorAdapter> } = {},
  opts: { deadline?: number; callTimeoutMs?: number; crawlMaxPages?: number; load?: () => AuditWork | null; save?: (w: AuditWork) => Promise<void> } = {},
): Promise<"done" | "continue"> {
  const cfg = config();
  const audit = await db.audit.findUniqueOrThrow({ where: { id: auditId } });
  if (audit.status === "succeeded" || audit.status === "partial" || audit.status === "failed") return "done";
  const demo = demoAudit(audit.domain, cfg);
  const fetcher = deps.fetcher ?? (demo ? fixtureFetcher : liveFetcher);
  const adapters = deps.adapters ?? getAiAdapters(cfg, { demo });
  const stage = (s: string, done: number) => db.audit.update({ where: { id: auditId }, data: { stage: s, progressDone: done, status: "running" } });
  const overBudget = () => opts.deadline !== undefined && Date.now() > opts.deadline;
  const work: AuditWork = opts.load?.() ?? { answers: [] };
  const save = async () => opts.save?.(work);

  if (!work.crawl) {
    await stage("crawling", 1);
    const crawl = await crawlSite({ domain: audit.domain, maxPages: opts.crawlMaxPages ?? PLANS.free_audit.limits.crawlUrls, fetcher, delayMs: demo ? 0 : 250, deadline: opts.deadline });
    const home = crawl.pages.find((p) => p.pageType === "home");
    work.crawl = {
      readiness: evaluateReadiness(crawl),
      brandName: home?.facts.ogSiteName ?? home?.facts.h1 ?? audit.domain.split(".")[0]!,
      categories: deriveCategoryTerms(crawl.pages),
      productCount: new Set(crawl.pages.flatMap((p) => p.facts.products.map((x) => x.sku ?? x.name))).size,
      pages: crawl.pages.length,
      failed: crawl.failed.length,
      skippedByRobots: crawl.skippedByRobots,
      truncated: crawl.truncated,
      failures: crawl.failed.slice(0, 3),
    };
    await save();
    if (overBudget()) return "continue";
  }
  const { brandName, categories } = work.crawl;

  const country = audit.locale.split("-")[1] ?? "TR";
  const language = audit.locale.split("-")[0] ?? "tr";
  if (!work.prompts) {
    await stage("prompts", 2);
    work.prompts = auditPrompts(categories, country);
    await save();
  }
  const prompts = work.prompts;

  await stage("asking_engines", 3);
  const available = AUDIT_ENGINES.map((e) => adapters[e]).filter((a) => a.status() === "ready" || a.status() === "demo");
  const unavailable = AUDIT_ENGINES.filter((e) => !available.some((a) => a.engine === e)).map((e) => ({ engine: e, reason: adapters[e].statusReason() }));
  const entity = { id: "self", type: "brand" as const, name: brandName, aliases: [], domain: audit.domain };
  const pairs = prompts.flatMap((prompt) => available.map((a) => ({ prompt, a })));
  while (work.answers.length < pairs.length) {
    if (overBudget()) {
      await save();
      return "continue";
    }
    const { prompt, a } = pairs[work.answers.length]!;
    // Aynı platformda kalıcı hata (anahtar/model) alındıysa tekrar çağrılmaz.
    const permanent = work.answers.find((x) => x.engine === a.engine && !x.ok && ["auth", "not_configured", "http_400", "http_404", "insufficient_quota"].includes(x.errorCode ?? ""));
    if (permanent) {
      work.answers.push({ engine: a.engine, model: "", surface: a.surface, prompt, ok: false, mentioned: false, recommended: false, ownCitation: false, citedDomains: [], sampledAt: new Date().toISOString(), errorCode: permanent.errorCode });
      continue;
    }
    try {
      const ans = await a.ask({ prompt, country, language, signal: opts.callTimeoutMs ? AbortSignal.timeout(opts.callTimeoutMs) : undefined });
      await db.costLedger.create({ data: { workspaceId: null, provider: ans.provider, model: ans.model, operation: "audit", attemptId: `audit:${auditId}:${a.engine}:${sha256(prompt).slice(0, 8)}:${Date.now()}`, costMicros: ans.costMicros ?? 0n, succeeded: true } });
      const ex = extract(ans.text, ans.urls, [entity]);
      const m = ex.mentions.find((x) => x.entityId === "self" && x.kind !== "negative" && !x.needsReview);
      work.answers.push({
        engine: a.engine, model: ans.model, surface: ans.surface, prompt, ok: true, mentioned: Boolean(m), recommended: m?.kind === "recommendation",
        ownCitation: ex.citations.some((c) => c.association === "own"), citedDomains: ex.citations.filter((c) => c.association !== "own").map((c) => c.domain), sampledAt: new Date().toISOString(),
      });
      work.pendingAttempts = 0;
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      const attempts = (work.pendingAttempts ?? 0) + 1;
      if (pe?.retryable && attempts < AUDIT_CALL_ATTEMPTS) {
        // Geçici hata/zaman aşımı: aynı çift bir kez daha denenir (bir sonraki döngü veya adım).
        work.pendingAttempts = attempts;
        await save();
        continue;
      }
      work.pendingAttempts = 0;
      work.answers.push({ engine: a.engine, model: "", surface: a.surface, prompt, ok: false, mentioned: false, recommended: false, ownCitation: false, citedDomains: [], sampledAt: new Date().toISOString(), errorCode: pe?.code ?? "error", errorDetail: ((e as Error).message ?? "").slice(0, 240) });
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
  for (const x of answers) for (const d of new Set(x.citedDomains)) if (!KNOWN_THIRD_PARTY.test(d)) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  const competitorCandidates = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([domain, count]) => ({ domain, observations: count }));
  const lost = answers.filter((x) => x.ok && !x.mentioned && x.citedDomains.length > 0);
  const opportunityCount = new Set(lost.map((x) => x.prompt)).size;
  const examples = lost.slice(0, 3).map((x) => ({ prompt: x.prompt, engine: x.engine, competitorDomains: [...new Set(x.citedDomains)].slice(0, 3), intentScore: scoreCommercialIntent(x.prompt, categories).total, intentType: classifyIntentType(x.prompt) }));
  const models = [...new Set(answers.filter((x) => x.ok).map((x) => `${x.engine}:${x.model}`))];
  const okCount = answers.filter((x) => x.ok).length;
  const failedErrors = [...new Set(answers.filter((x) => !x.ok).map((x) => `${x.engine}:${x.errorCode ?? "error"}`))];
  // Platform başına ilk sağlayıcı hata mesajı (tanı için; anahtar içermez).
  const failedDetails = Object.fromEntries(available.map((a) => [a.engine, answers.find((x) => x.engine === a.engine && !x.ok && x.errorDetail)?.errorDetail]).filter(([, d]) => d));
  const partial = unavailable.length > 0 || okCount < prompts.length * AUDIT_ENGINES.length || work.crawl.failed > 0 || work.crawl.truncated;

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
        visibility: { score: agg.score, smallSample: true, sampleCount: okCount, scheduled: prompts.length * AUDIT_ENGINES.length, partial: agg.partial, missingEngines: [...agg.missingEngines, ...unavailable.map((u) => u.engine)] },
        engines: perEngine.map((e) => ({ engine: e.engine, score: e.score, coverage: e.coverage })),
        unavailableEngines: unavailable,
        failedCalls: failedErrors,
        failedDetails,
        provenance: { models, surface: "api_grounded", country, language, sampledAt: new Date().toISOString(), sampleCount: okCount },
        readiness: { geoScore: work.crawl.readiness.geoScore, adsScore: work.crawl.readiness.adsScore, checks: work.crawl.readiness.checks as unknown as object[] },
        crawl: { pages: work.crawl.pages, failed: work.crawl.failed, skippedByRobots: work.crawl.skippedByRobots, products: work.crawl.productCount, categories, truncated: work.crawl.truncated, failures: work.crawl.failures ?? [] },
        competitorCandidates,
        opportunityCount,
        examples,
        prompts,
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
  return db.$transaction(async (tx) => {
    const consumed = await tx.audit.updateMany({ where: { id: audit.id, claimedAt: null }, data: { claimedAt: new Date(), claimUserId: userId } });
    if (consumed.count === 0) throw new AppError("conflict", "Bu audit zaten sahiplenildi");
    const summary = (audit.resultSummary ?? {}) as { brandName?: string; prompts?: string[]; crawl?: { categories?: string[] }; competitorCandidates?: Array<{ domain: string }> };
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
      data: { workspaceId: ws.id, domain: audit.domain, name: summary.brandName ?? audit.domain, categories: summary.crawl?.categories ?? [], onboarding: { step: 2, fromAuditId: audit.id } },
    });
    await tx.audit.update({ where: { id: audit.id }, data: { workspaceId: ws.id } });
    for (const c of (summary.competitorCandidates ?? []).slice(0, PLANS.starter.limits.competitorsPerBrand)) {
      await tx.competitor.create({ data: { workspaceId: ws.id, brandId: brand.id, name: c.domain.split(".")[0]!, domain: c.domain, source: "domain_finding" } });
    }
    await tx.auditLog.create({ data: { workspaceId: ws.id, actorId: userId, actorType: "user", scope: "audit", action: "audit.claimed", target: audit.id } });
    return { workspaceId: ws.id, brandId: brand.id, trialStarted: !existingTrial, period: periodKey(now) };
  });
}
