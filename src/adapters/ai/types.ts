/**
 * AI görünürlük adapter sözleşmesi. API model yanıtı ≠ tüketici UI sonucu:
 * her yanıt provider/model/surface ile etiketlenir (§1).
 */
export type EngineKey = "chatgpt" | "gemini" | "perplexity" | "google_ai_overviews" | "copilot";
export type Surface = "api_grounded" | "api_plain" | "licensed_ui";

export type AdapterStatus = "ready" | "not_configured" | "unsupported" | "demo";

export interface AiAnswer {
  provider: string;
  engine: EngineKey;
  model: string;
  surface: Surface;
  text: string;
  urls: string[];
  latencyMs: number;
  costMicros: bigint | null; // bilinmiyorsa null (fiyat varsayımı yok)
  supportsCitations: boolean;
  raw: unknown;
}

export interface AskInput {
  prompt: string;
  country: string;
  language: string;
  signal?: AbortSignal;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    public readonly code = "provider_error",
  ) {
    super(message);
  }
}

export interface AiMonitorAdapter {
  engine: EngineKey;
  provider: string;
  status(): AdapterStatus;
  /** Kullanıcıya gösterilen neden (not_configured / unsupported). */
  statusReason(): string | null;
  surface: Surface;
  ask(input: AskInput): Promise<AiAnswer>;
}
