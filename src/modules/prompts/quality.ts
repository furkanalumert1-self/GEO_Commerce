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

/**
 * Kategoriden tek amaçlı soru adayları (sırası sabit; ilk soru genel keşif). İki amacı birleştiren
 * ("hangi özellikler, hangi modeller") kalıplar kullanılmaz.
 */
export function purposeTemplates(category: string, country: string): Array<{ text: string; purpose: QuestionPurpose }> {
  const place = country === "TR" ? "Türkiye'de " : "";
  const c = lower(category.trim());
  const list: Array<{ text: string; purpose: QuestionPurpose }> = [
    { text: `${place}en iyi ${c} markaları hangileri?`, purpose: "brand_discovery" },
    { text: `${cap(c)} seçerken nelere dikkat etmeliyim?`, purpose: "need_based" },
    { text: `${cap(c)} türleri arasındaki farklar nelerdir?`, purpose: "comparison" },
    { text: `${place}kaliteli ${c} nereden alabilirim?`, purpose: "purchase" },
    { text: `${cap(c)} için hangi markaları önerirsin?`, purpose: "brand_discovery" },
  ];
  return list.map((x) => ({ ...x, text: cap(x.text.replace(/\s+/g, " ").trim()) }));
}

export function classifyPurpose(text: string): QuestionPurpose {
  const t = lower(text);
  if (/(fark|karşılaştır|mı .* mı|vs\.?|yoksa)/.test(t)) return "comparison";
  if (/(nereden|satın al|fiyat|uygun fiyat|hangi markalarda|sipariş)/.test(t)) return "purchase";
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
