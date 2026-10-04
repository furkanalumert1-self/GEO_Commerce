import { decodeKey } from "@/lib/crypto";
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
  DATABASE_URL: z.string().default(""),
  REDIS_URL: optional,
  /**
   * queue: JobRecord → Redis/BullMQ → ayrı worker. inline: Redis/worker yok; işler kimliği doğrulanmış
   * isteklerle sınırlı adımlar halinde sunucuda yürütülür (geçici dağıtım). Sessiz geri dönüş yoktur.
   */
  JOB_EXECUTION_MODE: z.enum(["queue", "inline"]).default("queue"),
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
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MONITOR_MODEL: optional,
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

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Geçersiz ortam yapılandırması: ${issues}`);
  }
  const cfg = parsed.data;
  // `next build` sırasında runtime sırları gerekmez; kontroller sunucu çalışırken uygulanır.
  const building = env.NEXT_PHASE === "phase-production-build";
  if (!building) {
    // Eksik zorunlu değişkenlerin hepsi tek mesajda (değerler değil, yalnız adlar) — Vercel Runtime Logs'ta görünür.
    const missing: string[] = [];
    if (!cfg.DATABASE_URL) missing.push("DATABASE_URL");
    if (cfg.NODE_ENV === "production") {
      if (!cfg.AUTH_SECRET) missing.push("AUTH_SECRET");
      if (!cfg.SECRETS_ENCRYPTION_KEY) missing.push("SECRETS_ENCRYPTION_KEY");
      else decodeKey(cfg.SECRETS_ENCRYPTION_KEY); // format hatası erken ve açık mesajla
    }
    if (missing.length) throw new Error(`Geçersiz ortam yapılandırması: eksik değişkenler: ${missing.join(", ")}`);
    // DEMO_MODE artık yalnız etiketli demo workspace'leri etkiler (fixtures orada); canlı anahtarlarla birlikte
    // açık olabilir. Gerçek workspace'ler her zaman canlı sağlayıcıyı kullanır.
  }
  return {
    ...cfg,
    // Virgül, noktalı virgül veya boşlukla ayrılmış; panelde tırnaklı girilmiş değerler de kabul edilir.
    platformAdmins: (cfg.PLATFORM_ADMIN_ALLOWLIST ?? "")
      .split(/[\s,;]+/)
      .map((s) => s.trim().replace(/^["'<]+|["'>]+$/g, "").toLowerCase())
      .filter((s) => s.includes("@")),
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
    queue: cfg.JOB_EXECUTION_MODE === "inline" || Boolean(cfg.REDIS_URL),
    jobExecutionMode: cfg.JOB_EXECUTION_MODE,
    openai: Boolean(cfg.OPENAI_API_KEY && cfg.OPENAI_MONITOR_MODEL),
    gemini: Boolean(cfg.GOOGLE_AI_API_KEY && cfg.GOOGLE_MONITOR_MODEL),
    claude: Boolean(cfg.ANTHROPIC_API_KEY && cfg.ANTHROPIC_MONITOR_MODEL),
    perplexity: Boolean(cfg.PERPLEXITY_API_KEY && cfg.PERPLEXITY_MONITOR_MODEL),
    generation: Boolean(cfg.OPENAI_API_KEY && cfg.GENERATION_MODEL),
    licensedUi: Boolean(cfg.LICENSED_MONITOR_BASE_URL && cfg.LICENSED_MONITOR_API_KEY),
    demo: cfg.DEMO_MODE,
  };
}
