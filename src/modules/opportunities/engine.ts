import type { PrismaClient } from "@/generated/prisma/client";
import { isCompetitorCandidate } from "@/modules/audit/competitor-filter";
import { evidenceStrength, opportunityDedupeKey, opportunityScore, visibilityGap, type OpportunityComponents } from "./scoring";

/**
 * Opportunity Engine: kanıt → teşhis → aksiyon (§5). Kurallı eşleme; korelasyon nedensellik diye yazılmaz.
 * Mevcut fırsatın status/owner alanları korunur (dedupe: cluster+locale+gapType+channel).
 */
export interface DiagnosisStep {
  observation: { quote: string; url: string | null; sampledAt: string; engine: string; observationId: string } | null;
  possibleCause: string;
  verification: "verified" | "likely" | "insufficient_evidence";
  confidence: number;
  recommendation: string;
}

/** Kategori eşleşmesi: tam ad veya anlamlı kelimelerin hepsi bir katalog adında geçiyorsa uyumlu. */
export function catalogFit(category: string, brandCats: Set<string>, catalogNames: Set<string>): number | null {
  const c = category.toLocaleLowerCase("tr-TR");
  if (brandCats.has(c)) return 100;
  if (catalogNames.size === 0) return null;
  const words = c.split(/\s+/).filter((w) => w.length > 2);
  const names = [...catalogNames];
  if (names.some((n) => n === c || (words.length && words.every((w) => n.includes(w.slice(0, Math.max(4, w.length - 2))))))) return 100;
  return 30;
}

type GapType = "intent_content" | "missing_comparison" | "catalog_mismatch" | "technical_access" | "citation_gap" | "structured_data";

const ACTION_FOR_GAP: Record<GapType, string> = {
  intent_content: "Bu niyet için hedef sayfaya soru-cevap odaklı içerik bloğu ekleyin",
  missing_comparison: "Rakiplerle karşılaştırma/alternatif sayfası hazırlayın",
  catalog_mismatch: "Bu niyete karşılık gelen kategori/ürün sayfası oluşturun veya mevcut ürünleri bu kategoriye bağlayın",
  technical_access: "Sayfanın taranabilir ve indekslenebilir olduğundan emin olun",
  citation_gap: "Rakibi destekleyen üçüncü taraf kaynaklarda marka görünürlüğü için outreach görevi oluşturun",
  structured_data: "Ürün şemasına fiyat, para birimi ve stok bilgisini (görünür veriyle uyumlu) ekleyin",
};

export async function generateOpportunities(db: PrismaClient, workspaceId: string, brandId: string, opts: { windowDays?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - (opts.windowDays ?? 30) * 86_400_000);
  const brand = await db.brand.findFirstOrThrow({ where: { id: brandId, workspaceId } });
  const competitors = await db.competitor.findMany({ where: { brandId, confirmedAt: { not: null }, archivedAt: null } });
  const clusters = await db.intentCluster.findMany({
    where: { brandId },
    include: { prompts: { where: { active: true }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } } },
  });
  const categories = await db.category.findMany({ where: { brandId }, select: { name: true, url: true } });
  const catNames = new Set(categories.map((c) => c.name.toLocaleLowerCase("tr-TR")));
  const brandCats = new Set(brand.categories.map((c) => c.toLocaleLowerCase("tr-TR")));
  const pages = await db.pageSnapshot.findMany({ where: { brandId, excluded: false }, select: { url: true, pageType: true, schemaTypes: true, findings: true }, orderBy: { sampledAt: "desc" }, take: 500 });

  let upserted = 0;
  for (const cluster of clusters) {
    const pvIds = cluster.prompts.flatMap((p) => p.versions.map((v) => v.id));
    if (pvIds.length === 0) continue;
    const obs = await db.observation.findMany({
      where: { brandId, promptVersionId: { in: pvIds }, status: "succeeded", sampledAt: { gte: from, lte: now } },
      include: { mentions: true, citations: true },
      orderBy: { sampledAt: "desc" },
    });
    if (obs.length === 0) continue;
    const presence = (entityId: string) => obs.filter((o) => o.mentions.some((m) => m.entityId === entityId && m.kind !== "negative" && !m.needsReview)).length / obs.length;
    const brandP = presence(brand.id);
    const compP = competitors.map((c) => ({ c, p: presence(c.id) }));
    const gap = visibilityGap(brandP, compP.map((x) => x.p));
    if (gap === null || gap <= 0) continue;
    const best = compP.sort((a, b) => b.p - a.p)[0]!;

    // Citation gap: rakibi destekleyen üçüncü taraf domainler vs kendi bağlantımız.
    const thirdPartyForComp = new Map<string, number>();
    const thirdPartyWithBrand = new Set<string>();
    for (const o of obs) {
      const compMentioned = o.mentions.some((m) => m.entityId === best.c.id);
      const brandMentioned = o.mentions.some((m) => m.entityId === brand.id);
      for (const ct of o.citations.filter((x) => x.association === "third_party")) {
        if (compMentioned && !brandMentioned) thirdPartyForComp.set(ct.domain, (thirdPartyForComp.get(ct.domain) ?? 0) + 1);
        if (brandMentioned) thirdPartyWithBrand.add(ct.domain);
      }
    }
    // Rakip mağazalar (ticari alan adları) outreach hedefi değildir; boşluk yalnız yayın/pazaryeri/inceleme kaynaklarıdır.
    const citationGapDomains = [...thirdPartyForComp.entries()].filter(([d]) => !thirdPartyWithBrand.has(d) && !isCompetitorCandidate(d, brand.domain));
    // Katalog uyumu: markanın onayladığı kategoriler veya taranmış kategori/ürün sayfaları; katalog verisi yoksa bilinmiyor (null).
    const catalogFitValue = cluster.category ? catalogFit(cluster.category, brandCats, catNames) : null;
    const gapType: GapType =
      catalogFitValue !== null && catalogFitValue < 50
        ? "catalog_mismatch"
        : citationGapDomains.length >= 2
          ? "citation_gap"
          : cluster.type === "comparison" || cluster.type === "alternative"
            ? "missing_comparison"
            : "intent_content";

    const scores = cluster.prompts.flatMap((p) => p.versions.map((v) => v.commercialScore));
    const intent = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const distinctSources = new Set(obs.flatMap((o) => o.citations.map((c) => c.domain))).size;
    const newestAgeDays = Math.floor((now.getTime() - obs[0]!.sampledAt.getTime()) / 86_400_000);
    const evidence = evidenceStrength({ successfulRepeats: obs.length, distinctSources, newestAgeDays });
    const targetPage = cluster.category ? categories.find((c) => c.name.toLocaleLowerCase("tr-TR") === cluster.category!.toLocaleLowerCase("tr-TR"))?.url ?? null : null;
    const targetChecked = targetPage ? pages.some((p) => p.url === targetPage) : false;
    const actionability = targetChecked ? 85 : targetPage ? 60 : 35;

    const components: OpportunityComponents = {
      intent: { value: intent, rationale: `${scores.length} sorunun ortalama ticari niyet puanı` },
      visibilityGap: { value: gap, rationale: `En güçlü rakip ${best.c.name} %${Math.round(best.p * 100)}, marka %${Math.round(brandP * 100)} (aynı soru kümesi, ${obs.length} başarılı yanıt)` },
      catalogFit: { value: catalogFitValue, rationale: catalogFitValue === null ? "Cluster kategorisi atanmadı — onaylı katalog eşleşmesi yok" : catalogFitValue === 100 ? `Katalogda "${cluster.category}" kategorisi var` : `Katalogda "${cluster.category}" bulunamadı` },
      evidenceStrength: { value: evidence, rationale: `${obs.length} başarılı tekrar, ${distinctSources} farklı kaynak, en yeni ${newestAgeDays} gün önce` },
      actionability: { value: actionability, rationale: targetChecked ? "Hedef sayfa tarandı ve somut düzeltme mümkün" : targetPage ? "Hedef sayfa var ama taranmadı" : "Hedef sayfa belirlenmedi" },
    };
    const s = opportunityScore(components);

    const sample = obs.find((o) => o.mentions.some((m) => m.entityId === best.c.id) && !o.mentions.some((m) => m.entityId === brand.id)) ?? obs[0]!;
    const compMention = sample.mentions.find((m) => m.entityId === best.c.id);
    const confidence = Math.min(0.9, 0.3 + Math.min(obs.length, 30) / 60);
    const diagnosis: DiagnosisStep[] = [
      {
        observation: { quote: compMention?.excerpt ?? (sample.rawText ?? "").slice(0, 200), url: sample.citations[0]?.url ?? null, sampledAt: sample.sampledAt.toISOString(), engine: sample.engine, observationId: sample.id },
        possibleCause:
          gapType === "citation_gap"
            ? `Rakip, ${citationGapDomains.slice(0, 3).map(([d]) => d).join(", ")} gibi üçüncü taraf kaynaklarda anılıyor; markanız bu kaynaklarda görünmüyor olabilir`
            : gapType === "catalog_mismatch"
              ? "Bu niyet için katalogda eşleşen kategori/ürün bulunamadı"
              : gapType === "missing_comparison"
                ? "Karşılaştırma/alternatif sorularında markanızı konumlandıran içerik eksik olabilir"
                : "Bu niyete doğrudan yanıt veren içerik eksik veya zayıf olabilir",
        verification: obs.length >= 10 ? "likely" : "insufficient_evidence",
        confidence: Math.round(confidence * 100) / 100,
        recommendation: ACTION_FOR_GAP[gapType],
      },
    ];

    const dedupeKey = opportunityDedupeKey(cluster.id, cluster.locale, gapType);
    const opp = await db.opportunity.upsert({
      where: { brandId_dedupeKey: { brandId, dedupeKey } },
      update: { score: s.score, provisional: s.provisional, components: components as object, confidence, diagnosis: diagnosis as object, recommendedAction: ACTION_FOR_GAP[gapType], targetUrl: targetPage },
      create: {
        workspaceId,
        brandId,
        clusterId: cluster.id,
        gapType,
        locale: cluster.locale,
        title: `${cluster.label}: ${best.c.name} öne çıkıyor`,
        score: s.score,
        provisional: s.provisional,
        components: components as object,
        confidence,
        diagnosis: diagnosis as object,
        recommendedAction: ACTION_FOR_GAP[gapType],
        targetUrl: targetPage,
        priority: (s.score ?? 0) >= 70 ? "high" : (s.score ?? 0) >= 45 ? "medium" : "low",
        paidBlockedReason: "Reklam hesabı bağlı değil veya erişim doğrulanmadı",
        dedupeKey,
      },
    });
    await db.opportunityEvidence.deleteMany({ where: { opportunityId: opp.id } });
    await db.opportunityEvidence.createMany({
      data: obs.slice(0, 8).map((o) => ({
        workspaceId,
        opportunityId: opp.id,
        observationId: o.id,
        quote: o.mentions.find((m) => m.entityId === best.c.id)?.excerpt ?? (o.rawText ?? "").slice(0, 160),
        pageUrl: o.citations[0]?.url ?? null,
      })),
    });
    upserted++;
  }

  // Structured-data fırsatı: readiness bulgularından (kanıt: taranan sayfa).
  const productPagesMissing = pages.filter((p) => p.pageType === "product" && !(p.findings as { productComplete?: boolean } | null)?.productComplete);
  if (productPagesMissing.length > 0 && clusters[0]) {
    const cluster = clusters.find((c) => c.type === "transactional") ?? clusters[0];
    const components: OpportunityComponents = {
      intent: { value: 70, rationale: "Ürün sayfaları satın alma niyetine doğrudan hizmet eder" },
      visibilityGap: { value: null, rationale: "Bu teknik bulgu görünürlük farkı ölçümünden türetilmedi" },
      catalogFit: { value: 100, rationale: "Etkilenen sayfalar kendi katalogunuzda" },
      evidenceStrength: { value: Math.min(100, productPagesMissing.length * 10), rationale: `${productPagesMissing.length} ürün sayfasında eksik Offer alanı` },
      actionability: { value: 90, rationale: "Şema alanları doğrudan düzeltilebilir" },
    };
    const s = opportunityScore(components);
    const dedupeKey = opportunityDedupeKey(cluster.id, cluster.locale, "structured_data");
    const opp = await db.opportunity.upsert({
      where: { brandId_dedupeKey: { brandId, dedupeKey } },
      update: { components: components as object, score: s.score, provisional: s.provisional },
      create: {
        workspaceId, brandId, clusterId: cluster.id, gapType: "structured_data", locale: cluster.locale,
        title: `${productPagesMissing.length} ürün sayfasında eksik fiyat/stok şeması`, score: s.score, provisional: s.provisional,
        components: components as object, confidence: 0.8,
        diagnosis: [{ observation: null, possibleCause: "Product şemasında Offer (fiyat/para birimi/stok) eksik", verification: "verified", confidence: 0.8, recommendation: ACTION_FOR_GAP.structured_data }] as object,
        recommendedAction: ACTION_FOR_GAP.structured_data, targetUrl: productPagesMissing[0]!.url, priority: "medium", dedupeKey,
        paidBlockedReason: "Reklam hesabı bağlı değil veya erişim doğrulanmadı",
      },
    });
    await db.opportunityEvidence.deleteMany({ where: { opportunityId: opp.id } });
    await db.opportunityEvidence.createMany({ data: productPagesMissing.slice(0, 8).map((p) => ({ workspaceId, opportunityId: opp.id, pageUrl: p.url, note: "Offer alanı eksik" })) });
    upserted++;
  }
  return { upserted };
}
