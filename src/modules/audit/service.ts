import type { PrismaClient } from "@/generated/prisma/client";
import { config } from "@/lib/config";
import { hashToken, randomToken, sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/http/errors";
import { enqueue } from "@/lib/queue";
import { assertPublicUrl } from "@/lib/http/safe-fetch";
import { getAiAdapters } from "@/adapters/ai/providers";
import type { AiMonitorAdapter, EngineKey } from "@/adapters/ai/types";
import { crawlSite, normalizeDomain, liveFetcher, type Fetcher } from "./crawler";
import { fixtureFetcher } from "./fixture-site";
import { evaluateReadiness } from "./readiness";
import { extract } from "@/modules/monitoring/extract";
import { visibilityScore, aggregateScore } from "@/modules/monitoring/metrics";
import { scoreCommercialIntent, classifyIntentType } from "@/modules/prompts/intent";
import { PLANS, TRIAL } from "@/modules/billing/plans";
import { periodKey } from "@/modules/billing/quota";

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
  let domain: string;
  try {
    domain = normalizeDomain(input.domain);
  } catch {
    throw new AppError("validation_error", "Geçerli bir alan adı girin", { fieldErrors: { domain: ["Geçersiz alan adı"] } });
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new AppError("validation_error", "Geçerli bir alan adı girin", { fieldErrors: { domain: ["Geçersiz alan adı"] } });
  if (cfg.DEMO_MODE) {
    if (!domain.endsWith(".example")) {
      throw new AppError("validation_error", "Demo modunda yalnız örnek alan adları (ör. lumabakim.example) taranabilir", { fieldErrors: { domain: ["Demo modunda .example alan adı kullanın"] } });
    }
  } else {
    await assertPublicUrl(`https://${domain}/`);
  }
  const since = new Date(Date.now() - FREE_WINDOW_DAYS * 86_400_000);
  const fingerprintHash = sha256(`fp:${input.fingerprint}`);
  if (!cfg.DEMO_MODE) {
    const recent = await db.audit.findFirst({ where: { OR: [{ domain }, { fingerprintHash }], createdAt: { gte: since } } });
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

function deriveCategoryTerms(pages: Awaited<ReturnType<typeof crawlSite>>["pages"]): string[] {
  const cats = pages.filter((p) => p.pageType === "category").map((p) => p.facts.h1 ?? p.facts.title ?? "").filter(Boolean);
  const productCats = pages.flatMap((p) => p.facts.products.map((x) => x.category ?? "")).filter(Boolean);
  return [...new Set([...cats, ...productCats].map((c) => c.split("|")[0]!.trim()))].slice(0, 5);
}

export function auditPrompts(categories: string[], country: string): string[] {
  const place = country === "TR" ? "Türkiye'de" : "";
  const base = categories.length ? categories : ["ürünler"];
  const templates = [
    (c: string) => `${place} en iyi ${c.toLocaleLowerCase("tr-TR")} markaları hangileri?`,
    (c: string) => `Hassas cilt için hangi ${c.toLocaleLowerCase("tr-TR")} önerirsin?`,
    (c: string) => `Uygun fiyatlı ve kaliteli ${c.toLocaleLowerCase("tr-TR")} nereden alabilirim?`,
    (c: string) => `${c} alırken nelere dikkat etmeliyim, hangi markaları karşılaştırmalıyım?`,
    (c: string) => `Popüler ${c.toLocaleLowerCase("tr-TR")} markalarına alternatif ne var?`,
  ];
  return templates.slice(0, AUDIT_PROMPTS).map((t, i) => t(base[i % base.length]!).replace(/\s+/g, " ").trim());
}

const KNOWN_THIRD_PARTY = /(forum|haber|news|blog|rehber|yorum|review|wiki|medium|youtube|instagram|facebook|twitter|x\.com|reddit|sikayet|trendyol|hepsiburada|amazon|n11|cimri|akakce)/;

/** Audit işi (worker). Aşamalar gerçek ilerleme olarak yazılır; kısmi sonuç korunur. */
export async function runAudit(db: PrismaClient, auditId: string, deps: { fetcher?: Fetcher; adapters?: Record<EngineKey, AiMonitorAdapter> } = {}) {
  const cfg = config();
  const audit = await db.audit.findUniqueOrThrow({ where: { id: auditId } });
  if (audit.status === "succeeded" || audit.status === "partial") return;
  const fetcher = deps.fetcher ?? (cfg.DEMO_MODE ? fixtureFetcher : liveFetcher);
  const adapters = deps.adapters ?? getAiAdapters(cfg);
  const stage = (s: string, done: number) => db.audit.update({ where: { id: auditId }, data: { stage: s, progressDone: done, status: "running" } });

  await stage("crawling", 1);
  const crawl = await crawlSite({ domain: audit.domain, maxPages: PLANS.free_audit.limits.crawlUrls, fetcher, delayMs: cfg.DEMO_MODE ? 0 : 250 });
  const readiness = evaluateReadiness(crawl);
  const home = crawl.pages.find((p) => p.pageType === "home");
  const brandName = home?.facts.ogSiteName ?? home?.facts.h1 ?? audit.domain.split(".")[0]!;
  const categories = deriveCategoryTerms(crawl.pages);
  const productCount = new Set(crawl.pages.flatMap((p) => p.facts.products.map((x) => x.sku ?? x.name))).size;

  await stage("prompts", 2);
  const country = audit.locale.split("-")[1] ?? "TR";
  const language = audit.locale.split("-")[0] ?? "tr";
  const prompts = auditPrompts(categories, country);

  await stage("asking_engines", 3);
  const available = AUDIT_ENGINES.map((e) => adapters[e]).filter((a) => a.status() === "ready" || a.status() === "demo");
  const unavailable = AUDIT_ENGINES.filter((e) => !available.some((a) => a.engine === e)).map((e) => ({ engine: e, reason: adapters[e].statusReason() }));
  const entity = { id: "self", type: "brand" as const, name: brandName, aliases: [], domain: audit.domain };
  const answers: Array<{ engine: string; model: string; surface: string; prompt: string; ok: boolean; mentioned: boolean; recommended: boolean; ownCitation: boolean; citedDomains: string[]; sampledAt: string }> = [];
  for (const prompt of prompts) {
    for (const a of available) {
      try {
        const ans = await a.ask({ prompt, country, language });
        await db.costLedger.create({ data: { workspaceId: null, provider: ans.provider, model: ans.model, operation: "audit", attemptId: `audit:${auditId}:${a.engine}:${sha256(prompt).slice(0, 8)}:${Date.now()}`, costMicros: ans.costMicros ?? 0n, succeeded: true } });
        const ex = extract(ans.text, ans.urls, [entity]);
        const m = ex.mentions.find((x) => x.entityId === "self" && x.kind !== "negative" && !x.needsReview);
        answers.push({
          engine: a.engine, model: ans.model, surface: ans.surface, prompt, ok: true, mentioned: Boolean(m), recommended: m?.kind === "recommendation",
          ownCitation: ex.citations.some((c) => c.association === "own"), citedDomains: ex.citations.filter((c) => c.association !== "own").map((c) => c.domain), sampledAt: new Date().toISOString(),
        });
      } catch {
        answers.push({ engine: a.engine, model: "", surface: a.surface, prompt, ok: false, mentioned: false, recommended: false, ownCitation: false, citedDomains: [], sampledAt: new Date().toISOString() });
      }
      await db.audit.update({ where: { id: auditId }, data: { progressDone: 3 } });
    }
  }

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
  const partial = unavailable.length > 0 || okCount < prompts.length * AUDIT_ENGINES.length || crawl.failed.length > 0;

  await db.audit.update({
    where: { id: auditId },
    data: {
      status: okCount === 0 && crawl.pages.length === 0 ? "failed" : partial ? "partial" : "succeeded",
      stage: "done",
      progressDone: 5,
      resultSummary: {
        brandName,
        demo: cfg.DEMO_MODE,
        visibility: { score: agg.score, smallSample: true, sampleCount: okCount, scheduled: prompts.length * AUDIT_ENGINES.length, partial: agg.partial, missingEngines: [...agg.missingEngines, ...unavailable.map((u) => u.engine)] },
        engines: perEngine.map((e) => ({ engine: e.engine, score: e.score, coverage: e.coverage })),
        unavailableEngines: unavailable,
        provenance: { models, surface: "api_grounded", country, language, sampledAt: new Date().toISOString(), sampleCount: okCount },
        readiness: { geoScore: readiness.geoScore, adsScore: readiness.adsScore, checks: readiness.checks as unknown as object[] },
        crawl: { pages: crawl.pages.length, failed: crawl.failed.length, skippedByRobots: crawl.skippedByRobots, products: productCount, categories },
        competitorCandidates,
        opportunityCount,
        examples,
        prompts,
      },
    },
  });
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
  return db.$transaction(async (tx) => {
    const consumed = await tx.audit.updateMany({ where: { id: audit.id, claimedAt: null }, data: { claimedAt: new Date(), claimUserId: userId } });
    if (consumed.count === 0) throw new AppError("conflict", "Bu audit zaten sahiplenildi");
    const summary = (audit.resultSummary ?? {}) as { brandName?: string; prompts?: string[]; crawl?: { categories?: string[] }; competitorCandidates?: Array<{ domain: string }> };
    const existingTrial = await tx.membership.findFirst({ where: { userId, role: "owner", workspace: { subscription: { isNot: null } } } });
    const slugBase = audit.domain.replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const ws = await tx.workspace.create({
      data: { name: summary.brandName ?? audit.domain, slug: `${slugBase}-${randomToken(4).toLowerCase()}`, ownerId: userId, memberships: { create: { userId, role: "owner", isApprover: true } } },
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
