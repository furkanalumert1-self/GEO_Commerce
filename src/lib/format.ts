/** Locale/currency/timezone biçimlendirme. Eksik veri "Ölçülemedi"; sıfır değil. */
export const NA = "Ölçülemedi";

export function fmtNumber(v: number | null | undefined, locale = "tr-TR", digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NA;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
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
  intent_content: "Niyet-içerik boşluğu",
  missing_comparison: "Eksik karşılaştırma",
  catalog_mismatch: "Katalog uyumsuzluğu",
  technical_access: "Teknik erişim",
  citation_gap: "Citation boşluğu",
  structured_data: "Yapılandırılmış veri",
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
