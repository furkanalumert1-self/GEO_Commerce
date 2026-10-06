import { describe, expect, it } from "vitest";
import { callCostMicros, geminiUsage, openaiUsage, parsePricing, perplexityUsage } from "@/lib/ai-pricing";

describe("sağlayıcı maliyeti (yalnız yönetici raporu)", () => {
  const pricing = parsePricing('{"openai":{"inputPerMTok":2,"outputPerMTok":10,"perSearch":0.01},"bozuk":"x","anthropic":{}}');

  it("fiyatlar okunur; bozuk/boş girdiler yok sayılır, uygulama durmaz", () => {
    expect(Object.keys(pricing)).toEqual(["openai"]);
    expect(parsePricing("{geçersiz")).toEqual({});
    expect(parsePricing(undefined)).toEqual({});
  });

  it("token ve arama kullanımından USD mikro hesaplanır", () => {
    // 1M giriş × $2 + 0,5M çıkış × $10 + 3 arama × $0,01 = $7,03
    expect(callCostMicros("openai", { inputTokens: 1_000_000, outputTokens: 500_000, searches: 3 }, pricing)).toBe(7_030_000n);
  });

  it("fiyat tanımlı değilse maliyet bilinmiyor (null), 0 sayılmaz; sağlayıcı bildirdiyse o kullanılır", () => {
    expect(callCostMicros("anthropic", { inputTokens: 100, outputTokens: 100, searches: 1 }, pricing)).toBeNull();
    expect(callCostMicros("perplexity", { inputTokens: 0, outputTokens: 0, searches: 1, reportedCostUsd: 0.0123 }, {})).toBe(12_300n);
  });

  it("sağlayıcı yanıtlarından kullanım çıkarılır", () => {
    expect(openaiUsage({ usage: { input_tokens: 120, output_tokens: 80 }, output: [{ type: "web_search_call" }, { type: "web_search_call" }, { type: "message" }] })).toEqual({ inputTokens: 120, outputTokens: 80, searches: 2 });
    expect(geminiUsage({ usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 30, thoughtsTokenCount: 20 }, candidates: [{ groundingMetadata: { webSearchQueries: ["a", "b"] } }] })).toEqual({ inputTokens: 50, outputTokens: 50, searches: 1 });
    expect(perplexityUsage({ usage: { input_tokens: 10, output_tokens: 20, cost: { total_cost: 0.005 } }, output: [{ type: "search_results" }] })).toEqual({ inputTokens: 10, outputTokens: 20, searches: 1, reportedCostUsd: 0.005 });
  });
});
