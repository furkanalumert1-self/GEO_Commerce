"use client";

import { useState } from "react";
import { Badge, Button } from "@/components/ui";

interface EngineResult {
  engine: string;
  status: string;
  ok: boolean;
  model?: string;
  latencyMs?: number;
  citations?: number;
  sample?: string;
  error?: string;
  reason?: string | null;
}

const ENGINE: Record<string, string> = { chatgpt: "ChatGPT (OpenAI)", gemini: "Gemini (Google)", claude: "Claude (Anthropic)", perplexity: "Perplexity" };

/** Yapılandırılmış sağlayıcılara tek kısa gerçek çağrı (küçük maliyet) ve isteğe bağlı test e-postası. */
export function ProviderCheck() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ engines: EngineResult[]; generation: string; email: { status: string; sent?: boolean; error?: string }; crawlProxy?: { configured: boolean; ok?: boolean; exitCountry?: string | null; error?: string } } | null>(null);
  const run = async (sendTestEmail: boolean) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/providers/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sendTestEmail }) });
      const json = await res.json().catch(() => null);
      if (!res.ok) setError(json?.error?.message ?? "Test çalıştırılamadı");
      else setData(json.data);
    } catch {
      setError("Bağlantı hatası");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending} onClick={() => run(false)}>{pending ? "Test ediliyor…" : "AI sağlayıcılarını test et"}</Button>
        <Button disabled={pending} onClick={() => run(true)}>Test et + bana test e-postası gönder</Button>
      </div>
      <p className="text-xs text-text-secondary">Her yapılandırılmış platforma tek kısa soru gönderilir (birkaç sent maliyet). En fazla 10 dakikada 5 test.</p>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {data ? (
        <div role="status" className="flex flex-col gap-3 text-sm">
          {data.engines.map((e) => (
            <div key={e.engine} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{ENGINE[e.engine] ?? e.engine}</span>
                <Badge tone={e.ok ? "success" : e.status === "ready" ? "danger" : "neutral"}>{e.ok ? "Çalışıyor" : e.status === "ready" ? "Hata" : "Yapılandırılmamış"}</Badge>
                {e.model ? <span className="text-xs text-text-secondary">{e.model} · {e.latencyMs} ms · {e.citations} kaynak</span> : null}
              </div>
              {e.sample ? <p className="mt-1 text-xs text-text-secondary">“{e.sample}”</p> : null}
              {!e.ok && e.reason ? <p className="mt-1 text-xs text-danger">{e.error ? `${e.error}: ` : ""}{e.reason}</p> : null}
            </div>
          ))}
          <p>Fix with AI üretimi: <Badge tone={data.generation === "ready" ? "success" : "neutral"}>{data.generation === "ready" ? "Yapılandırılmış" : data.generation === "demo" ? "Demo" : "Yapılandırılmamış (OPENAI_API_KEY + GENERATION_MODEL)"}</Badge></p>
          {data.crawlProxy ? (
            <p>
              Türkiye tarama proxy&apos;si (CRAWL_PROXY_TR):{" "}
              <Badge tone={!data.crawlProxy.configured ? "neutral" : data.crawlProxy.ok ? "success" : "danger"}>{!data.crawlProxy.configured ? "Tanımlı değil" : data.crawlProxy.ok ? "Çalışıyor · çıkış TR" : "Hata"}</Badge>{" "}
              {data.crawlProxy.configured && !data.crawlProxy.ok ? <span className="text-danger">{data.crawlProxy.error ?? `Çıkış ülkesi ${data.crawlProxy.exitCountry ?? "belirlenemedi"} (TR bekleniyor)`}</span> : null}
              {!data.crawlProxy.configured ? <span className="text-xs text-text-secondary">Ülkeye göre yönlendiren siteler (ör. mavi.com) yurt dışı sürümüyle taranır.</span> : null}
            </p>
          ) : null}
          <p>
            E-posta: <Badge tone={data.email.status === "ready" ? "success" : "neutral"}>{data.email.status === "ready" ? "Yapılandırılmış" : "Yapılandırılmamış"}</Badge>{" "}
            {data.email.sent === true ? "Test e-postası gönderildi; gelen kutunuzu kontrol edin." : data.email.sent === false ? <span className="text-danger">Gönderilemedi: {data.email.error}</span> : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
