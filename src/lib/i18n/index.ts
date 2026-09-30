/**
 * Basit çeviri kataloğu: TR varsayılan, EN katalog. Ortak kabuk metinleri anahtarlarla gelir;
 * sayfa içi metinlerin kataloğa taşınması docs/progress.md'de açık iş olarak izlenir.
 */
const tr = {
  "nav.overview": "Genel bakış",
  "nav.clients": "Müşteriler",
  "nav.onboarding": "Kurulum",
  "nav.dashboard": "Pano",
  "nav.catalog": "Katalog",
  "nav.prompts": "Promptlar",
  "nav.visibility": "Görünürlük",
  "nav.competitors": "Rakipler",
  "nav.citations": "Kaynaklar",
  "nav.opportunities": "Fırsatlar",
  "nav.actions": "Aksiyonlar",
  "nav.revenue": "Gelir",
  "nav.ads": "Reklam",
  "nav.integrations": "Entegrasyonlar",
  "nav.reports": "Raporlar",
  "nav.settings": "Ayarlar",
  "nav.billing": "Abonelik",
  "nav.notifications": "Bildirimler",
  "nav.brand": "Marka",
  "nav.workspace": "Çalışma alanı",
  "common.demoData": "Örnek veri",
  "common.signOut": "Çıkış yap",
  "common.menu": "Menü",
  "common.close": "Kapat",
  "common.skip": "İçeriğe geç",
  "filters.range": "Tarih aralığı",
  "filters.engine": "Motor",
  "filters.allEngines": "Tüm motorlar",
  "filters.days": "{n} gün",
  "filters.timezone": "Saat dilimi",
} as const;

const en: Record<keyof typeof tr, string> = {
  "nav.overview": "Overview",
  "nav.clients": "Clients",
  "nav.onboarding": "Setup",
  "nav.dashboard": "Dashboard",
  "nav.catalog": "Catalog",
  "nav.prompts": "Prompts",
  "nav.visibility": "Visibility",
  "nav.competitors": "Competitors",
  "nav.citations": "Citations",
  "nav.opportunities": "Opportunities",
  "nav.actions": "Actions",
  "nav.revenue": "Revenue",
  "nav.ads": "Ads",
  "nav.integrations": "Integrations",
  "nav.reports": "Reports",
  "nav.settings": "Settings",
  "nav.billing": "Billing",
  "nav.notifications": "Notifications",
  "nav.brand": "Brand",
  "nav.workspace": "Workspace",
  "common.demoData": "Sample data",
  "common.signOut": "Sign out",
  "common.menu": "Menu",
  "common.close": "Close",
  "common.skip": "Skip to content",
  "filters.range": "Date range",
  "filters.engine": "Engine",
  "filters.allEngines": "All engines",
  "filters.days": "{n} days",
  "filters.timezone": "Time zone",
};

export type MessageKey = keyof typeof tr;
export type Locale = "tr" | "en";

export function t(key: MessageKey, locale: Locale = "tr", vars: Record<string, string | number> = {}): string {
  const s = (locale === "en" ? en : tr)[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
