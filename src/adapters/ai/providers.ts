import { config, type AppConfig } from "@/lib/config";
import { ProviderError, type AiAnswer, type AiMonitorAdapter, type AskInput, type EngineKey } from "./types";
import { createFixtureAdapter } from "./fixture";

/**
 * Canlı AI adapter'ları. Endpoint/şema notları docs/provider-capabilities.md'de; canlı smoke opt-in.
 * Anahtar/model yoksa açık not_configured — sessiz mock fallback yok.
 */

function systemInstruction(input: AskInput) {
  return `Answer as you would for a shopper located in ${input.country}. Respond in language: ${input.language}.`;
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal) {
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new ProviderError(`Ağ hatası: ${(e as Error).message}`, true);
  }
  const latencyMs = Date.now() - started;
  if (res.status === 429 || res.status >= 500) {
    const ra = Number(res.headers.get("retry-after"));
    throw new ProviderError(`Sağlayıcı geçici hata ${res.status}`, true, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined, `http_${res.status}`);
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError("Sağlayıcı kimlik doğrulama hatası", false, undefined, "auth");
  if (!res.ok) throw new ProviderError(`Sağlayıcı isteği reddetti (${res.status})`, false, undefined, `http_${res.status}`);
  return { json: (await res.json()) as Record<string, unknown>, latencyMs };
}

function notConfigured(engine: EngineKey, provider: string, reason: string, surface: AiMonitorAdapter["surface"]): AiMonitorAdapter {
  return {
    engine,
    provider,
    surface,
    status: () => "not_configured",
    statusReason: () => reason,
    ask: async () => {
      throw new ProviderError(reason, false, undefined, "not_configured");
    },
  };
}

function unsupported(engine: EngineKey, provider: string, reason: string): AiMonitorAdapter {
  return {
    engine,
    provider,
    surface: "licensed_ui",
    status: () => "unsupported",
    statusReason: () => reason,
    ask: async () => {
      throw new ProviderError(reason, false, undefined, "unsupported");
    },
  };
}

export function openAiAdapter(cfg: AppConfig): AiMonitorAdapter {
  if (!cfg.OPENAI_API_KEY || !cfg.OPENAI_MONITOR_MODEL) {
    return notConfigured("chatgpt", "openai", "OPENAI_API_KEY ve OPENAI_MONITOR_MODEL gerekli", "api_grounded");
  }
  const model = cfg.OPENAI_MONITOR_MODEL;
  return {
    engine: "chatgpt",
    provider: "openai",
    surface: "api_grounded",
    status: () => "ready",
    statusReason: () => null,
    async ask(input): Promise<AiAnswer> {
      const { json, latencyMs } = await postJson(
        "https://api.openai.com/v1/responses",
        { model, instructions: systemInstruction(input), input: input.prompt, tools: [{ type: "web_search" }] },
        { authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
        input.signal,
      );
      const output = (json.output as Array<Record<string, unknown>> | undefined) ?? [];
      let text = "";
      const urls: string[] = [];
      for (const item of output) {
        if (item.type !== "message") continue;
        for (const c of (item.content as Array<Record<string, unknown>>) ?? []) {
          if (c.type === "output_text") {
            text += String(c.text ?? "");
            for (const a of (c.annotations as Array<Record<string, unknown>>) ?? []) if (a.type === "url_citation" && typeof a.url === "string") urls.push(a.url);
          }
        }
      }
      if (!text) throw new ProviderError("Yanıt ayrıştırılamadı", false, undefined, "parse_failed");
      return { provider: "openai", engine: "chatgpt", model: String(json.model ?? model), surface: "api_grounded", text, urls, latencyMs, costMicros: null, supportsCitations: true, raw: json };
    },
  };
}

export function geminiAdapter(cfg: AppConfig): AiMonitorAdapter {
  if (!cfg.GOOGLE_AI_API_KEY || !cfg.GOOGLE_MONITOR_MODEL) {
    return notConfigured("gemini", "google", "GOOGLE_AI_API_KEY ve GOOGLE_MONITOR_MODEL gerekli", "api_grounded");
  }
  const model = cfg.GOOGLE_MONITOR_MODEL;
  return {
    engine: "gemini",
    provider: "google",
    surface: "api_grounded",
    status: () => "ready",
    statusReason: () => null,
    async ask(input): Promise<AiAnswer> {
      const { json, latencyMs } = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: systemInstruction(input) }] },
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          tools: [{ google_search: {} }],
        },
        { "x-goog-api-key": cfg.GOOGLE_AI_API_KEY! },
        input.signal,
      );
      const cand = ((json.candidates as Array<Record<string, unknown>>) ?? [])[0];
      const parts = ((cand?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>) ?? [];
      const text = parts.map((p) => String(p.text ?? "")).join("");
      const chunks = ((cand?.groundingMetadata as Record<string, unknown>)?.groundingChunks as Array<Record<string, unknown>>) ?? [];
      const urls = chunks.map((c) => (c.web as Record<string, unknown>)?.uri).filter((u): u is string => typeof u === "string");
      if (!text) throw new ProviderError("Yanıt ayrıştırılamadı", false, undefined, "parse_failed");
      return { provider: "google", engine: "gemini", model: String(json.modelVersion ?? model), surface: "api_grounded", text, urls, latencyMs, costMicros: null, supportsCitations: true, raw: json };
    },
  };
}

export function perplexityAdapter(cfg: AppConfig): AiMonitorAdapter {
  if (!cfg.PERPLEXITY_API_KEY || !cfg.PERPLEXITY_MONITOR_MODEL) {
    return notConfigured("perplexity", "perplexity", "PERPLEXITY_API_KEY ve PERPLEXITY_MONITOR_MODEL gerekli", "api_grounded");
  }
  const model = cfg.PERPLEXITY_MONITOR_MODEL;
  return {
    engine: "perplexity",
    provider: "perplexity",
    surface: "api_grounded",
    status: () => "ready",
    statusReason: () => null,
    async ask(input): Promise<AiAnswer> {
      const { json, latencyMs } = await postJson(
        "https://api.perplexity.ai/chat/completions",
        { model, messages: [{ role: "system", content: systemInstruction(input) }, { role: "user", content: input.prompt }] },
        { authorization: `Bearer ${cfg.PERPLEXITY_API_KEY}` },
        input.signal,
      );
      const choice = ((json.choices as Array<Record<string, unknown>>) ?? [])[0];
      const text = String((choice?.message as Record<string, unknown>)?.content ?? "");
      const urls = [
        ...(((json.citations as unknown[]) ?? []).filter((u): u is string => typeof u === "string")),
        ...(((json.search_results as Array<Record<string, unknown>>) ?? []).map((r) => r.url).filter((u): u is string => typeof u === "string")),
      ];
      if (!text) throw new ProviderError("Yanıt ayrıştırılamadı", false, undefined, "parse_failed");
      return { provider: "perplexity", engine: "perplexity", model: String(json.model ?? model), surface: "api_grounded", text, urls, latencyMs, costMicros: null, supportsCitations: true, raw: json };
    },
  };
}

/**
 * Engine → adapter. `demo: true` yalnız demo workspace / örnek alan adı içindir (fixtures; dış çağrı yok).
 * Gerçek kullanımda canlı sağlayıcı; yapılandırılmamışsa not_configured — mock'a düşülmez.
 */
export function getAiAdapters(cfg: AppConfig = config(), opts: { demo?: boolean } = {}): Record<EngineKey, AiMonitorAdapter> {
  if (opts.demo && cfg.DEMO_MODE) {
    return {
      chatgpt: createFixtureAdapter("chatgpt"),
      gemini: createFixtureAdapter("gemini"),
      perplexity: createFixtureAdapter("perplexity"),
      google_ai_overviews: unsupported("google_ai_overviews", "google", "Google AI Overviews/AI Mode için izinli/lisanslı kaynak bağlı değil"),
      copilot: unsupported("copilot", "microsoft", "Copilot için izinli/lisanslı kaynak bağlı değil"),
    };
  }
  return {
    chatgpt: openAiAdapter(cfg),
    gemini: geminiAdapter(cfg),
    perplexity: perplexityAdapter(cfg),
    google_ai_overviews: unsupported("google_ai_overviews", "google", "Google AI Overviews/AI Mode için izinli/lisanslı kaynak bağlı değil; sıradan Gemini yanıtı yerine kullanılmaz"),
    copilot: unsupported("copilot", "microsoft", "Copilot için izinli/lisanslı kaynak bağlı değil"),
  };
}

export const ENGINE_LABELS: Record<EngineKey, string> = {
  chatgpt: "ChatGPT (OpenAI API)",
  gemini: "Gemini (Google API)",
  perplexity: "Perplexity (API)",
  google_ai_overviews: "Google AI Overviews",
  copilot: "Microsoft Copilot",
};
