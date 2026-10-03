/**
 * Giriş bağlantısı her zaman APP_URL (canlı alan adı) üzerinden verilir. İstek Vercel'in deploy'a özel,
 * Vercel girişiyle korunan adresinden (geocommerce-xxxx.vercel.app) yapılmış olsa bile kullanıcı korumaya takılmaz.
 * Doğrulama token'ı veritabanında tutulduğu için callback başka host'ta sorunsuz tamamlanır.
 */
export function canonicalLoginUrl(raw: string, appUrl: string): string {
  let app: URL;
  try {
    app = new URL(appUrl);
  } catch {
    return raw;
  }
  if (/^(localhost|127\.|0\.0\.0\.0)/.test(app.hostname)) return raw;
  const u = new URL(raw);
  const oldOrigin = u.origin;
  if (oldOrigin === app.origin) return raw;
  const out = new URL(`${u.pathname}${u.search}`, app.origin);
  const cb = out.searchParams.get("callbackUrl");
  if (cb?.startsWith(oldOrigin)) out.searchParams.set("callbackUrl", `${app.origin}${cb.slice(oldOrigin.length)}`);
  return out.toString();
}
