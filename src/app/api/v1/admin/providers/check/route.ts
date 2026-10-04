import { z } from "zod";
import { json, rateLimit, readJson, route } from "@/lib/http/api";
import { getAiAdapters } from "@/adapters/ai/providers";
import { ProviderError, type EngineKey } from "@/adapters/ai/types";
import { getEmailAdapter } from "@/adapters/email";
import { generationStatus } from "@/modules/actions/generator";
import { APP_NAME } from "@/lib/brand";
import { log } from "@/lib/observability/log";
import { requirePlatformAdmin } from "../../guard";

const body = z.object({ sendTestEmail: z.boolean().default(false) });
const ENGINES: EngineKey[] = ["chatgpt", "gemini", "claude", "perplexity"];
const PROBE = "Türkiye'de hassas cilt için önerilen bir nemlendirici markası söyleyin. Tek cümle yanıt verin.";

/**
 * Platform admin sağlayıcı testi: yapılandırılmış her AI motoruna tek kısa, gerçek çağrı (kuyruk/Redis gerekmez)
 * ve isteğe bağlı olarak yöneticinin kendi adresine test e-postası. Anahtar değerleri asla dönmez/loglanmaz.
 */
export const POST = route(async ({ req, requestId }) => {
  const admin = await requirePlatformAdmin(req);
  rateLimit(`provider-check:${admin.id}`, 5, 10 * 60_000);
  const input = await readJson(req, body);
  const adapters = getAiAdapters();
  const engines = await Promise.all(
    ENGINES.map(async (engine) => {
      const a = adapters[engine];
      if (a.status() !== "ready") return { engine, status: a.status(), ok: false, reason: a.statusReason() };
      const started = Date.now();
      try {
        const r = await a.ask({ prompt: PROBE, country: "TR", language: "tr", signal: AbortSignal.timeout(90_000) });
        return { engine, status: "ready", ok: r.text.trim().length > 0, model: r.model, latencyMs: Date.now() - started, citations: r.urls.length, sample: r.text.slice(0, 160) };
      } catch (e) {
        const code = e instanceof ProviderError ? e.code : "error";
        log.warn("admin.provider_check_failed", { engine, code });
        return { engine, status: "ready", ok: false, latencyMs: Date.now() - started, error: code, reason: e instanceof Error ? e.message.slice(0, 200) : "Bilinmeyen hata" };
      }
    }),
  );
  let email: { status: string; sent?: boolean; error?: string } = { status: getEmailAdapter().status() };
  if (input.sendTestEmail && email.status === "ready") {
    try {
      await getEmailAdapter().send({ to: admin.email, subject: `${APP_NAME} test e-postası`, text: `${APP_NAME} e-posta gönderimi çalışıyor.` });
      email = { ...email, sent: true };
    } catch (e) {
      email = { ...email, sent: false, error: e instanceof Error ? e.message.slice(0, 200) : "Gönderilemedi" };
    }
  }
  return json({ engines, generation: generationStatus(), email }, { requestId });
});
