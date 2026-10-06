/** Locale/currency/timezone biçimlendirme. Eksik veri "Ölçülemedi"; sıfır değil. */
export const NA = "Ölçülemedi";

export function fmtNumber(v: number | null | undefined, locale = "tr-TR", digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NA;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

/**
 * "36 yanıtın 10'unda" gibi: sayıya iyelik + bulunma eki (ünlü uyumu ve ünlüyle biten sayılarda "s" kaynaştırma).
 * Ek, sayının okunuşundaki son kelimeye göre seçilir (10 → on → 'unda, 3 → üç → 'ünde, 2 → iki → 'sinde).
 */
export function trOfCount(n: number): string {
  const units = ["ında", "inde", "sinde", "ünde", "ünde", "inde", "sında", "sinde", "inde", "unda"];
  const tens = ["", "unda", "sinde", "unda", "ında", "sinde", "ında", "inde", "inde", "ında"];
  const v = Math.abs(Math.trunc(n));
  const suffix = v === 0 ? "ında" : v % 10 ? units[v % 10] : v % 100 ? tens[(v % 100) / 10] : v % 1000 ? "ünde" : "inde";
  return `${n}'${suffix}`;
}

export function fmtPct(v: number | null | undefined, locale = "tr-TR", digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NA;
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits }).format(v);
}

export function fmtMoney(minor: bigint | number | string | null | undefined, currency: string, locale = "tr-TR"): string {
  if (minor === null || minor === undefined) return NA;
  const n = typeof minor === "bigint" ? Number(minor) : Number(minor);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n / 100);
}

export function fmtDate(d: Date | string | null | undefined, timeZone = "Europe/Istanbul", locale = "tr-TR", withTime = false): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale, { timeZone, day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
}

export function tzLabel(timeZone: string): string {
  return timeZone.replace("_", " ");
}

export const ENGINE_SHORT: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
  perplexity: "Perplexity",
  google_ai_overviews: "AI Overviews",
  copilot: "Copilot",
};

export const SURFACE_LABEL: Record<string, string> = {
  api_grounded: "API (web aramalı)",
  api_plain: "API (aramasız)",
  licensed_ui: "Lisanslı UI kaynağı",
};

export const GAP_LABEL: Record<string, string> = {
  intent_content: "Bu soruya yönelik içerik önerisi",
  missing_comparison: "Eksik karşılaştırma",
  catalog_mismatch: "Ürün grubu kataloğunuzda yok",
  technical_access: "Teknik erişim",
  citation_gap: "Diğer sitelerde görünürlük fırsatı",
  structured_data: "Ürün bilgisi işaretlemesi eksik",
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  queued: "Sırada",
  running: "Çalışıyor",
  partial: "Kısmen tamamlandı",
  succeeded: "Tamamlandı",
  failed: "Başarısız",
  canceled: "İptal edildi",
};

export const OPP_STATUS_LABEL: Record<string, string> = {
  new: "Yeni",
  triaged: "Değerlendirildi",
  in_progress: "Üzerinde çalışılıyor",
  measuring: "Ölçülüyor",
  won: "Kazanıldı",
  dismissed: "Kapatıldı",
};

export const ACTION_STATUS_LABEL: Record<string, string> = {
  draft: "Taslak",
  review: "İncelemede",
  approved: "Onaylandı",
  publishing: "Yayımlanıyor",
  published: "Yayımlandı",
  measuring: "Ölçülüyor",
  completed: "Tamamlandı",
  failed: "Başarısız",
  rejected: "Reddedildi",
  rolled_back: "Geri alındı",
};

export const CHANNEL_LABEL = (c: string) =>
  c.startsWith("ai_organic:") ? `AI organik · ${ENGINE_SHORT[c.split(":")[1]!] ?? c.split(":")[1]}` : c.startsWith("paid:") ? `Ücretli · ${c.split(":")[1]}` : ({ direct: "Doğrudan", organic_search: "Organik arama", referral: "Yönlendirme", unattributed: "İlişkilendirilemedi" } as Record<string, string>)[c] ?? c;

/** Şimdiden N gün önce (server tarafı sorgu penceresi). */
export function daysAgo(n: number, now = new Date()): Date {
  return new Date(now.getTime() - n * 86_400_000);
}

/**
 * Kayıtlı (geçmişte üretilmiş) öneri/neden metinlerini güncel kullanıcı diliyle gösterir. Veritabanı değişmez;
 * yalnız teknik terimler değiştirilir. Kanıt alıntılarına uygulanmaz (anlam değiştirilmez).
 */
export function plainStoredText(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  return s
    .replace(/Rakibi destekleyen üçüncü taraf kaynaklarda marka görünürlüğü için outreach görevi oluşturun/g, "İnceleme gerekli: rakibin anıldığı sitelerin markanızın yer alabileceği bir yayın, liste veya pazaryeri olup olmadığını kontrol edin; uygunsa ilgili yayınla iletişime geçin")
    .replace(/outreach hedefi/gi, "iletişim kurulabilecek site")
    .replace(/outreach görevi/gi, "ilgili yayınla iletişim görevi")
    .replace(/outreach/gi, "ilgili yayınla iletişim")
    .replace(/üçüncü taraf kaynak(lar)?/gi, (_m, pl) => (pl ? "diğer siteler" : "diğer site"))
    .replace(/Bu niyete/g, "Bu soru grubuna")
    .replace(/Bu niyet için/g, "Bu soru grubu için")
    .replace(/bu niyete/g, "bu soru grubuna")
    .replace(/bu niyet için/g, "bu soru grubu için")
    .replace(/ticari niyet/gi, "satın almaya yakınlık")
    .replace(/\bniyet(ler)?i?\b/gi, "soru grubu");
}
