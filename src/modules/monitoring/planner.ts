/**
 * Ölçüm planlayıcı (§3): prompts × engines × locales × repetitions × runs tahmini.
 * Kota yetmezse kullanıcının öncelikli cohort'unu döndürerek örnekler; her promptun her gün
 * ölçüleceğini vaat etmez.
 */
export interface PlanInput {
  promptIds: string[]; // öncelik sırasına göre
  engines: string[];
  locales: string[];
  repetitions: number;
  runsPerPeriod: number;
  availableUnits: number;
  cohortCursor?: number;
}

export interface PlanEstimate {
  unitsPerRun: number;
  unitsPerPeriod: number;
  fits: boolean;
  selectedPromptIds: string[];
  nextCursor: number;
  sampledFraction: number;
}

export function estimate(input: PlanInput): PlanEstimate {
  const perPrompt = input.engines.length * input.locales.length * input.repetitions;
  const unitsPerRun = input.promptIds.length * perPrompt;
  const unitsPerPeriod = unitsPerRun * input.runsPerPeriod;
  if (perPrompt === 0 || input.promptIds.length === 0) {
    return { unitsPerRun: 0, unitsPerPeriod: 0, fits: true, selectedPromptIds: [], nextCursor: 0, sampledFraction: 0 };
  }
  const budgetPerRun = Math.floor(input.availableUnits / Math.max(1, input.runsPerPeriod));
  if (unitsPerRun <= budgetPerRun) {
    return { unitsPerRun, unitsPerPeriod, fits: true, selectedPromptIds: [...input.promptIds], nextCursor: 0, sampledFraction: 1 };
  }
  const capacity = Math.max(0, Math.floor(budgetPerRun / perPrompt));
  const n = input.promptIds.length;
  const start = (input.cohortCursor ?? 0) % n;
  const selected: string[] = [];
  for (let k = 0; k < Math.min(capacity, n); k++) selected.push(input.promptIds[(start + k) % n]!);
  return {
    unitsPerRun,
    unitsPerPeriod,
    fits: false,
    selectedPromptIds: selected,
    nextCursor: (start + selected.length) % n,
    sampledFraction: selected.length / n,
  };
}

/** Mantıksal örnek anahtarı — aynı run'da aynı gözlem iki kez oluşmaz. */
export function sampleKey(runId: string, promptVersionId: string, engine: string, locale: string, repetition: number): string {
  return `${runId}:${promptVersionId}:${engine}:${locale}:${repetition}`;
}
