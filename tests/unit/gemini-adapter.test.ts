import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiAdapter } from "@/adapters/ai/providers";
import type { AppConfig } from "@/lib/config";

const cfg = (extra: Partial<AppConfig> = {}) => ({ GOOGLE_AI_API_KEY: "k", GOOGLE_MONITOR_MODEL: "main-model", ...extra }) as AppConfig;
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const err = (status: number, message: string) => new Response(JSON.stringify({ error: { code: status, message, status: "NOT_FOUND" } }), { status });
const answer = (parts: unknown[], extra: Record<string, unknown> = {}) => ({ candidates: [{ content: { parts }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://a.example/x" } }] }, ...extra }] });
const input = { prompt: "soru", country: "TR", language: "tr" };

describe("Gemini adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("düşünce bölümleri metne katılmaz; kaynaklar okunur", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(answer([{ text: "iç düşünce", thought: true }, { text: "Yanıt" }]))));
    const r = await geminiAdapter(cfg()).ask(input);
    expect(r.text).toBe("Yanıt");
    expect(r.urls).toEqual(["https://a.example/x"]);
  });

  it("ana model bulunamazsa yapılandırılmış yedek modelle bir kez denenir", async () => {
    const f = vi.fn(async (url: string) => (url.includes("main-model") ? err(404, "models/main-model is not found for API version v1beta") : ok(answer([{ text: "Yedek yanıt" }]))));
    vi.stubGlobal("fetch", f);
    const r = await geminiAdapter(cfg({ GOOGLE_MONITOR_FALLBACK_MODEL: "backup-model" })).ask(input);
    expect(r.text).toBe("Yedek yanıt");
    expect(r.model).toBe("backup-model");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("yedek model yoksa model hatası olduğu gibi döner", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => err(404, "models/main-model is not found")));
    await expect(geminiAdapter(cfg()).ask(input)).rejects.toMatchObject({ code: "http_404" });
  });

  it("güvenlik engelli boş yanıt ayrı kodla raporlanır", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok(answer([], { finishReason: "SAFETY" }))));
    await expect(geminiAdapter(cfg()).ask(input)).rejects.toMatchObject({ code: "blocked_by_provider" });
  });
});
