import type { PrismaClient } from "@/generated/prisma/client";
import { CHATGPT_ADS_SPEC, contextHints, policyIssues, type AdIssue } from "./chatgpt";

/**
 * ChatGPT Ads kampanya planı: hiç deneyimi olmayan bir markayı adım adım yönlendirir.
 * Rakip analizi ChatGPT Ads Manager'dan gelmez (OpenAI rakip/auction verisi yayınlamıyor); kendi
 * AI görünürlük ölçümlerimizden (hangi soruda hangi rakip anılıyor/öneriliyor) türetilir.
 */

/** E-ticaret için yayımlanmış sektör kıyasları (USD, 2026). Kesin değil; kendi hesabınızın verisi esas alınır. */
export const CHATGPT_ADS_BENCHMARKS = { currency: "USD", cpc: { low: 1.7, typical: 3, high: 5 }, cpm: { low: 25, typical: 45, high: 60 }, asOf: "2026-10" } as const;

export interface CompetitorInsight { id: string; name: string; domain: string; mentions: number; recommendations: number; shareOfAnswers: number; topPrompts: string[]; topSources: string[] }
export interface AdGroupPlan {
  clusterId: string;
  label: string;
  category: string | null;
  answers: number;
  brandMentioned: number;
  lostTo: Array<{ name: string; count: number }>;
  /** Bu reklam grubunun dayandığı ölçülen sorular (en fazla 5). */
  prompts: string[];
  /** Soru bazında yanıt sayıları (plana hangi soruların dahil olacağını kullanıcı seçer). */
  promptStats: Array<{ text: string; answers: number; brand: number; lost: number }>;
  priority: "yüksek" | "orta" | "düşük";
  hints: string[];
  competitorHints: string[];
  copies: Array<{ title: string; body: string }>;
}
export interface BudgetTier { key: "test" | "standard" | "growth"; label: string; dailyClicks: number; dailyBudget: number; days: number; total: number; maxCpc: number; description: string }
export interface PlanStep { key: string; title: string; status: "done" | "todo" | "blocked" | "info"; detail: string }

const lower = (s: string) => s.toLocaleLowerCase("tr-TR");
const fit = (s: string, max: number) => ([...s].length <= max ? s : `${[...s].slice(0, max - 1).join("").replace(/\s+\S*$/, "")}…`);
/** Sınıra sığan ilk aday (kesik "…" metin reklamda kötü görünür); hiçbiri sığmazsa son aday kısaltılır. */
const firstFit = (cands: string[], max: number) => cands.find((c) => [...c].length <= max) ?? fit(cands[cands.length - 1]!, max);

/** Kural tabanlı metin önerileri (sınırlar içinde, kanıtsız iddia içermez). Kullanıcı düzenler. */
export function copySuggestions(brand: string, category: string, usps: string[] = []): Array<{ title: string; body: string }> {
  const c = category.trim();
  const cl = lower(c);
  const usp = usps.map((u) => u.trim()).filter(Boolean);
  // Kategori tekil ("Güneş kremi") veya çoğul ("Nemlendiriciler") olabilir; tamlama kurmayan kalıplar kullanılır.
  const out = [
    { title: `${brand} ${c}`, body: `${c} için ölçü, özellik ve fiyatları karşılaştırın; size uygun olanı seçin` },
    { title: `${c} | ${brand}`, body: usp[0] ? `${usp[0]}. ${c} için seçenekleri karşılaştırın` : `${c} için ihtiyacınıza uygun seçenekleri inceleyin` },
    { title: `${brand}: ${cl}`, body: usp[1] ? `${usp[1]}. ${c} için size uygun seçenekler` : `${c} seçerken özellikleri ve fiyatları yan yana görün` },
  ];
  return out.map((x) => ({ title: fit(x.title, CHATGPT_ADS_SPEC.title.max), body: fit(x.body, CHATGPT_ADS_SPEC.body.max) }));
}

/** Bütçe kademeleri: öğrenme için yeterli tıklama hedefi × tahmini TBM. Reklam grubu sayısı arttıkça ölçeklenir. */
export function budgetTiers(adGroups: number, benchmarks = CHATGPT_ADS_BENCHMARKS): BudgetTier[] {
  const g = Math.max(1, Math.min(adGroups, 3));
  const cpc = benchmarks.cpc.typical;
  const startBid = Math.round(cpc * 0.8 * 100) / 100;
  const tier = (key: BudgetTier["key"], label: string, perGroup: number, days: number, description: string): BudgetTier => {
    const dailyClicks = perGroup * g;
    const dailyBudget = Math.round(dailyClicks * cpc);
    return { key, label, dailyClicks, dailyBudget, days, total: dailyBudget * days, maxCpc: startBid, description };
  };
  return [
    tier("test", "Keşif testi (önerilen başlangıç)", 8, 14, "Hangi sohbet bağlamının tıklama ve satış getirdiğini öğrenmek için en düşük anlamlı bütçe. 14 günde yaklaşık 100+ tıklama/reklam grubu hedeflenir."),
    tier("standard", "Standart", 15, 30, "Testte dönüşüm getiren reklam gruplarına bütçeyi kaydırarak 1 aylık düzenli görünürlük."),
    tier("growth", "Büyüme", 30, 30, "Dönüşüm maliyeti hedefin altındaysa; bütçeyi haftada en fazla %20 artırarak ölçekleyin."),
  ];
}

export async function buildChatgptAdsPlan(db: PrismaClient, ids: { workspaceId: string; brandId: string }, opts: { usps?: string[]; days?: number } = {}) {
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000);
  const brand = await db.brand.findUniqueOrThrow({ where: { id: ids.brandId }, select: { id: true, name: true, domain: true, country: true, categories: true, trackerSiteKey: true } });
  const [competitors, observations, products, accounts, visitorSessions] = await Promise.all([
    db.competitor.findMany({ where: { brandId: ids.brandId, confirmedAt: { not: null }, archivedAt: null }, select: { id: true, name: true, domain: true } }),
    db.observation.findMany({
      where: { workspaceId: ids.workspaceId, brandId: ids.brandId, status: "succeeded", sampledAt: { gte: since } },
      select: { id: true, promptVersion: { select: { text: true, prompt: { select: { cluster: { select: { id: true, label: true, category: true } } } } } }, mentions: { select: { entityId: true, kind: true } }, citations: { select: { domain: true, entityId: true } } },
      take: 2000,
    }),
    db.product.findMany({ where: { brandId: ids.brandId, active: true }, select: { name: true }, take: 10 }),
    db.adsAccount.findMany({ where: { brandId: ids.brandId, workspaceId: ids.workspaceId }, select: { provider: true, accessStatus: true } }),
    db.visitorSession.count({ where: { brandId: ids.brandId } }).catch(() => 0),
  ]);
  const compById = new Map(competitors.map((c) => [c.id, c]));
  const positive = (k: string) => k !== "negative";

  // Rakip analizi (organik AI yanıtlarından).
  const insights: CompetitorInsight[] = competitors.map((c) => {
    const withC = observations.filter((o) => o.mentions.some((m) => m.entityId === c.id && positive(m.kind)));
    const prompts = new Map<string, number>();
    const sources = new Map<string, number>();
    for (const o of withC) {
      prompts.set(o.promptVersion.text, (prompts.get(o.promptVersion.text) ?? 0) + 1);
      for (const ct of o.citations) sources.set(ct.domain, (sources.get(ct.domain) ?? 0) + 1);
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    return {
      id: c.id,
      name: c.name,
      domain: c.domain,
      mentions: withC.length,
      recommendations: observations.filter((o) => o.mentions.some((m) => m.entityId === c.id && m.kind === "recommendation")).length,
      shareOfAnswers: observations.length ? Math.round((withC.length / observations.length) * 1000) / 10 : 0,
      topPrompts: top(prompts),
      topSources: top(sources),
    };
  }).sort((a, b) => b.mentions - a.mentions);

  // Reklam grubu = niyet kümesi (kategori). Kaybedilen yanıt sayısına göre öncelik.
  const byCluster = new Map<string, { label: string; category: string | null; prompts: Set<string>; answers: number; brand: number; lost: Map<string, number>; perPrompt: Map<string, { answers: number; brand: number; lost: number }> }>();
  for (const o of observations) {
    const cl = o.promptVersion.prompt.cluster;
    const e = byCluster.get(cl.id) ?? { label: cl.label, category: cl.category, prompts: new Set<string>(), answers: 0, brand: 0, lost: new Map<string, number>(), perPrompt: new Map() };
    e.answers++;
    e.prompts.add(o.promptVersion.text);
    const pp = e.perPrompt.get(o.promptVersion.text) ?? { answers: 0, brand: 0, lost: 0 };
    pp.answers++;
    const brandHit = o.mentions.some((m) => m.entityId === brand.id && positive(m.kind));
    if (brandHit) {
      e.brand++;
      pp.brand++;
    } else {
      for (const m of o.mentions) if (compById.has(m.entityId) && positive(m.kind)) e.lost.set(m.entityId, (e.lost.get(m.entityId) ?? 0) + 1);
      if (o.mentions.some((m) => compById.has(m.entityId) && positive(m.kind))) pp.lost++;
    }
    e.perPrompt.set(o.promptVersion.text, pp);
    byCluster.set(cl.id, e);
  }
  const productNames = products.map((p) => p.name);
  const adGroups: AdGroupPlan[] = [...byCluster.entries()]
    .map(([clusterId, e]) => {
      const lostTotal = [...e.lost.values()].reduce((a, b) => a + b, 0);
      const category = e.category ?? e.label;
      const lostTo = [...e.lost.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ name: compById.get(id)!.name, count }));
      return {
        clusterId,
        label: e.label,
        category: e.category,
        answers: e.answers,
        brandMentioned: e.brand,
        lostTo,
        prompts: [...e.prompts].slice(0, 5),
        promptStats: [...e.perPrompt.entries()].map(([text, v]) => ({ text, ...v })).sort((a, b) => b.lost - a.lost || b.answers - a.answers).slice(0, 10),
        priority: (lostTotal >= 2 && e.brand === 0 ? "yüksek" : lostTotal >= 1 ? "orta" : "düşük") as AdGroupPlan["priority"],
        hints: contextHints({ prompts: [...e.prompts], category, products: productNames }),
        competitorHints: lostTo.slice(0, 3).map((c) => `${lower(c.name)} alternatifi ${lower(category)}`),
        copies: copySuggestions(brand.name, category, opts.usps),
      };
    })
    .sort((a, b) => ["yüksek", "orta", "düşük"].indexOf(a.priority) - ["yüksek", "orta", "düşük"].indexOf(b.priority) || b.answers - a.answers);

  // Ölçüm yapılmamışsa kategorilerden başlangıç reklam grupları önerilir.
  if (!adGroups.length) {
    for (const c of brand.categories.slice(0, 3)) {
      adGroups.push({ clusterId: `category:${c}`, label: c, category: c, answers: 0, brandMentioned: 0, lostTo: [], prompts: [], promptStats: [], priority: "orta", hints: contextHints({ prompts: [], category: c, products: productNames }), competitorHints: [], copies: copySuggestions(brand.name, c, opts.usps) });
    }
  }

  const market = CHATGPT_ADS_SPEC.markets[brand.country];
  const policy: AdIssue[] = policyIssues(brand.categories, brand.country);
  const account = accounts.find((a) => a.provider === "openai" || a.provider === "chatgpt");
  const steps: PlanStep[] = [
    { key: "eligibility", title: "Uygunluk", status: !market?.available || policy.some((p) => p.level === "error") ? "blocked" : "done", detail: market?.available ? `${brand.country} pazarı açık (${market.since}); ${policy.length ? policy.map((p) => p.message).join("; ") : "kategori politikası uygun"}` : `${brand.country} pazarı için self-serve erişim doğrulanmadı` },
    { key: "account", title: "Reklam hesabı", status: account?.accessStatus === "active" ? "done" : "todo", detail: account ? `Hesap durumu: ${account.accessStatus}` : "ads.openai.com'da işletme hesabı açın: şirket doğrulaması, ödeme yöntemi, logo (32×32'de okunur) ve işletme alan adı" },
    { key: "measurement", title: "Ölçüm", status: visitorSessions > 0 ? "done" : "todo", detail: visitorSessions > 0 ? "Ölçüm etiketi veri gönderiyor" : "Satışları görebilmek için Entegrasyon sayfasındaki ölçüm etiketini siteye ekleyin; Ads Manager'da OpenAI pikseli/Conversions API ile satın alma olayını kurun" },
    { key: "structure", title: "Kampanya yapısı", status: adGroups.length ? "done" : "todo", detail: `${Math.min(adGroups.length, 3)} reklam grubuyla başlayın (her kategori/niyet ayrı grup); bağlam ipuçları hazır` },
    { key: "creative", title: "Reklam metni ve görsel", status: "todo", detail: `Her gruba 2–3 metin varyasyonu; kare görsel (≥${CHATGPT_ADS_SPEC.image.minPxApi}px, görselde yazı yok); hedef URL ilgili kategori sayfası olsun` },
    { key: "budget", title: "Bütçe ve teklif", status: "todo", detail: "Keşif testiyle başlayın; maks. TBM'yi kıyasın biraz altında açın, 3 gün sonra gösterim azsa %10–20 artırın" },
    { key: "launch", title: "Yayın", status: "todo", detail: "Kampanya duraklatılmış oluşturulur; kontrol listesini tamamlayıp etkinleştirin" },
    { key: "optimize", title: "İlk 14 gün izleme", status: "info", detail: "Gösterim, TBM, TO ve satın almaları izleyin; dönüşüm getirmeyen bağlam ipuçlarını çıkarın, getireni ayrı gruba alın" },
  ];

  return {
    brand: { name: brand.name, domain: brand.domain, country: brand.country },
    market,
    policy,
    competitorInsights: insights,
    adGroups,
    budget: budgetTiers(adGroups.length),
    benchmarks: CHATGPT_ADS_BENCHMARKS,
    sample: { answers: observations.length, days: opts.days ?? 30 },
    steps,
  };
}

export interface AdDraft {
  key: "discover" | "need" | "gift" | "compare";
  angle: string;
  title: string;
  body: string;
  cta: string;
  /** Taslakta kullanılan doğrulanmış ürün bilgileri (açılır "Kullanılan ürün bilgileri"). */
  facts: string[];
}

const COLOR_WORDS = /\b(beyaz|ekru|natural|naturel|antrasit|kil|mavi|marın mavı|lacivert|bej|gri|siyah|renkli|karışık|karisik|asorti|pembe|yeşil|kırmızı|sarı|turuncu|mor|kahverengi|krem|vizon|bordo)\b/gi;
const DRAFT_MATERIALS = ["%100 pamuk", "pamuk", "bambu", "keten", "porselen", "seramik", "cam", "ahşap", "metal", "kadife", "saten", "deri", "yün", "organik"];

/** "Solıd Bambu Yüz Havlusu 50X90 Cm Ekru" → "yüz havlusu" (ölçü/renk ve ürün adı öncesi atılır; son iki kelime). */
export function productTypePhrase(name: string): string | null {
  const base = name.split(/\s[-–]\s/)[0]!.replace(/\b\d[\d.,x×*/ ]*\s*(cm|mm|ml|lt|gr|g|kg|cc|gb|tb|mb|mah|hz|w|inç|inch|adet|li|lü|lu|lık|lik)?\b/gi, " ").replace(/\S*\d\S*/g, " ").replace(COLOR_WORDS, " ").replace(/[%()/]+/g, " ").replace(/\s+/g, " ").trim();
  const words = base.split(" ").filter((w) => w.length > 1);
  if (words.length < 2) return null;
  return words.slice(-2).join(" ").toLocaleLowerCase("tr-TR");
}

/**
 * Reklam grubu için 3 farklı açıdan taslak: ürün keşfi / kullanım ihtiyacı / hediye (yalnız set ürünü varsa) veya
 * karşılaştırma. Yalnız doğrulanmış ürün adlarından türetilen ürün tipi, malzeme (≥2 üründe) ve ölçü bilgisi
 * kullanılır; fiyat, indirim, stok, "en iyi" veya performans iddiası eklenmez. Ürün yoksa genel taslak (işaretli).
 */
export function adDrafts(input: { brand: string; label: string; products: string[] }): AdDraft[] {
  const L = input.label.trim();
  const lowerL = lower(L);
  const capL = L.charAt(0).toLocaleUpperCase("tr-TR") + L.slice(1);
  const names = input.products.map((n) => n.trim()).filter(Boolean);
  const lowNames = names.map((n) => lower(n));
  const typeCount = new Map<string, number>();
  for (const n of names) {
    const t = productTypePhrase(n);
    if (t) typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
  }
  // Birden çok üründe tekrar eden ifade ürün tipidir; tek seferlik ifade çoğu zaman marka/model adıdır (ör. "apple iphone").
  const types = [...typeCount.entries()].filter(([, c]) => names.length < 2 || c >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 2);
  const materials = DRAFT_MATERIALS.filter((m) => lowNames.filter((n) => n.includes(m)).length >= 2).filter((m, i, all) => !all.some((o, j) => j < i && o.includes(m))).slice(0, 2);
  const sized = lowNames.filter((n) => /\d+\s*[x×]\s*\d+|\d+\s*cm\b/.test(n)).length >= 2;
  const sets = lowNames.filter((n) => /\bset(i|leri)?\b/.test(n));
  // "dekoratif obje" + "dekoratif kase" → "dekoratif obje ve kase"
  const typePair = types.length >= 2 ? (types[0]!.split(" ")[0] === types[1]!.split(" ")[0] ? `${types[0]} ve ${types[1]!.split(" ").slice(1).join(" ")}` : `${types[0]} ve ${types[1]}`) : (types[0] ?? null);
  const facts: string[] = [];
  if (types.length) facts.push(`Ürün tipleri (ürün adlarından): ${types.join(", ")}`);
  if (materials.length) facts.push(`Malzeme (en az iki üründe): ${materials.join(", ")}`);
  if (sized) facts.push("Ölçü bilgisi ürün adlarında var");
  if (sets.length) facts.push(`Set ürünü: ${sets.length} ürün`);
  if (names.length) facts.push(`Örnek ürünler: ${names.slice(0, 3).join("; ")}`);
  const capFirst = (s: string) => s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
  // Uzun grup adında kısa ad: son iki kelime ("Tek Kişilik Nevresim Takımı" → "Nevresim Takımı").
  const shortL = [...L].length > 20 ? L.split(/\s+/).slice(-2).join(" ") : L;
  const capShort = capFirst(shortL);
  const lowerShort = lower(shortL);
  const T = CHATGPT_ADS_SPEC.title.max;
  const Bm = CHATGPT_ADS_SPEC.body.max;
  const f = (d: Omit<AdDraft, "title" | "body"> & { title: string[]; body: string[] }): AdDraft => ({ ...d, title: firstFit(d.title, T), body: firstFit(d.body, Bm) });
  const drafts: AdDraft[] = [
    f({
      key: "discover",
      angle: "Ürün keşfi",
      title: [`${input.brand} ${capL}`, capL, `${input.brand} ${capShort}`],
      body: [`${capFirst(typePair ?? lowerL)} seçeneklerini keşfedin; size uygun modeli seçin.`, `${capFirst(typePair ?? lowerShort)} seçeneklerini keşfedin.`],
      cta: "Ürünleri incele",
      facts,
    }),
    f({
      key: "need",
      angle: "Kullanım ihtiyacı",
      title: [`${capL}: ihtiyacınıza göre seçin`, `${capL}: size uygun model`, `${capShort}: ihtiyacınıza göre seçin`, `${capShort}: size uygun model`],
      body: materials.length
        ? [`${capFirst(materials.join(" ve "))} seçenekleri arasından kullanımınıza uygun ${lowerL} modelini bulun${sized ? "; ölçüleri karşılaştırın" : ""}.`, `${capFirst(materials.join(" ve "))} seçenekleri arasından size uygun ${lowerShort} modelini bulun.`]
        : [`Kullanım alanınıza${sized ? " ve ölçüye" : ""} göre ${lowerL} modellerini inceleyin; size uygun olanı seçin.`, `Kullanımınıza göre ${lowerShort} modellerini inceleyin; size uygun olanı seçin.`],
      cta: "Modelleri karşılaştır",
      facts,
    }),
    sets.length
      ? f({ key: "gift", angle: "Hediye", title: [`Hediyelik ${lowerL} setleri`, `Hediyelik ${lowerShort} setleri`], body: [`${input.brand} ${lowerL} setlerini inceleyin; sevdiklerinize uygun seti seçin.`, `${capFirst(lowerShort)} setlerini inceleyin; sevdiklerinize uygun seti seçin.`], cta: "Setleri gör", facts })
      : f({ key: "compare", angle: "Karşılaştırma", title: [`${capL} modellerini karşılaştırın`, `${capShort} modellerini karşılaştırın`, `${capShort}: karşılaştırın`], body: [`${input.brand} ${lowerL} modellerini yan yana görün; özelliklere göre size uygun olanı seçin.`, `${capFirst(lowerL)} modellerini yan yana görün; size uygun olanı seçin.`, `${capFirst(lowerShort)} modellerini yan yana görün; size uygun olanı seçin.`], cta: "Karşılaştır", facts }),
  ];
  return drafts;
}
