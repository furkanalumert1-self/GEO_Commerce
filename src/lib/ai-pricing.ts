/**
 * Sağlayıcı çağrısı maliyeti (yalnız yönetici raporu ve günlük maliyet tavanı için; müşteriye gösterilmez).
 * Birim fiyatlar AI_PRICING ortam değişkeninden okunur (USD); fiyat tanımlı değilse maliyet bilinmiyor (null) sayılır,
 * varsayım yapılmaz. Sağlayıcı yanıtında maliyet bildiriyorsa o kullanılır.
 *
 * AI_PRICING örneği (sağlayıcı anahtarları: openai, google, anthropic, perplexity):
 * {"openai":{"inputPerMTok":1.25,"outputPerMTok":10,"perSearch":0.01},"anthropic":{"inputPerMTok":3,"outputPerMTok":15,"perSearch":0.01}}
 */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  /** Faturalanan web araması sayısı. */
  searches: number;
  /** Sağlayıcının yanıtta bildirdiği toplam maliyet (USD), varsa. */
  reportedCostUsd?: number | null;
}

export interface ProviderPrice {
  inputPerMTok?: number;
  outputPerMTok?: number;
  perSearch?: number;
  perRequest?: number;
}

export type Pricing = Record<string, ProviderPrice>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Bozuk veya eksik değer uygulamayı durdurmaz: geçersiz girdiler yok sayılır. */
export function parsePricing(raw: string | undefined | null): Pricing {
  if (!raw?.trim()) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    const out: Pricing = {};
    for (const [provider, p] of Object.entries(obj ?? {})) {
      if (!p || typeof p !== "object") continue;
      const price: ProviderPrice = { inputPerMTok: num(p.inputPerMTok), outputPerMTok: num(p.outputPerMTok), perSearch: num(p.perSearch), perRequest: num(p.perRequest) };
      if (Object.values(price).some((v) => v !== undefined)) out[provider] = price;
    }
    return out;
  } catch {
    return {};
  }
}

/** USD mikro birimi (1 USD = 1.000.000). Fiyat yoksa ve sağlayıcı maliyet bildirmediyse null. */
export function callCostMicros(provider: string, usage: CallUsage | null | undefined, pricing: Pricing): bigint | null {
  if (!usage) return null;
  const reported = num(usage.reportedCostUsd);
  if (reported !== undefined) return BigInt(Math.round(reported * 1e6));
  const p = pricing[provider];
  if (!p) return null;
  const usd =
    (usage.inputTokens / 1e6) * (p.inputPerMTok ?? 0) +
    (usage.outputTokens / 1e6) * (p.outputPerMTok ?? 0) +
    usage.searches * (p.perSearch ?? 0) +
    (p.perRequest ?? 0);
  return BigInt(Math.round(usd * 1e6));
}

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/** OpenAI Responses API (izleme ve Fix with AI üretimi). */
export function openaiUsage(json: Record<string, unknown>): CallUsage {
  const u = (json.usage ?? {}) as Record<string, unknown>;
  const output = (json.output as Array<Record<string, unknown>> | undefined) ?? [];
  return { inputTokens: int(u.input_tokens), outputTokens: int(u.output_tokens), searches: output.filter((o) => o.type === "web_search_call").length };
}

/** Gemini generateContent: düşünme token'ları çıktı olarak faturalanır; arama temelli yanıt tek arama sayılır. */
export function geminiUsage(json: Record<string, unknown>): CallUsage {
  const u = (json.usageMetadata ?? {}) as Record<string, unknown>;
  const cand = ((json.candidates as Array<Record<string, unknown>>) ?? [])[0];
  const queries = ((cand?.groundingMetadata as Record<string, unknown> | undefined)?.webSearchQueries as unknown[] | undefined) ?? [];
  return { inputTokens: int(u.promptTokenCount), outputTokens: int(u.candidatesTokenCount) + int(u.thoughtsTokenCount), searches: queries.length ? 1 : 0 };
}

/** Perplexity Agent API: yanıt maliyeti bildiriyorsa o kullanılır. */
export function perplexityUsage(json: Record<string, unknown>): CallUsage {
  const u = (json.usage ?? {}) as Record<string, unknown>;
  const cost = u.cost as Record<string, unknown> | number | undefined;
  const reported = typeof cost === "number" ? cost : num((cost as Record<string, unknown> | undefined)?.total_cost);
  const output = (json.output as Array<Record<string, unknown>> | undefined) ?? [];
  return { inputTokens: int(u.input_tokens), outputTokens: int(u.output_tokens), searches: output.filter((o) => o.type === "search_results").length, reportedCostUsd: reported ?? null };
}
