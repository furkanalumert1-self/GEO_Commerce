/**
 * PlanEntitlement — API, worker ve UI'ın tek kaynağı (§3).
 * Fiyatlar sabit karar; kotalar spesifikasyonun önerilen varsayılanlarıdır.
 * "Unlimited" yoktur: Enterprise limitleri sözleşme override'ıyla gelir.
 */
export type PlanKey = "free_audit" | "starter" | "growth" | "commerce" | "agency" | "enterprise";

export type Engine = "chatgpt" | "gemini" | "perplexity" | "google_ai_overviews" | "copilot";

export type Feature =
  | "diagnosis"
  | "fix_with_ai"
  | "commerce"
  | "revenue"
  | "ads"
  | "white_label"
  | "public_api"
  | "outgoing_webhooks"
  | "weekly_pdf"
  | "advanced_metrics";

export interface PlanLimits {
  brands: number;
  seats: number;
  competitorsPerBrand: number;
  engines: Engine[] | "all_connected";
  activePrompts: number;
  answerUnits: number;
  monitoringFrequency: "once" | "weekly" | "daily_budgeted";
  opportunityDetail: number | "all"; // detaylı görünebilen fırsat sayısı
  opportunitySummaryOnly: boolean;
  fixUnits: number; // 0 → kapalı
  crawlUrls: number;
  catalogProducts: number;
  commerceEvents: number;
  retentionDays: number;
  pooled: boolean; // Agency havuz
  features: Feature[];
}

export interface PlanDefinition {
  key: PlanKey;
  version: number;
  label: string;
  monthlyPriceUsdCents: number | null;
  limits: PlanLimits;
}

export const PLANS: Record<PlanKey, PlanDefinition> = {
  free_audit: {
    key: "free_audit",
    version: 1,
    label: "Free GEO Audit",
    monthlyPriceUsdCents: 0,
    limits: {
      brands: 1, seats: 1, competitorsPerBrand: 3, engines: ["chatgpt", "gemini"], activePrompts: 5,
      answerUnits: 10, monitoringFrequency: "once", opportunityDetail: 0, opportunitySummaryOnly: true,
      fixUnits: 0, crawlUrls: 20, catalogProducts: 20, commerceEvents: 0, retentionDays: 7, pooled: false,
      features: [],
    },
  },
  starter: {
    key: "starter",
    version: 1,
    label: "Starter",
    monthlyPriceUsdCents: 7900,
    limits: {
      brands: 1, seats: 2, competitorsPerBrand: 3, engines: ["chatgpt", "gemini"], activePrompts: 25,
      answerUnits: 500, monitoringFrequency: "weekly", opportunityDetail: 10, opportunitySummaryOnly: false,
      fixUnits: 0, crawlUrls: 200, catalogProducts: 500, commerceEvents: 0, retentionDays: 90, pooled: false,
      features: [],
    },
  },
  growth: {
    key: "growth",
    version: 1,
    label: "Growth",
    monthlyPriceUsdCents: 19900,
    limits: {
      brands: 1, seats: 5, competitorsPerBrand: 5, engines: ["chatgpt", "gemini", "perplexity"], activePrompts: 75,
      answerUnits: 2000, monitoringFrequency: "daily_budgeted", opportunityDetail: "all", opportunitySummaryOnly: false,
      fixUnits: 30, crawlUrls: 1000, catalogProducts: 5000, commerceEvents: 0, retentionDays: 365, pooled: false,
      features: ["diagnosis", "fix_with_ai", "weekly_pdf", "advanced_metrics"],
    },
  },
  commerce: {
    key: "commerce",
    version: 1,
    label: "Commerce",
    monthlyPriceUsdCents: 49900,
    limits: {
      brands: 1, seats: 10, competitorsPerBrand: 10, engines: "all_connected", activePrompts: 150,
      answerUnits: 5000, monitoringFrequency: "daily_budgeted", opportunityDetail: "all", opportunitySummaryOnly: false,
      fixUnits: 100, crawlUrls: 5000, catalogProducts: 25000, commerceEvents: 100_000, retentionDays: 730, pooled: false,
      features: ["diagnosis", "fix_with_ai", "weekly_pdf", "advanced_metrics", "commerce", "revenue", "ads", "public_api", "outgoing_webhooks"],
    },
  },
  agency: {
    key: "agency",
    version: 1,
    label: "Agency",
    monthlyPriceUsdCents: 99900,
    limits: {
      brands: 10, seats: 25, competitorsPerBrand: 10, engines: "all_connected", activePrompts: 300,
      answerUnits: 10_000, monitoringFrequency: "daily_budgeted", opportunityDetail: "all", opportunitySummaryOnly: false,
      fixUnits: 200, crawlUrls: 10_000, catalogProducts: 100_000, commerceEvents: 500_000, retentionDays: 730, pooled: true,
      features: ["diagnosis", "fix_with_ai", "weekly_pdf", "advanced_metrics", "commerce", "revenue", "ads", "public_api", "outgoing_webhooks", "white_label"],
    },
  },
  enterprise: {
    key: "enterprise",
    version: 1,
    label: "Enterprise",
    monthlyPriceUsdCents: null,
    // Taban: Agency; gerçek limitler tarihli sözleşme override'ı ile gelir (audit log zorunlu).
    limits: {
      brands: 10, seats: 25, competitorsPerBrand: 10, engines: "all_connected", activePrompts: 300,
      answerUnits: 10_000, monitoringFrequency: "daily_budgeted", opportunityDetail: "all", opportunitySummaryOnly: false,
      fixUnits: 200, crawlUrls: 10_000, catalogProducts: 100_000, commerceEvents: 500_000, retentionDays: 730, pooled: true,
      features: ["diagnosis", "fix_with_ai", "weekly_pdf", "advanced_metrics", "commerce", "revenue", "ads", "public_api", "outgoing_webhooks", "white_label"],
    },
  },
};

/** Trial: hesap başına tek, 7 gün / 100 answer unit / 10 prompt / 1 marka (Starter kapsamı). */
export const TRIAL = { days: 7, answerUnits: 100, activePrompts: 10, brands: 1 } as const;

export const PAID_PLAN_ORDER: PlanKey[] = ["starter", "growth", "commerce", "agency"];

export interface SubscriptionLike {
  planKey: PlanKey;
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "read_only";
  pastDueSince?: Date | null;
  overrideLimits?: Partial<PlanLimits> | null;
  overrideExpiresAt?: Date | null;
}

export interface Entitlements extends PlanLimits {
  planKey: PlanKey;
  trial: boolean;
  /** Yeni ücretli iş başlatılabilir mi (read-only / grace sonrası past_due → false). */
  canRunPaidJobs: boolean;
  readOnlyReason: string | null;
}

export const PAST_DUE_GRACE_DAYS = 7;

export function resolveEntitlements(sub: SubscriptionLike | null, now = new Date()): Entitlements {
  if (!sub) {
    return { ...PLANS.free_audit.limits, planKey: "free_audit", trial: false, canRunPaidJobs: false, readOnlyReason: "no_subscription" };
  }
  const base = PLANS[sub.planKey];
  let limits: PlanLimits = { ...base.limits };
  const trial = sub.status === "trialing";
  if (trial) {
    limits = { ...limits, answerUnits: TRIAL.answerUnits, activePrompts: TRIAL.activePrompts, brands: TRIAL.brands };
  }
  if (sub.overrideLimits && sub.overrideExpiresAt && sub.overrideExpiresAt > now) {
    limits = { ...limits, ...sub.overrideLimits };
  }
  let canRunPaidJobs = true;
  let readOnlyReason: string | null = null;
  if (sub.status === "read_only" || sub.status === "canceled" || sub.status === "incomplete") {
    canRunPaidJobs = false;
    readOnlyReason = sub.status;
  } else if (sub.status === "past_due") {
    const since = sub.pastDueSince ?? now;
    const graceEnd = new Date(since.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000);
    if (now >= graceEnd) {
      canRunPaidJobs = false;
      readOnlyReason = "past_due_grace_expired";
    }
  }
  return { ...limits, planKey: sub.planKey, trial, canRunPaidJobs, readOnlyReason };
}

export function hasFeature(ent: Entitlements, feature: Feature): boolean {
  return ent.features.includes(feature);
}

export function allowedEngines(ent: Entitlements, connected: Engine[]): Engine[] {
  if (ent.engines === "all_connected") return connected;
  const allowed = ent.engines;
  return connected.filter((e) => allowed.includes(e));
}

/** En düşük hangi paket bu özelliği açar — paywall mesajı için. */
export function minimumPlanFor(feature: Feature): PlanKey | null {
  return PAID_PLAN_ORDER.find((p) => PLANS[p].limits.features.includes(feature)) ?? null;
}

export function formatUsd(cents: number | null): string {
  if (cents === null) return "Teklif";
  return `$${(cents / 100).toFixed(0)}`;
}
