/**
 * Deterministik demo seed (§15). Dış çağrı/harcama yok; tüm veriler "Örnek veri" etiketli workspace'lerde.
 * Hayali markalar (.example alan adları). Skorlar fixture gözlemlerinden formülle hesaplanır — hardcode yok.
 * Çalıştırma: npm run db:seed  (DEMO_MODE=true gerektirir)
 */
import "dotenv/config";
import { createPrismaClient } from "../src/lib/db";
import { fixtureAnswer } from "../src/adapters/ai/fixture";
import type { AiMonitorAdapter, EngineKey } from "../src/adapters/ai/types";
import { DEMO_CATEGORIES, demoProducts, fixtureFetcher } from "../src/modules/audit/fixture-site";
import { crawlSite } from "../src/modules/audit/crawler";
import { persistCrawl } from "../src/modules/catalog/service";
import { classifyIntentType, promptHash, scoreCommercialIntent } from "../src/modules/prompts/intent";
import { createRun, executeRun } from "../src/modules/monitoring/service";
import { generateOpportunities } from "../src/modules/opportunities/engine";
import { templateDraft } from "../src/modules/actions/generator";
import { versionHash } from "../src/modules/actions/workflow";
import { upsertOrder, attributeOrders } from "../src/modules/commerce/service";
import { PLANS } from "../src/modules/billing/plans";
import { ensureBucket, periodKey } from "../src/modules/billing/quota";
import { hashToken } from "../src/lib/crypto";

if (process.env.DEMO_MODE !== "true") {
  console.error("Seed yalnız DEMO_MODE=true iken çalışır.");
  process.exit(1);
}

const db = createPrismaClient();
const DAY = 86_400_000;
// Sabit referans tarih: seed deterministik; gözlemler bugüne göre son 30 güne yayılır.
const TODAY = new Date(new Date().toISOString().slice(0, 10) + "T09:00:00Z");

function seededAdapters(dayIndex: number): Record<EngineKey, AiMonitorAdapter> {
  const mk = (engine: EngineKey): AiMonitorAdapter => ({
    engine,
    provider: "fixture",
    surface: "api_grounded",
    status: () => "demo",
    statusReason: () => "Örnek veri",
    ask: async (i) => fixtureAnswer(engine, i.prompt, dayIndex),
  });
  const na = (engine: EngineKey): AiMonitorAdapter => ({ ...mk(engine), status: () => "unsupported", ask: async () => { throw new Error("unsupported"); } });
  return { chatgpt: mk("chatgpt"), gemini: mk("gemini"), perplexity: mk("perplexity"), google_ai_overviews: na("google_ai_overviews"), copilot: na("copilot") };
}

const CLUSTERS: Array<{ label: string; type: ReturnType<typeof classifyIntentType>; category: string | null; prompts: string[] }> = [
  { label: "Hassas cilt nemlendirici", type: "category_discovery", category: "Nemlendiriciler", prompts: ["Hassas cilt için en iyi nemlendirici hangisi?", "Kızarıklığa eğilimli cilt için parfümsüz nemlendirici öner", "Kuru ve hassas cilt için gece nemlendiricisi tavsiye"] },
  { label: "Uygun fiyatlı serum", type: "transactional", category: "Serumlar", prompts: ["500 TL altı en iyi C vitamini serumu", "Uygun fiyatlı hyaluronik asit serumu nereden alabilirim?", "Öğrenci bütçesine uygun serum önerisi"] },
  { label: "Güneş kremi SPF 50", type: "category_discovery", category: "Güneş Kremleri", prompts: ["Yağlı cilt için SPF 50 güneş kremi öner", "Beyaz iz bırakmayan güneş kremi hangisi?", "Hassas cilt için mineral güneş kremi tavsiye"] },
  { label: "Nemlendirici karşılaştırma", type: "comparison", category: "Nemlendiriciler", prompts: ["Nora Cilt mi Luma Bakım mı nemlendirici için daha iyi?", "Jel nemlendirici ile krem nemlendirici farkı nedir, hangisini almalıyım?"] },
  { label: "Serum alternatifleri", type: "alternative", category: "Serumlar", prompts: ["Pahalı retinol serumlarına alternatif ne var?", "Vera Derma serum yerine ne kullanabilirim?"] },
  { label: "Yüz temizleyici seçimi", type: "category_discovery", category: "Yüz Temizleyiciler", prompts: ["Akneye eğilimli cilt için yüz temizleme jeli öner", "Sabunsuz yüz temizleyici tavsiye"] },
  { label: "Maske önerileri", type: "category_discovery", category: "Maskeler", prompts: ["Nem veren yüz maskesi öner", "Haftalık kil maskesi hangisi iyi?"] },
  { label: "Cilt bakım rutini", type: "informational", category: null, prompts: ["Hassas cilt için sabah bakım rutini nasıl olmalı?", "Niacinamide nedir, ne işe yarar?"] },
  { label: "Vegan cilt bakımı", type: "transactional", category: "Nemlendiriciler", prompts: ["Vegan ve cruelty-free nemlendirici nereden alınır?", "Vegan güneş kremi markaları"] },
  { label: "Göz çevresi bakımı", type: "category_discovery", category: "Göz Kremleri", prompts: ["Göz altı morlukları için krem öner"] },
  { label: "Online sipariş", type: "transactional", category: "Serumlar", prompts: ["Cilt bakım ürünleri online sipariş için güvenilir site"] },
];

async function main() {
  console.log("Demo verisi temizleniyor…");
  const demoWs = await db.workspace.findMany({ where: { isDemo: true }, select: { id: true } });
  await db.workspace.deleteMany({ where: { isDemo: true } });
  await db.costLedger.deleteMany({ where: { workspaceId: { in: demoWs.map((w) => w.id) } } });
  await db.user.deleteMany({ where: { email: { endsWith: "@demo.example" } } });

  // Plan kataloğu (tek kaynak: src/modules/billing/plans.ts)
  for (const p of Object.values(PLANS)) {
    const plan = await db.plan.upsert({ where: { planKey_version: { planKey: p.key, version: p.version } }, update: { monthlyPrice: p.monthlyPriceUsdCents }, create: { planKey: p.key, version: p.version, monthlyPrice: p.monthlyPriceUsdCents } });
    await db.planEntitlement.upsert({ where: { planId: plan.id }, update: { limits: p.limits as object }, create: { planId: plan.id, limits: p.limits as object } });
  }

  const user = (email: string, name: string) => db.user.create({ data: { email, name, emailVerified: TODAY } });
  const owner = await user("owner@demo.example", "Deniz Sahip");
  const editor = await user("editor@demo.example", "Ece Editör");
  const analyst = await user("analyst@demo.example", "Arda Analist");
  const billingU = await user("billing@demo.example", "Bora Fatura");
  const agencyOwner = await user("ajans@demo.example", "Aylin Ajans");
  const clientU = await user("client@demo.example", "Cem Müşteri");

  // ── Workspace 1: marka (Commerce paketi) ──
  const periodStart = new Date(TODAY.getTime() - 10 * DAY);
  const ws = await db.workspace.create({
    data: {
      name: "Luma Bakım (Örnek veri)", slug: "demo-luma", ownerId: owner.id, isDemo: true, billingCurrency: "USD",
      memberships: { create: [{ userId: owner.id, role: "owner", isApprover: true }, { userId: editor.id, role: "editor" }, { userId: analyst.id, role: "analyst" }, { userId: billingU.id, role: "billing" }] },
      subscription: { create: { planKey: "commerce", status: "active", currentPeriodStart: periodStart, currentPeriodEnd: new Date(periodStart.getTime() + 30 * DAY) } },
    },
  });
  const brand = await db.brand.create({
    data: { workspaceId: ws.id, domain: "lumabakim.example", name: "Luma Bakım", aliases: ["Luma"], country: "TR", language: "tr", currency: "TRY", categories: DEMO_CATEGORIES.map((c) => c.name), verifiedAt: TODAY, onboarding: { step: 7, completed: true } },
  });

  console.log("Katalog (fixture site crawl)…");
  const crawlRun = await db.crawlRun.create({ data: { workspaceId: ws.id, brandId: brand.id, status: "running", maxPages: 60, startedAt: TODAY } });
  const crawl = await crawlSite({ domain: brand.domain, maxPages: 60, fetcher: fixtureFetcher });
  await persistCrawl(db, { workspaceId: ws.id, brandId: brand.id, crawlRunId: crawlRun.id }, crawl);
  // Tam katalog: 30 ürün / 5 kategori (feed importu gibi)
  const catIds = new Map<string, string>();
  for (const c of DEMO_CATEGORIES) {
    const existing = await db.category.findFirst({ where: { brandId: brand.id, name: c.name } });
    const cat = existing ?? (await db.category.create({ data: { workspaceId: ws.id, brandId: brand.id, externalId: `https://lumabakim.example/kategori/${c.slug}`, name: c.name, url: `https://lumabakim.example/kategori/${c.slug}` } }));
    catIds.set(c.slug, cat.id);
  }
  const csvIntegration = await db.integration.create({ data: { workspaceId: ws.id, brandId: brand.id, provider: "csv_feed", storeId: "manual", capabilities: { catalogRead: true, ordersRead: true, refundsRead: true, contentWrite: false }, scopes: [], status: "healthy", lastSyncAt: TODAY } });
  for (const p of demoProducts()) {
    const product = await db.product.upsert({
      where: { brandId_connectorId_externalId: { brandId: brand.id, connectorId: csvIntegration.id, externalId: p.id } },
      update: {},
      create: { workspaceId: ws.id, brandId: brand.id, connectorId: csvIntegration.id, externalId: p.id, name: p.name, url: `https://lumabakim.example/urun/${p.slug}`, source: "feed" },
    });
    await db.productVariant.create({ data: { workspaceId: ws.id, productId: product.id, externalId: p.id, sku: p.id, priceMinor: BigInt(p.priceMinor), currency: "TRY", stock: p.stock, available: p.stock > 0 } });
    await db.productCategory.create({ data: { productId: product.id, categoryId: catIds.get(p.category.slug)! } });
  }
  await db.integration.create({ data: { workspaceId: ws.id, brandId: brand.id, provider: "shopify", storeId: "luma-demo.myshopify.example", capabilities: { catalogRead: true, ordersRead: true, contentWrite: true }, scopes: ["read_products", "read_orders"], status: "reauth_required", errorCode: "demo_token_revoked" } });

  // Rakipler (onaylı)
  const comps = [
    { name: "Nora Cilt", domain: "noracilt.example" },
    { name: "Vera Derma", domain: "veraderma.example" },
    { name: "Pera Kozmetik", domain: "perakozmetik.example" },
  ];
  for (const c of comps) await db.competitor.create({ data: { workspaceId: ws.id, brandId: brand.id, name: c.name, domain: c.domain, aliases: [], source: "ai_candidate", confirmedAt: TODAY } });

  // 25 prompt / 11 cluster
  const catalogTerms = [...DEMO_CATEGORIES.map((c) => c.name), "nemlendirici", "serum", "güneş kremi", "spf", "maske"];
  const pvIds: string[] = [];
  for (const c of CLUSTERS) {
    const cluster = await db.intentCluster.create({ data: { workspaceId: ws.id, brandId: brand.id, category: c.category, type: c.type, label: c.label, locale: "tr-TR" } });
    for (const text of c.prompts) {
      const rubric = scoreCommercialIntent(text, catalogTerms);
      const prompt = await db.prompt.create({ data: { workspaceId: ws.id, brandId: brand.id, clusterId: cluster.id, branded: /luma/i.test(text), weight: c.type === "transactional" ? 1.5 : 1, source: "generated" } });
      const v = await db.promptVersion.create({ data: { workspaceId: ws.id, promptId: prompt.id, version: 1, text, normalizedHash: promptHash(text), commercialScore: rubric.total, commercialRubric: rubric as object, rationale: rubric.reasons.join("; ") } });
      await db.prompt.update({ where: { id: prompt.id }, data: { currentVersionId: v.id } });
      pvIds.push(v.id);
    }
  }
  await db.monitoringSchedule.create({ data: { workspaceId: ws.id, brandId: brand.id, engines: ["chatgpt", "gemini", "perplexity"], locales: ["tr-TR"], frequency: "daily", repetitions: 1, budgetUnits: 150, nextRunAt: new Date(TODAY.getTime() + DAY) } });

  console.log("30 günlük gözlemler (fixture)…");
  let used = 0;
  for (let d = 29; d >= 0; d--) {
    const day = new Date(TODAY.getTime() - d * DAY);
    // Günlük bütçeli cohort: prompt'lar 3 güne bir tam tur (≈8-9 prompt/gün × 3 motor)
    const slice = pvIds.filter((_, i) => i % 3 === d % 3);
    const plan = { promptVersionIds: slice, engines: ["chatgpt", "gemini", "perplexity"] as EngineKey[], locales: ["tr-TR"], repetitions: 1 };
    const run = await createRun(db, { workspaceId: ws.id, brandId: brand.id, plan, trigger: "demo", operationId: `demo-run-${d}` });
    await db.monitoringRun.update({ where: { id: run.id }, data: { scheduledAt: day } });
    const res = await executeRun(db, run.id, plan, seededAdapters(d), { maxAttempts: 1, now: () => day });
    used += res.ok;
  }
  const bucket = await ensureBucket(db, ws.id, "answer_units", periodKey(periodStart), PLANS.commerce.limits.answerUnits);
  await db.usageBucket.update({ where: { id: bucket.id }, data: { used: Math.min(used, bucket.limit) } });
  await ensureBucket(db, ws.id, "fix_units", periodKey(periodStart), PLANS.commerce.limits.fixUnits);

  console.log("Fırsatlar…");
  await generateOpportunities(db, ws.id, brand.id, { now: TODAY });
  const opps = await db.opportunity.findMany({ where: { brandId: brand.id }, orderBy: { score: "desc" }, include: { cluster: true, evidence: true } });
  console.log(`  ${opps.length} fırsat üretildi (formülden).`);
  const statuses = ["new", "triaged", "in_progress", "measuring", "won", "dismissed"] as const;
  for (const [i, o] of opps.entries()) {
    if (i >= 6 && i < 12) await db.opportunity.update({ where: { id: o.id }, data: { status: statuses[i - 6], ownerId: i % 2 ? editor.id : owner.id, dueAt: new Date(TODAY.getTime() + (i + 3) * DAY) } });
  }

  console.log("Aksiyonlar (6 farklı durum)…");
  const products = await db.product.findMany({ where: { brandId: brand.id }, include: { variants: true }, take: 5 });
  const actionStates = ["draft", "review", "approved", "measuring", "completed", "rejected"] as const;
  for (const [i, status] of actionStates.entries()) {
    const o = opps[i % Math.max(1, opps.length)];
    if (!o) break;
    const content = templateDraft({
      type: i % 2 ? "faq" : "content", language: "tr", brand: { name: brand.name, domain: brand.domain }, opportunity: { title: o.title, recommendedAction: o.recommendedAction, clusterLabel: o.cluster.label, gapType: o.gapType },
      evidence: o.evidence.map((e) => ({ quote: e.quote, url: e.pageUrl })), targetUrl: o.targetUrl,
      catalog: products.map((p) => ({ name: p.name, url: p.url, priceMinor: p.variants[0]?.priceMinor ?? null, currency: p.variants[0]?.currency ?? null, available: p.variants[0]?.available ?? null })), allowedClaims: [],
    });
    const a = await db.action.create({ data: { workspaceId: ws.id, brandId: brand.id, opportunityId: o.id, type: i % 2 ? "faq" : "content", status, title: content.title ?? o.title, targetUrl: o.targetUrl, version: 1, assigneeId: editor.id, publishedAt: ["measuring", "completed"].includes(status) ? new Date(TODAY.getTime() - (status === "completed" ? 30 : 5) * DAY) : null, measurement: ["measuring", "completed"].includes(status) ? { publishAt: new Date(TODAY.getTime() - (status === "completed" ? 30 : 5) * DAY).toISOString(), baselineDays: 14, followUps: [14, 28], manualPublish: true } : undefined } });
    const v = await db.actionVersion.create({ data: { workspaceId: ws.id, actionId: a.id, number: 1, content: content as object, contentHash: versionHash(content), generated: true, createdById: editor.id } });
    await db.action.update({ where: { id: a.id }, data: { currentVersionId: v.id } });
    if (["approved", "measuring", "completed"].includes(status)) await db.approval.create({ data: { workspaceId: ws.id, actionId: a.id, versionId: v.id, versionHash: v.contentHash, approverId: owner.id } });
  }

  console.log("Commerce: 20 sipariş, 2 iade, 2 para birimi…");
  const referrers = ["chatgpt.com", "gemini.google.com", "perplexity.ai", "www.google.com", null, "ciltforum.example"];
  for (let i = 0; i < 20; i++) {
    const paidAt = new Date(TODAY.getTime() - (i + 1) * DAY - 3 * 3600_000);
    const anon = `anon-${i % 14}`;
    const ref = referrers[i % referrers.length]!;
    const consent = i % 9 !== 4; // bazı ziyaretlerde consent yok → unattributed
    const s = await db.visitorSession.upsert({
      where: { brandId_externalSessionId: { brandId: brand.id, externalSessionId: `sess-${i}` } },
      update: {},
      create: { workspaceId: ws.id, brandId: brand.id, anonymousId: anon, externalSessionId: `sess-${i}`, startedAt: new Date(paidAt.getTime() - 3600_000), lastSeenAt: paidAt, consent: { analytics: consent, ads: false } },
    });
    const channel = ref === null ? "direct" : ref.includes("chatgpt") ? "ai_organic:chatgpt" : ref.includes("gemini") ? "ai_organic:gemini" : ref.includes("perplexity") ? "ai_organic:perplexity" : ref.includes("google") ? "organic_search" : "referral";
    await db.touchpoint.create({ data: { workspaceId: ws.id, brandId: brand.id, sessionId: s.id, anonymousId: anon, occurredAt: new Date(paidAt.getTime() - 3600_000), channel, referrerHost: ref, landingPath: "/kategori/nemlendirici" } });
    const usd = i % 5 === 0;
    const p = demoProducts()[i % 30]!;
    await upsertOrder(db, { workspaceId: ws.id, brandId: brand.id, connectorId: csvIntegration.id }, {
      externalOrderId: `LB-ORD-${1000 + i}`,
      status: i === 3 ? "refunded" : i === 7 ? "partially_refunded" : "paid",
      paidAt,
      currency: usd ? "USD" : "TRY",
      items: [{ productExternalId: p.id, variantExternalId: p.id, name: p.name, quantity: 1 + (i % 2), unitPriceMinor: usd ? BigInt(1500 + i * 37) : BigInt(p.priceMinor), discountMinor: 0n }],
      discountMinor: i % 4 === 0 ? (usd ? 200n : 2000n) : 0n,
      taxMinor: usd ? 0n : BigInt(Math.round(p.priceMinor * 0.2)),
      shippingMinor: usd ? 500n : 4990n,
      refunds: i === 3 ? [{ externalId: "RF-1", amountMinor: BigInt(p.priceMinor) * BigInt(1 + (i % 2)), refundedAt: new Date(paidAt.getTime() + 2 * DAY) }] : i === 7 ? [{ externalId: "RF-2", amountMinor: BigInt(p.priceMinor), refundedAt: new Date(paidAt.getTime() + 3 * DAY) }] : [],
      anonymousId: anon,
      sessionRef: `sess-${i}`,
      updatedAt: paidAt,
    });
  }
  await attributeOrders(db, ws.id, brand.id);

  // Ads: erişimsiz hesap
  await db.adsAccount.create({ data: { workspaceId: ws.id, brandId: brand.id, provider: "openai_ads", externalId: "demo-ads-account", currency: "USD", country: "TR", capabilities: {}, accessStatus: "access_required", automationLevel: "approval_required" } });

  // Bildirimler
  await db.notification.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, type: "opportunity.high", payload: { title: opps[0]?.title ?? "Yüksek skorlu fırsat" }, dedupeKey: "demo-opp-1" },
      { workspaceId: ws.id, userId: owner.id, type: "integration.degraded", payload: { provider: "shopify", reason: "Yeniden yetkilendirme gerekli" }, dedupeKey: "demo-int-1" },
      { workspaceId: ws.id, userId: owner.id, type: "usage.threshold", payload: { metric: "answer_units", pct: Math.round((used / PLANS.commerce.limits.answerUnits) * 100) }, dedupeKey: "demo-usage-1", readAt: TODAY },
    ],
  });

  // ── Workspace 2: ajans (2 müşteri) ──
  const agency = await db.workspace.create({
    data: {
      name: "Kuzey Dijital Ajans (Örnek veri)", slug: "demo-kuzey-ajans", ownerId: agencyOwner.id, isDemo: true,
      memberships: { create: [{ userId: agencyOwner.id, role: "owner", isApprover: true }] },
      subscription: { create: { planKey: "agency", status: "active", currentPeriodStart: periodStart, currentPeriodEnd: new Date(periodStart.getTime() + 30 * DAY) } },
      whiteLabel: { create: { displayName: "Kuzey Dijital", accent: "#2458A6" } },
    },
  });
  const clientBrands = [];
  for (const c of [{ name: "Mira Ev Tekstili", domain: "miraev.example" }, { name: "Tuna Spor", domain: "tunaspor.example" }]) {
    clientBrands.push(await db.brand.create({ data: { workspaceId: agency.id, domain: c.domain, name: c.name, aliases: [], categories: [], onboarding: { step: 3 } } }));
  }
  const clientMembership = await db.membership.create({ data: { workspaceId: agency.id, userId: clientU.id, role: "client" } });
  await db.brandGrant.create({ data: { workspaceId: agency.id, membershipId: clientMembership.id, brandId: clientBrands[0]!.id, role: "client" } });
  await ensureBucket(db, agency.id, "answer_units", periodKey(periodStart), PLANS.agency.limits.answerUnits);

  // Demo API anahtarı (yalnız local) — değer README'de.
  await db.apiKey.create({ data: { workspaceId: ws.id, name: "Demo analiz anahtarı", keyHash: hashToken("demo_key_luma_readonly_0001"), last4: "0001", scopes: ["brand:read", "export:read"], brandScope: [brand.id] } });

  console.log("Tamamlandı.");
  console.log({ workspace: ws.id, brand: brand.id, agency: agency.id, answerUnitsUsed: used, opportunities: opps.length });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
