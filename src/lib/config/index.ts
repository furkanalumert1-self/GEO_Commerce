import { z } from "zod";

/**
 * Web ve worker aynı doğrulanmış config'i kullanır (§14).
 * Boş string'ler "tanımsız" kabul edilir; kapalı özelliğin env'i zorunlu değildir.
 */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL zorunlu"),
  REDIS_URL: optional,
  AUTH_SECRET: optional,
  AUTH_GOOGLE_ID: optional,
  AUTH_GOOGLE_SECRET: optional,
  EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
  SMTP_URL: optional,
  EMAIL_FROM: optional,
  RESEND_API_KEY: optional,
  STORAGE_ENDPOINT: optional,
  STORAGE_REGION: optional,
  STORAGE_BUCKET: optional,
  STORAGE_ACCESS_KEY_ID: optional,
  STORAGE_SECRET_ACCESS_KEY: optional,
  SECRETS_KEY_ID: optional,
  SECRETS_ENCRYPTION_KEY: optional,
  BILLING_PROVIDER: z.enum(["stripe", "none"]).default("stripe"),
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_PRICE_STARTER: optional,
  STRIPE_PRICE_GROWTH: optional,
  STRIPE_PRICE_COMMERCE: optional,
  STRIPE_PRICE_AGENCY: optional,
  OPENAI_API_KEY: optional,
  OPENAI_MONITOR_MODEL: optional,
  GENERATION_PROVIDER: z.enum(["openai"]).default("openai"),
  GENERATION_MODEL: optional,
  GOOGLE_AI_API_KEY: optional,
  GOOGLE_MONITOR_MODEL: optional,
  PERPLEXITY_API_KEY: optional,
  PERPLEXITY_MONITOR_MODEL: optional,
  LICENSED_MONITOR_BASE_URL: optional,
  LICENSED_MONITOR_API_KEY: optional,
  SHOPIFY_CLIENT_ID: optional,
  SHOPIFY_CLIENT_SECRET: optional,
  IKAS_APP_CLIENT_ID: optional,
  IKAS_APP_CLIENT_SECRET: optional,
  TICIMAX_APP_CLIENT_ID: optional,
  TICIMAX_APP_CLIENT_SECRET: optional,
  IDEASOFT_APP_CLIENT_ID: optional,
  IDEASOFT_APP_CLIENT_SECRET: optional,
  ADS_AUTOMATION_ENABLED: bool,
  TRACKER_INGEST_ORIGIN: optional,
  PLATFORM_ADMIN_ALLOWLIST: optional,
  SENTRY_DSN: optional,
  DAILY_PROVIDER_COST_CAP_USD: z.coerce.number().nonnegative().default(25),
  DEMO_MODE: bool,
});

export type AppConfig = z.infer<typeof envSchema> & {
  platformAdmins: string[];
};

const LIVE_CREDENTIAL_KEYS = [
  "STRIPE_SECRET_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_AI_API_KEY",
  "PERPLEXITY_API_KEY",
  "LICENSED_MONITOR_API_KEY",
] as const;

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Geçersiz ortam yapılandırması: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === "production") {
    if (cfg.DEMO_MODE && LIVE_CREDENTIAL_KEYS.some((k) => cfg[k])) {
      throw new Error("Prod'da DEMO_MODE canlı sağlayıcı anahtarlarıyla birlikte açılamaz.");
    }
    if (!cfg.AUTH_SECRET) throw new Error("Prod'da AUTH_SECRET zorunlu.");
    if (!cfg.SECRETS_ENCRYPTION_KEY) throw new Error("Prod'da SECRETS_ENCRYPTION_KEY zorunlu.");
  }
  return {
    ...cfg,
    platformAdmins: (cfg.PLATFORM_ADMIN_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

let cached: AppConfig | undefined;
export function config(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/** Özellik yapılandırma durumu — UI'da açık "not_configured" göstermek için. */
export function featureStatus(cfg: AppConfig = config()) {
  return {
    email: Boolean(cfg.SMTP_URL || cfg.RESEND_API_KEY),
    googleOAuth: Boolean(cfg.AUTH_GOOGLE_ID && cfg.AUTH_GOOGLE_SECRET),
    storage: Boolean(cfg.STORAGE_BUCKET && cfg.STORAGE_ACCESS_KEY_ID),
    billing: Boolean(cfg.STRIPE_SECRET_KEY && cfg.STRIPE_WEBHOOK_SECRET),
    queue: Boolean(cfg.REDIS_URL),
    openai: Boolean(cfg.OPENAI_API_KEY && cfg.OPENAI_MONITOR_MODEL),
    gemini: Boolean(cfg.GOOGLE_AI_API_KEY && cfg.GOOGLE_MONITOR_MODEL),
    perplexity: Boolean(cfg.PERPLEXITY_API_KEY && cfg.PERPLEXITY_MONITOR_MODEL),
    generation: Boolean(cfg.OPENAI_API_KEY && cfg.GENERATION_MODEL),
    licensedUi: Boolean(cfg.LICENSED_MONITOR_BASE_URL && cfg.LICENSED_MONITOR_API_KEY),
    demo: cfg.DEMO_MODE,
  };
}
