import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "@/lib/config";
import { anthropicError, claudeAdapter, parseClaudeContent, type ClaudeClient } from "@/adapters/ai/anthropic";
import { getAiAdapters } from "@/adapters/ai/providers";
import { ProviderError } from "@/adapters/ai/types";
import { customerSafeSummary } from "@/modules/audit/service";
import { auditEngineScope } from "@/modules/audit/service";
import { allowedEngines, PLANS } from "@/modules/billing/plans";

const cfg = (extra: Record<string, string> = {}) => parseConfig({ DATABASE_URL: "x", ...extra });
const ready = cfg({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MONITOR_MODEL: "claude-test-model" });

function message(content: unknown[], over: Record<string, unknown> = {}) {
  return { id: "msg_1", type: "message", role: "assistant", model: "claude-test-model", stop_reason: "end_turn", stop_sequence: null, content, usage: { input_tokens: 10, output_tokens: 20, server_tool_use: { web_search_requests: 1 } }, ...over } as unknown as Anthropic.Message;
}

const searchResult = { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://rehber.example/yatak", title: "Rehber", encrypted_content: "x", page_age: null }] };
const cited = { type: "text", text: "Luma Yatak öne çıkıyor.", citations: [{ type: "web_search_result_location", url: "https://rehber.example/yatak", title: "Rehber", encrypted_index: "i", cited_text: "Luma" }] };

function mockClient(impl: (...args: unknown[]) => Promise<Anthropic.Message>) {
  const create = vi.fn(impl);
  return { client: { messages: { create } } as unknown as ClaudeClient, create };
}

describe("claude adapter", () => {
  it("anahtar veya model yoksa not_configured; çağrı yapılmaz", async () => {
    for (const c of [cfg(), cfg({ ANTHROPIC_API_KEY: "k" }), cfg({ ANTHROPIC_MONITOR_MODEL: "m" })]) {
      const a = claudeAdapter(c);
      expect(a.status()).toBe("not_configured");
      expect(a.statusReason()).toContain("ANTHROPIC_API_KEY");
      await expect(a.ask({ prompt: "x", country: "TR", language: "tr" })).rejects.toMatchObject({ code: "not_configured", retryable: false });
    }
    expect(getAiAdapters(cfg()).claude.status()).toBe("not_configured");
  });

  it("ortak sözleşmeye bağlanır: metin, atıf kaynakları, model, yüzey; istek web aramalı ve yerelleştirilmiş", async () => {
    const { client, create } = mockClient(async () => message([{ type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "yatak" } }, searchResult, cited]));
    const a = claudeAdapter(ready, client);
    expect(a.status()).toBe("ready");
    const r = await a.ask({ prompt: "En iyi yatak markası?", country: "TR", language: "tr" });
    expect(r).toMatchObject({ provider: "anthropic", engine: "claude", model: "claude-test-model", surface: "api_grounded", text: "Luma Yatak öne çıkıyor.", urls: ["https://rehber.example/yatak"], costMicros: null, supportsCitations: true });
    const body = create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(body.model).toBe("claude-test-model");
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: "TR" } }]);
    expect(body.max_tokens).toBeLessThanOrEqual(2048);
    expect(JSON.stringify(r.raw)).not.toContain("test-key");
  });

  it("kaynak uydurmaz: atıf yoksa urls boş (arama sonucu URL'si kaynak sayılmaz)", async () => {
    const { client } = mockClient(async () => message([searchResult, { type: "text", text: "Genel öneriler.", citations: null }]));
    const r = await claudeAdapter(ready, client).ask({ prompt: "x", country: "TR", language: "tr" });
    expect(r.urls).toEqual([]);
  });

  it("pause_turn: asistan içeriği geri gönderilerek sürdürülür (ek kullanıcı mesajı yok)", async () => {
    let n = 0;
    const { client, create } = mockClient(async () => (n++ === 0 ? message([{ type: "server_tool_use", id: "srv_1", name: "web_search", input: {} }], { stop_reason: "pause_turn" }) : message([searchResult, cited])));
    const r = await claudeAdapter(ready, client).ask({ prompt: "x", country: "TR", language: "tr" });
    expect(r.text).toContain("Luma");
    const second = create.mock.calls[1]![0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("tüm aramalar hata verdiyse aramasız yanıt kabul edilmez", async () => {
    const { client } = mockClient(async () => message([{ type: "web_search_tool_result", tool_use_id: "s", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }, { type: "text", text: "Bilgim dahilinde..." }]));
    await expect(claudeAdapter(ready, client).ask({ prompt: "x", country: "TR", language: "tr" })).rejects.toMatchObject({ code: "search_failed", retryable: true });
  });

  it("arama yapmadan yanıtlarsa (araç mevcut, model aramadı) geçerli yanıttır", async () => {
    const { client } = mockClient(async () => message([{ type: "text", text: "Kısa yanıt." }], { usage: { input_tokens: 1, output_tokens: 1 } }));
    const r = await claudeAdapter(ready, client).ask({ prompt: "x", country: "TR", language: "tr" });
    expect(r.text).toBe("Kısa yanıt.");
  });

  it("refusal ve boş yanıt başarısız sayılır (sıfır skor değil)", async () => {
    const refusal = mockClient(async () => message([], { stop_reason: "refusal" }));
    await expect(claudeAdapter(ready, refusal.client).ask({ prompt: "x", country: "TR", language: "tr" })).rejects.toMatchObject({ code: "refusal", retryable: false });
    const empty = mockClient(async () => message([]));
    await expect(claudeAdapter(ready, empty.client).ask({ prompt: "x", country: "TR", language: "tr" })).rejects.toMatchObject({ code: "parse_failed" });
  });

  it("hata eşleme: anahtar/kredi/model/arama yetkisi kalıcı; 429/529/zaman aşımı geçici", () => {
    const h = new Headers({ "retry-after": "7" });
    const gen = (status: number, msg: string) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: msg } }, msg, h);
    expect(anthropicError(gen(401, "invalid x-api-key"))).toMatchObject({ code: "auth", retryable: false });
    expect(anthropicError(gen(403, "denied"))).toMatchObject({ code: "auth", retryable: false });
    expect(anthropicError(gen(400, "Your credit balance is too low to access the Anthropic API."))).toMatchObject({ code: "insufficient_quota", retryable: false });
    expect(anthropicError(gen(404, "model: claude-x"))).toMatchObject({ code: "http_404", retryable: false });
    expect(anthropicError(gen(400, "Web search is not enabled for this organization"))).toMatchObject({ code: "search_unavailable", retryable: false });
    expect(anthropicError(gen(400, "max_tokens: bad"))).toMatchObject({ code: "http_400", retryable: false });
    expect(anthropicError(gen(429, "rate limited"))).toMatchObject({ code: "http_429", retryable: true, retryAfterMs: 7000 });
    expect(anthropicError(gen(529, "Overloaded"))).toMatchObject({ code: "http_529", retryable: true });
    expect(anthropicError(new Anthropic.APIConnectionTimeoutError())).toMatchObject({ code: "timeout", retryable: true });
    expect(anthropicError(new Anthropic.APIConnectionError({ message: "reset" }))).toMatchObject({ code: "network", retryable: true });
    const pe = new ProviderError("x", false, undefined, "auth");
    expect(anthropicError(pe)).toBe(pe);
  });

  it("SDK hatası adapter'dan ProviderError olarak çıkar", async () => {
    const { client } = mockClient(async () => {
      throw Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid", new Headers());
    });
    await expect(claudeAdapter(ready, client).ask({ prompt: "x", country: "TR", language: "tr" })).rejects.toBeInstanceOf(ProviderError);
  });

  it("parseClaudeContent atıfları tekilleştirir ve arama hatalarını sayar", () => {
    const p = parseClaudeContent([cited, cited, searchResult, { type: "web_search_tool_result", tool_use_id: "s2", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }] as unknown as Anthropic.ContentBlock[]);
    expect(p.urls).toEqual(["https://rehber.example/yatak"]);
    expect(p.searchOk).toBe(1);
    expect(p.searchErrors).toEqual(["max_uses_exceeded"]);
  });
});

describe("claude kapsamı ve kullanılabilirlik", () => {
  it("ücretsiz ölçüm: Claude yalnız yapılandırılmışsa kapsamda; değilse kullanılamıyor listesinde", () => {
    expect(auditEngineScope(getAiAdapters(cfg()))).toEqual({ engines: ["chatgpt", "gemini"], unavailable: ["claude"] });
    expect(auditEngineScope(getAiAdapters(ready)).engines).toEqual(["chatgpt", "gemini", "claude"]);
  });

  it("paketler Claude'u içerir; bağlı değilse seçilebilir değildir", () => {
    const ent = { ...PLANS.starter.limits } as Parameters<typeof allowedEngines>[0];
    expect(allowedEngines(ent, ["chatgpt", "gemini", "claude"])).toContain("claude");
    expect(allowedEngines(ent, ["chatgpt", "gemini"])).not.toContain("claude");
  });

  it("müşteri görünümü yapılandırma/faturalandırma ayrıntısı içermez", () => {
    const safe = customerSafeSummary({
      unavailableEngines: [{ engine: "claude", reason: "ANTHROPIC_API_KEY ve ANTHROPIC_MONITOR_MODEL gerekli" }],
      failedCalls: ["claude:insufficient_quota", "claude:auth"],
      failedDetails: { claude: "credit balance is too low" },
      opportunityCount: 2,
    }) as Record<string, unknown>;
    const text = JSON.stringify(safe);
    expect(text).not.toMatch(/ANTHROPIC|credit|insufficient_quota|auth/);
    expect(safe.unavailableEngines).toEqual([{ engine: "claude", reason: "Şu anda kullanılamıyor" }]);
    expect(safe.failedCalls).toEqual(["claude:unavailable"]);
    expect(safe.opportunityCount).toBe(2);
  });
});
