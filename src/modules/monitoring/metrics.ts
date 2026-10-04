/**
 * Görünürlük formülleri v1 (§5). Her snapshot formulaVersion ile saklanır.
 * Eksik veri null'dır, sıfır değil. Başarısız sorgular görünürlük düşüşü sayılmaz.
 */
/**
 * visibility@1.1: formül (0,5·M + 0,3·R + 0,2·C) aynı; tek fark, aynı soru/platformdaki tekrarların önce
 * birleştirilmesi (her soru eşit ağırlık alır, çok tekrar edilen soru istemeden fazla ağırlık kazanmaz).
 */
export const FORMULA_VERSION = "visibility@1.1";
export const MIN_SAMPLE = 20;
export const MIN_COVERAGE = 0.8;

export interface ScoredObservation {
  engine: string;
  surface: "api_grounded" | "api_plain" | "licensed_ui";
  /** Başarılı + parse edilmiş mi; değilse formüle girmez. */
  valid: boolean;
  weight: number;
  mentioned: boolean; // doğrulanmış marka mention (m)
  recommended: boolean; // öneri (r)
  ownCitation: boolean; // kendi domainine citation (c)
  supportsCitations: boolean;
}

export type ScoreProfile = "with_citations" | "no_citations";

export interface EngineScore {
  engine: string;
  profile: ScoreProfile;
  M: number | null;
  R: number | null;
  C: number | null;
  score: number | null;
  validObservations: number;
  scheduledObservations: number;
  coverage: number | null;
  smallSample: boolean;
}

const WEIGHTS = { M: 0.5, R: 0.3, C: 0.2 } as const;

function ratio(obs: ScoredObservation[], pick: (o: ScoredObservation) => boolean): number | null {
  const sw = obs.reduce((s, o) => s + o.weight, 0);
  if (sw === 0) return null;
  return obs.reduce((s, o) => s + (pick(o) ? o.weight : 0), 0) / sw;
}

/**
 * Tek bir motor/profil için AI Visibility Score.
 * Citation desteklemeyen surface'de M/R ağırlıkları normalize edilir (0.5/0.8, 0.3/0.8).
 */
export function visibilityScore(observations: ScoredObservation[], scheduled: number): EngineScore {
  const valid = observations.filter((o) => o.valid);
  const engine = observations[0]?.engine ?? "unknown";
  const profile: ScoreProfile = valid.length > 0 && valid.every((o) => !o.supportsCitations) ? "no_citations" : "with_citations";
  const M = ratio(valid, (o) => o.mentioned);
  const R = ratio(valid, (o) => o.recommended);
  const C = profile === "with_citations" ? ratio(valid, (o) => o.ownCitation) : null;
  let score: number | null = null;
  if (M !== null && R !== null) {
    if (profile === "with_citations" && C !== null) {
      score = Math.round(100 * (WEIGHTS.M * M + WEIGHTS.R * R + WEIGHTS.C * C));
    } else if (profile === "no_citations") {
      const t = WEIGHTS.M + WEIGHTS.R;
      score = Math.round(100 * ((WEIGHTS.M / t) * M + (WEIGHTS.R / t) * R));
    }
  }
  return {
    engine,
    profile,
    M,
    R,
    C,
    score,
    validObservations: valid.length,
    scheduledObservations: scheduled,
    coverage: coverage(valid.length, scheduled),
    smallSample: valid.length < MIN_SAMPLE,
  };
}

export function coverage(validObservations: number, scheduledObservations: number): number | null {
  if (scheduledObservations <= 0) return null;
  return Math.min(1, validObservations / scheduledObservations);
}

export interface AggregateScore {
  score: number | null;
  profile: ScoreProfile | "mixed";
  partial: boolean;
  missingEngines: string[];
  includedEngines: string[];
  smallSample: boolean;
  sampleCount: number;
}

/**
 * Toplam skor: motor başına eşit ağırlık, yalnız coverage ≥ %80 olan motorlar.
 * Farklı score profile'ları tek toplamda birleştirilmez → profile "mixed" ise score null.
 */
export function aggregateScore(perEngine: EngineScore[]): AggregateScore {
  const eligible = perEngine.filter((e) => e.score !== null && e.coverage !== null && e.coverage >= MIN_COVERAGE);
  const missing = perEngine.filter((e) => !eligible.includes(e)).map((e) => e.engine);
  const profiles = new Set(eligible.map((e) => e.profile));
  const sampleCount = perEngine.reduce((s, e) => s + e.validObservations, 0);
  if (eligible.length === 0 || profiles.size > 1) {
    return {
      score: null,
      profile: profiles.size > 1 ? "mixed" : (eligible[0]?.profile ?? "with_citations"),
      partial: true,
      missingEngines: missing,
      includedEngines: eligible.map((e) => e.engine),
      smallSample: sampleCount < MIN_SAMPLE,
      sampleCount,
    };
  }
  const score = Math.round(eligible.reduce((s, e) => s + (e.score as number), 0) / eligible.length);
  return {
    score,
    profile: eligible[0]!.profile,
    partial: missing.length > 0,
    missingEngines: missing,
    includedEngines: eligible.map((e) => e.engine),
    smallSample: sampleCount < MIN_SAMPLE,
    sampleCount,
  };
}

export interface SovObservation {
  valid: boolean;
  weight: number;
  /** Bu yanıtta mention edilen takip edilen marka id'leri (marka başına en fazla bir sayılır). */
  mentionedEntityIds: string[];
}

/** Share of Voice: aynı cohort, takip edilen marka seti üzerinden. Denominator 0 → null. */
export function shareOfVoice(observations: SovObservation[], trackedEntityIds: string[]): Record<string, number | null> {
  const tracked = new Set(trackedEntityIds);
  const totals: Record<string, number> = Object.fromEntries(trackedEntityIds.map((id) => [id, 0]));
  let denominator = 0;
  for (const o of observations) {
    if (!o.valid) continue;
    const unique = new Set(o.mentionedEntityIds.filter((id) => tracked.has(id)));
    for (const id of unique) {
      totals[id] = (totals[id] ?? 0) + o.weight;
      denominator += o.weight;
    }
  }
  return Object.fromEntries(
    trackedEntityIds.map((id) => [id, denominator === 0 ? null : ((totals[id] ?? 0) / denominator) * 100]),
  );
}

/** Puan farkı ile yüzde farkını ayrı döndürür; sabit cohort değilse karşılaştırılamaz. */
export function compareScores(
  current: { score: number | null; cohortHash: string },
  previous: { score: number | null; cohortHash: string },
): { comparable: boolean; pointDelta: number | null; percentDelta: number | null } {
  if (current.cohortHash !== previous.cohortHash || current.score === null || previous.score === null) {
    return { comparable: false, pointDelta: null, percentDelta: null };
  }
  const pointDelta = current.score - previous.score;
  const percentDelta = previous.score === 0 ? null : (pointDelta / previous.score) * 100;
  return { comparable: true, pointDelta, percentDelta };
}

/** Anlamlı görünürlük düşüşü bildirimi: ≥10 puan, aynı cohort, min 20 örnek, ardışık iki run. */
export function isSignificantDrop(
  runs: Array<{ score: number | null; cohortHash: string; sampleCount: number }>,
  baseline: { score: number | null; cohortHash: string },
  threshold = 10,
): boolean {
  if (runs.length < 2 || baseline.score === null) return false;
  const lastTwo = runs.slice(-2);
  return lastTwo.every(
    (r) =>
      r.cohortHash === baseline.cohortHash &&
      r.sampleCount >= MIN_SAMPLE &&
      r.score !== null &&
      (baseline.score as number) - r.score >= threshold,
  );
}

/**
 * Tekrar birleştirme: aynı anahtardaki (soru × platform) geçerli gözlemlerin ağırlığı tekrar sayısına bölünür.
 * Böylece 3 kez sorulan soru, 1 kez sorulan soruyla aynı toplam ağırlığı taşır. Geçersiz gözlemler değişmez
 * (formüle zaten girmez).
 */
export function balanceRepetitions<T extends { valid: boolean; weight: number }>(items: Array<{ key: string; obs: T }>): T[] {
  const n = new Map<string, number>();
  for (const x of items) if (x.obs.valid) n.set(x.key, (n.get(x.key) ?? 0) + 1);
  return items.map((x) => (x.obs.valid ? { ...x.obs, weight: x.obs.weight / (n.get(x.key) ?? 1) } : x.obs));
}
