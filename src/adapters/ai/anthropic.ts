import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "@/lib/config";
import { callCostMicros, parsePricing } from "@/lib/ai-pricing";
import { ProviderError, type AiAnswer, type AiMonitorAdapter, type AskInput } from "./types";

/**
 * Claude (Anthropic Messages API) görünürlük adapter'ı. Web araması sunucu aracıyla (`web_search_20250305`,
 * doğrudan çağrı; tüm güncel modellerde desteklenir) yapılır; kaynaklar yalnız yanıttaki
 * `web_search_result_location` atıflarından gelir. API yanıtı claude.ai sonucuyla aynı değildir (surface: api_grounded).
 *
 * Maliyet sınırı: istek başına en çok MAX_SEARCHES arama ve MAX_OUTPUT_TOKENS çıktı; SDK'nın kendi yeniden denemesi
 * kapalıdır — tekrar politikası çağıran tarafta (audit/monitoring) sınırlıdır.
 */
export const CLAUDE_WEB_SEARCH_TOOL = "web_search_20250305";
const MAX_SEARCHES = 3;
const MAX_OUTPUT_TOKENS = 2048;
const MAX_PAUSE_RESUMES = 2;
const TIMEOUT_MS = 90_000;

function systemPrompt(input: AskInput) {
  return `Answer as you would for a shopper located in ${input.country}. Respond in language: ${input.language}. Use web search when current product, brand or store information would improve the answer.`;
}

/** SDK hata nesnesinden mesaj (anahtar içermez; kısaltılır). */
function apiMessage(e: InstanceType<typeof Anthropic.APIError>): string {
  const body = e.error as { error?: { message?: string } } | undefined;
  return (body?.error?.message ?? "").replace(/\s+/g, " ").slice(0, 240);
}

/**
 * Anthropic hata türleri → ortak ProviderError kodları. Kredi/anahtar/yetki/model/arama yetkisi kalıcıdır
 * (otomatik tekrar yok); 429, 5xx/529, ağ ve zaman aşımı geçicidir.
 */
export function anthropicError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("Sağlayıcı zaman aşımı", true, undefined, "timeout");
  if (e instanceof Anthropic.APIUserAbortError) return new ProviderError("Sağlayıcı zaman aşımı", true, undefined, "timeout");
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError("Ağ hatası", true, undefined, "network");
  if (e instanceof Anthropic.APIError) {
    const detail = apiMessage(e);
    const suffix = detail ? `: ${detail}` : "";
    const status = e.status ?? 0;
    const ra = Number(e.headers?.get?.("retry-after"));
    const retryAfter = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
    if (status === 402 || /credit balance|billing/i.test(detail)) return new ProviderError(`Hesapta kullanılabilir kredi yok (faturalandırmayı kontrol edin)${suffix}`, false, undefined, "insufficient_quota");
    if (status === 401 || status === 403) return new ProviderError(`Sağlayıcı kimlik doğrulama/yetki hatası${suffix}`, false, undefined, "auth");
    if (status === 404) return new ProviderError(`Model bulunamadı veya bu anahtarla erişilemiyor${suffix}`, false, undefined, "http_404");
    if (status === 400 && /web search/i.test(detail)) return new ProviderError(`Web araması bu hesapta kullanılamıyor${suffix}`, false, undefined, "search_unavailable");
    if (status === 429) return new ProviderError(`Sağlayıcı hız sınırı${suffix}`, true, retryAfter, "http_429");
    if (status >= 500) return new ProviderError(`Sağlayıcı geçici hata ${status}${suffix}`, true, retryAfter, `http_${status}`);
    return new ProviderError(`Sağlayıcı isteği reddetti (${status})${suffix}`, false, undefined, `http_${status}`);
  }
  const name = (e as Error)?.name;
  if (name === "TimeoutError" || name === "AbortError") return new ProviderError("Sağlayıcı zaman aşımı", true, undefined, "timeout");
  return new ProviderError(`Beklenmeyen sağlayıcı hatası`, true, undefined, "network");
}

/** Yanıt içeriğinden metin, atıf URL'leri ve arama durumunu çıkarır (saf; test edilebilir). */
export function parseClaudeContent(content: Anthropic.ContentBlock[]) {
  let text = "";
  const urls: string[] = [];
  let searchOk = 0;
  const searchErrors: string[] = [];
  for (const b of content) {
    if (b.type === "text") {
      text += b.text;
      for (const c of b.citations ?? []) if (c.type === "web_search_result_location" && c.url) urls.push(c.url);
    } else if (b.type === "web_search_tool_result") {
      if (Array.isArray(b.content)) searchOk++;
      else searchErrors.push(b.content.error_code);
    }
  }
  return { text: text.trim(), urls: [...new Set(urls)], searchOk, searchErrors };
}

export type ClaudeClient = Pick<Anthropic, "messages">;

export function claudeAdapter(cfg: AppConfig, client?: ClaudeClient): AiMonitorAdapter {
  if (!cfg.ANTHROPIC_API_KEY || !cfg.ANTHROPIC_MONITOR_MODEL) {
    const reason = "ANTHROPIC_API_KEY ve ANTHROPIC_MONITOR_MODEL gerekli";
    return {
      engine: "claude",
      provider: "anthropic",
      surface: "api_grounded",
      status: () => "not_configured",
      statusReason: () => reason,
      ask: async () => {
        throw new ProviderError(reason, false, undefined, "not_configured");
      },
    };
  }
  const model = cfg.ANTHROPIC_MONITOR_MODEL;
  const api: ClaudeClient = client ?? new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 0, timeout: TIMEOUT_MS });
  return {
    engine: "claude",
    provider: "anthropic",
    surface: "api_grounded",
    status: () => "ready",
    statusReason: () => null,
    async ask(input): Promise<AiAnswer> {
      const started = Date.now();
      const tool: Anthropic.WebSearchTool20250305 = {
        type: CLAUDE_WEB_SEARCH_TOOL,
        name: "web_search",
        max_uses: MAX_SEARCHES,
        // İstenen pazar: arama sonuçlarını yerelleştirir; doğrulanmış fiziksel konum değildir.
        ...(/^[A-Z]{2}$/.test(input.country) ? { user_location: { type: "approximate" as const, country: input.country } } : {}),
      };
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: input.prompt }];
      const content: Anthropic.ContentBlock[] = [];
      let last: Anthropic.Message | null = null;
      let searches = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        for (let i = 0; i <= MAX_PAUSE_RESUMES; i++) {
          const res = await api.messages.create({ model, max_tokens: MAX_OUTPUT_TOKENS, system: systemPrompt(input), messages, tools: [tool] }, { signal: input.signal });
          last = res;
          content.push(...res.content);
          searches += res.usage.server_tool_use?.web_search_requests ?? 0;
          inputTokens += res.usage.input_tokens ?? 0;
          outputTokens += res.usage.output_tokens ?? 0;
          // Uzun arama turu duraklatıldıysa aynı asistan içeriği geri gönderilerek sürdürülür (ek kullanıcı mesajı yok).
          if (res.stop_reason !== "pause_turn") break;
          messages.push({ role: "assistant", content: res.content });
        }
      } catch (e) {
        throw anthropicError(e);
      }
      if (!last) throw new ProviderError("Yanıt alınamadı", true, undefined, "parse_failed");
      if (last.stop_reason === "refusal") throw new ProviderError("Model bu soruyu yanıtlamadı", false, undefined, "refusal");
      if (last.stop_reason === "pause_turn") throw new ProviderError("Arama turu tamamlanamadı", true, undefined, "timeout");
      const parsed = parseClaudeContent(content);
      // Arama denendi ama hiçbiri başarılı olmadıysa yanıt aramasız sayılır: sessizce kabul edilmez.
      if (parsed.searchOk === 0 && parsed.searchErrors.length > 0) {
        const retryable = parsed.searchErrors.some((c) => c === "too_many_requests" || c === "unavailable");
        throw new ProviderError(`Web araması başarısız: ${[...new Set(parsed.searchErrors)].join(", ")}`, retryable, undefined, "search_failed");
      }
      // Metinsiz yanıt çoğunlukla geçicidir (arama sonrası boş tur, token sınırı): bir kez daha denenir; neden kayda geçer.
      if (!parsed.text) throw new ProviderError(`Yanıt metni boş geldi (durma nedeni: ${last.stop_reason ?? "bilinmiyor"})`, true, undefined, last.stop_reason === "max_tokens" ? "truncated" : "parse_failed");
      return {
        provider: "anthropic",
        engine: "claude",
        model: last.model ?? model,
        surface: "api_grounded",
        text: parsed.text,
        urls: parsed.urls,
        latencyMs: Date.now() - started,
        // Birim fiyat AI_PRICING'den; tanımlı değilse bilinmiyor (null). Yalnız yönetici raporunda görünür.
        costMicros: callCostMicros("anthropic", { inputTokens, outputTokens, searches }, parsePricing(cfg.AI_PRICING)),
        supportsCitations: true,
        raw: { id: last.id, model: last.model, stop_reason: last.stop_reason, usage: last.usage, web_search_requests: searches, content },
      };
    },
  };
}
