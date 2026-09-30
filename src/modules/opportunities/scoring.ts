import { sha256 } from "@/lib/crypto";

/**
 * Opportunity Score (§5). Ağırlıklar deneysel ürün varsayımıdır; config version ile saklanır.
 * Eksik zorunlu bileşen → provisional / no-score.
 */
export const OPPORTUNITY_FORMULA_VERSION = "opportunity@1";

export const OPPORTUNITY_WEIGHTS = {
  intent: 0.3,
  visibilityGap: 0.25,
  catalogFit: 0.2,
  evidenceStrength: 0.15,
  actionability: 0.1,
} as const;

export type ComponentKey = keyof typeof OPPORTUNITY_WEIGHTS;

export interface ComponentValue {
  value: number | null; // 0–100
  rationale: string;
}

export type OpportunityComponents = Record<ComponentKey, ComponentValue>;

const REQUIRED: ComponentKey[] = ["intent", "visibilityGap", "catalogFit"];

export interface OpportunityScoreResult {
  score: number | null;
  provisional: boolean;
  missing: ComponentKey[];
  formulaVersion: string;
}

function clamp100(n: number) {
  return Math.max(0, Math.min(100, n));
}

export function opportunityScore(c: OpportunityComponents): OpportunityScoreResult {
  const missing = (Object.keys(OPPORTUNITY_WEIGHTS) as ComponentKey[]).filter((k) => c[k].value === null);
  if (missing.some((k) => REQUIRED.includes(k))) {
    return { score: null, provisional: true, missing, formulaVersion: OPPORTUNITY_FORMULA_VERSION };
  }
  let sum = 0;
  for (const k of Object.keys(OPPORTUNITY_WEIGHTS) as ComponentKey[]) {
    sum += OPPORTUNITY_WEIGHTS[k] * clamp100(c[k].value ?? 0);
  }
  return { score: Math.round(sum), provisional: missing.length > 0, missing, formulaVersion: OPPORTUNITY_FORMULA_VERSION };
}

/** Gap = max(0, bestCompetitorPresence − brandPresence) × 100, aynı cohort. Presence 0–1. */
export function visibilityGap(brandPresence: number | null, competitorPresences: Array<number | null>): number | null {
  const comps = competitorPresences.filter((p): p is number => p !== null);
  if (brandPresence === null || comps.length === 0) return null;
  return Math.round(Math.max(0, Math.max(...comps) - brandPresence) * 100);
}

/** Kanıt gücü: bağımsız başarılı tekrar ve kaynak sayısı, güncellik. */
export function evidenceStrength(input: { successfulRepeats: number; distinctSources: number; newestAgeDays: number | null }): number | null {
  if (input.successfulRepeats === 0) return null;
  const repeats = Math.min(1, input.successfulRepeats / 6) * 60;
  const sources = Math.min(1, input.distinctSources / 4) * 25;
  const fresh = input.newestAgeDays === null ? 0 : input.newestAgeDays <= 7 ? 15 : input.newestAgeDays <= 30 ? 8 : 0;
  return Math.round(repeats + sources + fresh);
}

export function opportunityDedupeKey(clusterId: string, locale: string, gapType: string, channel = "organic"): string {
  return sha256(`${clusterId}|${locale}|${gapType}|${channel}`).slice(0, 32);
}

// ── Durum makinesi ──
export type OpportunityStatus = "new" | "triaged" | "in_progress" | "measuring" | "won" | "dismissed";

const TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  new: ["triaged", "in_progress", "dismissed"],
  triaged: ["in_progress", "dismissed", "new"],
  in_progress: ["measuring", "dismissed", "triaged"],
  measuring: ["won", "in_progress", "dismissed"],
  won: ["in_progress"], // yeniden açma
  dismissed: ["new", "triaged"], // yeniden açma
};

export function canTransitionOpportunity(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Won: insan onayı veya açık eşik + minimum örneklem. */
export function canMarkWon(input: { humanApproved: boolean; pointDelta: number | null; sampleCount: number; threshold?: number; minSample?: number }): boolean {
  if (input.humanApproved) return true;
  const threshold = input.threshold ?? 10;
  const minSample = input.minSample ?? 20;
  return input.pointDelta !== null && input.pointDelta >= threshold && input.sampleCount >= minSample;
}

/** Kayıp gelir senaryosu yalnız kullanıcı girdileriyle; booked revenue'ya eklenmez. */
export function lostRevenueScenario(input: {
  monthlyTraffic: number | null;
  aiShareLow: number | null;
  aiShareHigh: number | null;
  cvr: number | null;
  aovMinor: number | null;
  visibilityGap: number | null;
}): { lowMinor: number; highMinor: number; inputs: typeof input } | null {
  const { monthlyTraffic, aiShareLow, aiShareHigh, cvr, aovMinor, visibilityGap } = input;
  if ([monthlyTraffic, aiShareLow, aiShareHigh, cvr, aovMinor, visibilityGap].some((v) => v === null || v === undefined)) return null;
  const gap = (visibilityGap as number) / 100;
  const base = (monthlyTraffic as number) * (cvr as number) * (aovMinor as number) * gap;
  return {
    lowMinor: Math.round(base * (aiShareLow as number)),
    highMinor: Math.round(base * (aiShareHigh as number)),
    inputs: input,
  };
}
