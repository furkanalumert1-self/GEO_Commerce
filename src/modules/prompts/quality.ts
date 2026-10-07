import { MATERIALS, questionNoun } from "@/modules/audit/business";
/**
 * Soru kalitesi: amaç etiketi, ürün türü belirsizliği ve katalog uyumu. Sayısal "kalite puanı" üretilmez;
 * kullanıcıya "Uygun / Düzenleme gerekli" ve tek cümle neden gösterilir. Mevcut soruları değiştirmez.
 */
export type QuestionPurpose = "brand_discovery" | "need_based" | "comparison" | "purchase";

export const PURPOSE_LABEL: Record<QuestionPurpose, string> = {
  brand_discovery: "Marka keşfi",
  need_based: "İhtiyaca uygun seçim",
  comparison: "Karşılaştırma",
  purchase: "Satın almaya yakın seçim",
};

/** Amaç başına beklenen değerlendirme (sonuç yorumunda kullanılır). */
export const PURPOSE_EXPECTATION: Record<QuestionPurpose, string> = {
  brand_discovery: "Markanızın kendiliğinden anılıp önerilmediği ölçülür.",
  need_based: "Marka geçmesi beklenmez; sitenizin kaynak olarak kullanılması ölçülür.",
  comparison: "Karşılaştırma içeriğinizin kaynak gösterilmesi ölçülür; gerekirse marka önerisi.",
  purchase: "Ürün/marka önerisi ve ilgili sayfanızın gösterilmesi ölçülür.",
};

const lower = (s: string) => s.toLocaleLowerCase("tr-TR");
const cap = (s: string) => s.replace(/^./, (x) => x.toLocaleUpperCase("tr-TR"));

/** Soru kalıbı: aynı kalıbın kaç grupta kullanıldığını saymak için (kategori adından bağımsız). */
export type QuestionPattern = "best_brands" | "where_buy" | "attribute" | "compare_brands" | "recommend_brands" | "tips" | "types_diff" | "online_stores" | "budget" | "store_compare" | "options";

const PATTERNS: Array<[QuestionPattern, RegExp]> = [
  ["tips", /seçerken .*nelere dikkat etmeliyim\?$/],
  ["types_diff", /(türleri arasındaki farklar nelerdir|daha iyi)\?$/],
  ["attribute", /arıyorum; hangi (markaları|seçenekleri) önerirsin\?$/],
  ["best_brands", /en iyi .+ markaları hangileri\?$/],
  ["where_buy", /nereden alabilirim\?$/],
  ["compare_brands", /alırken hangi markaları karşılaştırmalıyım\?$|için hangi markaları karşılaştırabilirim\?$/],
  ["recommend_brands", /için hangi markaları önerirsin\?$/],
  ["online_stores", /satın alabileceğim online mağazalar hangileri\?$/],
  ["store_compare", /hangi online mağazaları karşılaştırabilirim\?$|geniş seçenek sunan online mağazalar hangileri\?$/],
  ["budget", /tl altı iyi bir .+ önerir misin\?$/],
  ["options", /alacağım; hangi seçenekleri değerlendirmeliyim\?$/],
];

export function questionPattern(text: string): QuestionPattern | null {
  const t = lower(text.trim());
  return PATTERNS.find(([, re]) => re.test(t))?.[0] ?? null;
}

/** Bilgi amaçlı kalıplar: yanıtta marka nadiren geçer; grup başına en çok bir tane önerilir. */
export const INFO_PATTERNS: QuestionPattern[] = ["tips", "types_diff"];

/** Grup ürün adlarında geçen malzeme/özellik (doğrulanmış; en sık geçen önce). */
export function groupAttributes(productNames: string[], max = 1): string[] {
  const names = productNames.map(lower);
  return MATERIALS.map((m) => ({ m, n: names.filter((x) => x.includes(m)).length }))
    .filter((x) => x.n > 0)
    .filter((x, i, all) => !all.some((o, j) => j < i && o.m.includes(x.m)))
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((x) => x.m);
}

/**
 * Kategoriden tek amaçlı soru adayları. Satın almaya yakın sorular önce; bilgi sorusu ("nelere dikkat") tek ve en
 * sonda. Katalogda doğrulanmış malzeme/özellik varsa somut soru eklenir ("kaz tüyü yastık arıyorum…"): bu
 * sorularda AI somut marka sayar, ölçüm daha ayırt edicidir. İki amacı birleştiren kalıplar kullanılmaz.
 */
export function purposeTemplates(category: string, country: string, opts: { attributes?: string[] } = {}): Array<{ text: string; purpose: QuestionPurpose; pattern: QuestionPattern }> {
  const place = country === "TR" ? "Türkiye'de " : "";
  const c = lower(category.trim());
  // Tamlamada tekil: "yemek takımı markaları", "yemek takımı türleri" ("yemek takımları markaları" değil).
  const n = questionNoun(c);
  const attr = opts.attributes?.find((a) => !n.includes(a));
  const list: Array<{ text: string; purpose: QuestionPurpose; pattern: QuestionPattern }> = [
    { text: `${place}en iyi ${n} markaları hangileri?`, purpose: "brand_discovery", pattern: "best_brands" },
    ...(attr ? [{ text: `${attr} ${n} arıyorum; hangi markaları önerirsin?`, purpose: "purchase" as const, pattern: "attribute" as const }] : []),
    { text: `${place}kaliteli ${c} nereden alabilirim?`, purpose: "purchase", pattern: "where_buy" },
    { text: `${cap(n)} alırken hangi markaları karşılaştırmalıyım?`, purpose: "comparison", pattern: "compare_brands" },
    { text: `${cap(c)} için hangi markaları önerirsin?`, purpose: "brand_discovery", pattern: "recommend_brands" },
    { text: `${cap(n)} seçerken nelere dikkat etmeliyim?`, purpose: "need_based", pattern: "tips" },
  ];
  return list.map((x) => ({ ...x, text: cap(x.text.replace(/\s+/g, " ").trim()) }));
}

export function classifyPurpose(text: string): QuestionPurpose {
  const t = lower(text);
  if (/(fark|karşılaştır|mı .* mı|vs\.?|yoksa)/.test(t)) return "comparison";
  if (/(nereden|satın al|fiyat|uygun fiyat|hangi markalarda|sipariş|arıyorum)/.test(t)) return "purchase";
  if (/(dikkat|nasıl seç|seçerken|kim için|hangisi uygun|ihtiyac)/.test(t)) return "need_based";
  return "brand_discovery";
}

/** Kullanım amacına göre farklı ürünlere kayabilen ürün türleri (katalogla netleştirilmeli). */
const AMBIGUOUS: Array<{ term: RegExp; clarifiers: RegExp; reason: string; suggest: string }> = [
  { term: /bebek yata[ğg]/, clarifiers: /(şilte|silte|karyola|beşik|besik|park yatak)/, reason: "“Bebek yatağı” şilte mi karyola/beşik mi belirsiz; yanıt farklı ürüne kayabilir", suggest: "bebek şiltesi" },
  { term: /\byast[ıi]k/, clarifiers: /(uyku|visco|ortopedik|boyun|lateks|elyaf|kaz tüyü|bebek)/, reason: "“Yastık” uyku yastığı mı dekoratif kırlent mi belirsiz", suggest: "uyku yastığı" },
  { term: /katlan[ıi]r koltuk/, clarifiers: /(misafir|ev içi|yatakl[ıi]|kamp)/, reason: "“Katlanır koltuk” ev içi misafir koltuğu mu kamp koltuğu mu belirsiz", suggest: "yataklı katlanır koltuk (ev içi)" },
  { term: /\bkoltuk\b/, clarifiers: /(oturma|köşe|berjer|tekli|üçlü|ikili|yatakl[ıi]|ofis|misafir)/, reason: "“Koltuk” türü belirsiz (oturma grubu, ofis, kamp)", suggest: "oturma grubu koltuk" },
];

export interface QualityResult {
  status: "ok" | "edit";
  purpose: QuestionPurpose;
  /** Kullanıcıya gösterilen tek cümle (neden önerildi veya neden düzenleme gerekli). */
  reason: string;
  /** Düzenleme gerekiyorsa önerilen metin (kullanıcı onaylar). */
  suggestion: string | null;
}

/**
 * Kalite kapısı: ürün uyumu (katalog varsa), açıklık (belirsiz ürün türü), amaç. Katalog yoksa uyum
 * "doğrulanmadı" olarak söylenir; varmış gibi işaretlenmez.
 */
export function questionQuality(text: string, ctx: { group: string; catalogTerms: string[]; catalogMatches: number | null }): QualityResult {
  const t = lower(text);
  const purpose = classifyPurpose(text);
  for (const a of AMBIGUOUS) {
    if (a.term.test(t) && !a.clarifiers.test(t)) {
      const suggestion = text.replace(new RegExp(a.term.source + "[a-zçğıöşü]*", "i"), a.suggest);
      return { status: "edit", purpose, reason: `${a.reason}. Ürününüze göre netleştirin.`, suggestion: suggestion !== text ? cap(suggestion) : null };
    }
  }
  if (ctx.catalogMatches === 0 && ctx.catalogTerms.length > 0) {
    return { status: "edit", purpose, reason: `Kataloğunuzda “${ctx.group}” grubuna ait ürün bulunamadı; bu ürünü satıyorsanız önce ürünlerinizi ekleyin.`, suggestion: null };
  }
  const why = ctx.catalogMatches && ctx.catalogMatches > 0 ? `Kataloğunuzda bu gruba ait ${ctx.catalogMatches} ürün var.` : "Ürün grubunuzdan hazırlandı (katalogla doğrulanmadı).";
  return { status: "ok", purpose, reason: `${why} ${PURPOSE_EXPECTATION[purpose]}`, suggestion: null };
}

/** Katalogda gruba ait ürün sayısı (ad/kategori eşleşmesi); katalog boşsa null (bilinmiyor). */
export function catalogMatchCount(group: string, catalog: Array<{ name: string; categories: string[] }>): number | null {
  if (!catalog.length) return null;
  const words = lower(group).split(/\s+/).filter((w) => w.length > 3).map((w) => w.slice(0, Math.max(4, w.length - 2)));
  if (!words.length) return null;
  return catalog.filter((p) => {
    const hay = lower(`${p.name} ${p.categories.join(" ")}`);
    return words.some((w) => hay.includes(w));
  }).length;
}
