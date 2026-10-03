/**
 * ChatGPT Ads (OpenAI Ads) taslak kuralları. Kaynak: OpenAI Ads Manager / Ads API dokümantasyonu ve
 * yardım merkezi, Ekim 2026 itibarıyla. Kurallar değişebilir; nihai doğrulama Ads Manager/API'dedir
 * (validatedBy: "local_spec"). Sağlayıcı hesabı bağlanmadan kampanya oluşturulmaz.
 */
export const CHATGPT_ADS_SPEC = {
  version: "2026-10",
  title: { max: 50, recommended: [16, 24] as const },
  body: { max: 100, recommended: [32, 48] as const },
  image: { square: true, minPxApi: 640, minPxManager: 256, formats: ["png", "jpg", "webp"], noTextInImage: true },
  contextHintsMax: 2000,
  /** Self-serve erişimin açık olduğu pazarlardan bu üründe kullanılanlar (TR: 17 Eylül 2026, yalnız bağlamsal). */
  markets: { TR: { available: true, since: "2026-09-17", personalization: false }, US: { available: true, since: "2026-05-05", personalization: true } } as Record<string, { available: boolean; since: string; personalization: boolean }>,
  plansShowingAds: ["Free", "Go"],
} as const;

export type IssueLevel = "error" | "warning" | "info";
export interface AdIssue { level: IssueLevel; field: string; message: string }

const PROHIBITED: Array<[RegExp, string]> = [
  [/\b(alkol|bira|şarap|viski|rakı|alcohol|wine|beer)\b/i, "Alkol"],
  [/\b(sigara|tütün|nikotin|elektronik sigara|vape|tobacco|nicotine)\b/i, "Tütün/nikotin"],
  [/\b(silah|tabanca|tüfek|mühimmat|weapon|firearm)\b/i, "Silah"],
  [/\b(bahis|kumar|casino|kazino|iddaa|gambling|betting)\b/i, "Kumar/bahis"],
  [/\b(kripto|bitcoin|coin|token satışı|crypto)\b/i, "Kripto teklifleri"],
  [/\b(yetişkin|erotik|adult|porn)\w*/i, "Yetişkin içerik"],
  [/\b(seçim|parti|aday|oy ver|political|election)\b/i, "Siyasi reklam"],
];
const RESTRICTED: Array<[RegExp, string]> = [
  [/\b(sağlık|ilaç|takviye|klinik|hastane|diş|tedavi|zayıflama|medical|health|supplement)\w*/i, "Sağlık (ABD dışında genellikle yasak, ABD'de vaka bazlı inceleme)"],
  [/\b(kredi|borç|faiz|yatırım|sigorta|finans|loan|credit|insurance)\w*/i, "Finansal hizmetler (sıkı inceleme)"],
  [/\b(avukat|hukuk|dava|legal|lawyer)\w*/i, "Hukuki hizmetler (ABD dışında yasak)"],
];

/** Marka kategorileri/metinden politika riski: yasak kategori → hata, kısıtlı → uyarı. */
export function policyIssues(texts: string[], country: string): AdIssue[] {
  const joined = texts.join(" ");
  const out: AdIssue[] = [];
  for (const [re, label] of PROHIBITED) if (re.test(joined)) out.push({ level: "error", field: "policy", message: `${label}: ChatGPT Ads'te yasak kategori` });
  for (const [re, label] of RESTRICTED) if (re.test(joined)) out.push({ level: country === "US" ? "warning" : "error", field: "policy", message: label });
  return out;
}

const len = (s: string) => [...s].length;

export function validateChatgptAd(i: { title: string; body: string; targetUrl: string; brandDomain: string; country: string; categories: string[] }): AdIssue[] {
  const issues: AdIssue[] = [];
  const t = len(i.title.trim());
  const b = len(i.body.trim());
  const S = CHATGPT_ADS_SPEC;
  if (t > S.title.max) issues.push({ level: "error", field: "title", message: `Başlık ${t} karakter; en fazla ${S.title.max}` });
  else if (t < S.title.recommended[0] || t > S.title.recommended[1]) issues.push({ level: "warning", field: "title", message: `Önerilen başlık uzunluğu ${S.title.recommended[0]}–${S.title.recommended[1]} karakter (şu an ${t})` });
  if (b > S.body.max) issues.push({ level: "error", field: "body", message: `Metin ${b} karakter; en fazla ${S.body.max}` });
  else if (b < S.body.recommended[0] || b > S.body.recommended[1]) issues.push({ level: "warning", field: "body", message: `Önerilen metin uzunluğu ${S.body.recommended[0]}–${S.body.recommended[1]} karakter (şu an ${b})` });
  if (/(!{2,}|\b(en iyi|1 numara|garantili|kesin|mucize)\b)/i.test(`${i.title} ${i.body}`)) issues.push({ level: "warning", field: "body", message: "Abartılı/kanıtsız iddia: landing sayfasında desteklenmeyen iddialar reddedilir" });
  if (/^[A-ZÇĞİÖŞÜ\s\d!?.,]{8,}$/.test(i.title.trim())) issues.push({ level: "warning", field: "title", message: "Tamamı büyük harf başlık önerilmez" });
  try {
    const host = new URL(i.targetUrl).hostname.replace(/^www\./, "");
    if (host !== i.brandDomain && !host.endsWith(`.${i.brandDomain}`)) issues.push({ level: "error", field: "targetUrl", message: "Hedef URL doğrulanmış işletme alan adında olmalı" });
    if (new URL(i.targetUrl).protocol !== "https:") issues.push({ level: "error", field: "targetUrl", message: "Hedef URL https olmalı" });
  } catch {
    issues.push({ level: "error", field: "targetUrl", message: "Geçersiz hedef URL" });
  }
  const market = S.markets[i.country];
  if (!market?.available) issues.push({ level: "error", field: "market", message: `${i.country} pazarı için self-serve erişim doğrulanmadı` });
  else if (!market.personalization) issues.push({ level: "info", field: "market", message: `${i.country}: reklamlar yalnız sohbet bağlamı, genel konum ve cihaza göre gösterilir (kişiselleştirme yok)` });
  issues.push(...policyIssues([...i.categories, i.title, i.body], i.country));
  issues.push({ level: "info", field: "image", message: `Kare görsel gerekli (API için en az ${S.image.minPxApi}×${S.image.minPxApi}, PNG/JPG/WEBP); görselde metin kullanmayın` });
  return issues;
}

/**
 * Bağlam ipuçları (context_hints): anahtar kelime değil, ürün/kullanım durumu açıklamaları.
 * GEO'da kaybedilen ticari sorulardan ve kategori/ürün adlarından türetilir.
 */
export function contextHints(input: { prompts: string[]; category: string | null; products: string[] }, max = 30): string[] {
  const out = new Set<string>();
  for (const p of input.prompts) {
    const clean = p.replace(/^Türkiye'de\s+/i, "").replace(/\?$/, "").trim();
    if (clean.length >= 8) out.add(clean.charAt(0).toLocaleLowerCase("tr-TR") + clean.slice(1));
  }
  if (input.category) {
    const c = input.category.toLocaleLowerCase("tr-TR");
    for (const t of [`${c} satın alma`, `${c} modelleri karşılaştırma`, `${c} nasıl seçilir`, `uygun fiyatlı ${c}`]) out.add(t);
  }
  for (const n of input.products.slice(0, 10)) out.add(n.toLocaleLowerCase("tr-TR"));
  return [...out].slice(0, Math.min(max, CHATGPT_ADS_SPEC.contextHintsMax));
}

/** OpenAI Ads API gövdeleri (campaign → ad_group → ad). Her şey "paused"; görsel file_id yüklemeden sonra eklenir. */
export function apiPayload(i: { name: string; country: string; dailyBudget?: number; maxCpc?: number; title: string; body: string; targetUrl: string; hints: string[] }) {
  const micros = (v?: number) => (v === undefined ? undefined : Math.round(v * 1_000_000));
  return {
    campaign: { name: i.name, status: "paused", daily_spend_limit_micros: micros(i.dailyBudget), targeting: { locations: { countries: [i.country] }, platforms: { included: ["web", "ios_app", "android_app"] } } },
    ad_group: { name: `${i.name} · bağlam`, status: "paused", bidding: { type: "clicks", strategy: "fixed_bid", max_bid_micros: micros(i.maxCpc) }, context_hints: i.hints },
    ad: { status: "paused", format: "chat_card", title: i.title.trim(), body: i.body.trim(), target_url: i.targetUrl, file_id: "<Ads Manager'a kare görsel yükleyip file_id ekleyin>" },
    notes: ["Para birimi ad hesabının para birimidir; micros = tutar × 1.000.000", "Kampanya duraklatılmış oluşturulur; aktivasyon ayrı onay gerektirir"],
  };
}
