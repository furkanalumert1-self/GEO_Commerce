import { config, type AppConfig } from "@/lib/config";

/**
 * Demo ayrımı: örnek veri (fixture) yalnız DEMO_MODE açıkken ve açıkça demo olarak işaretlenmiş
 * workspace'te / `.example` örnek alan adında kullanılır. Gerçek workspace'te gerçek sağlayıcı
 * başarısız olursa mock'a düşülmez; hata veya "veri yok" gösterilir.
 */
export const isDemoDomain = (domain: string) => domain.toLowerCase().endsWith(".example");
export const isDemoEmail = (email: string | null | undefined) => Boolean(email && email.toLowerCase().endsWith("@demo.example"));

export function fixturesAllowed(ws: { isDemo: boolean }, cfg: AppConfig = config()): boolean {
  return cfg.DEMO_MODE && ws.isDemo;
}

/** Hesapsız public audit: yalnız `.example` örnek alan adı ve DEMO_MODE ile örnek veri. */
export function demoAudit(domain: string, cfg: AppConfig = config()): boolean {
  return cfg.DEMO_MODE && isDemoDomain(domain);
}
