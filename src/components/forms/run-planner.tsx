"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";

interface EngineInfo {
  engine: string;
  status: string;
  reason: string | null;
  inPlan: boolean;
  surface: string;
}

const LABEL: Record<string, string> = { chatgpt: "ChatGPT (OpenAI API)", gemini: "Gemini (Google API)", perplexity: "Perplexity API", google_ai_overviews: "Google AI Overviews", copilot: "Microsoft Copilot" };

/** Maliyet önizleme → onay → başlat. Kullanılamayan motorlar gerekçesiyle devre dışı. */
export function RunPlanner({ url, engines, locale, runPagePrefix, inline = false }: { url: string; engines: EngineInfo[]; locale: string; runPagePrefix?: string; inline?: boolean }) {
  const router = useRouter();
  const usable = engines.filter((e) => (e.status === "ready" || e.status === "demo") && e.inPlan).map((e) => e.engine);
  const [selected, setSelected] = useState<string[]>(usable);
  const [repeats, setRepeats] = useState(1);
  const [preview, setPreview] = useState<null | { unitsRequested: number; unitsPlanned: number; available: number; fits: boolean; sampledFraction: number; promptCount: number }>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);

  const call = async (doPreview: boolean) => {
    setPending(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(doPreview ? {} : { "idempotency-key": crypto.randomUUID() }) },
      body: JSON.stringify({ engines: selected, locales: [locale], repeats, preview: doPreview }),
    });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) return setError(`${body?.error?.message ?? "İşlem başarısız"}${body?.requestId ? ` · istek no: ${body.requestId}` : ""}`);
    if (doPreview) setPreview(body.data);
    else if (inline && runPagePrefix && body.data.runId) {
      // Redis'siz modda ölçüm, çalıştırma sayfası açıkken adım adım ilerler.
      router.push(`${runPagePrefix}/${body.data.runId}`);
    } else {
      setQueued(`Ölçüm kuyruğa alındı (${body.data.preview.unitsPlanned} yanıt birimi ayrıldı).`);
      setPreview(null);
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend className="text-sm font-medium">Motorlar</legend>
        <ul className="mt-2 flex flex-col gap-2">
          {engines.map((e) => {
            const ok = (e.status === "ready" || e.status === "demo") && e.inPlan;
            return (
              <li key={e.engine} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <label className="flex min-h-11 items-center gap-2 sm:min-h-0">
                  <input type="checkbox" disabled={!ok} checked={selected.includes(e.engine)} onChange={(ev) => setSelected((s) => (ev.target.checked ? [...s, e.engine] : s.filter((x) => x !== e.engine)))} />
                  {LABEL[e.engine] ?? e.engine}
                </label>
                {!e.inPlan && (e.status === "ready" || e.status === "demo") ? <Badge tone="warning">Pakette yok</Badge> : e.status === "not_configured" ? <Badge title={e.reason ?? undefined}>Yapılandırılmamış</Badge> : e.status === "unsupported" ? <Badge title={e.reason ?? undefined}>Desteklenmiyor</Badge> : e.status === "demo" ? <Badge tone="warning">Örnek veri</Badge> : null}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        <span>Tekrar sayısı</span>
        <input type="number" min={1} max={5} value={repeats} onChange={(e) => setRepeats(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} className="min-h-11 w-24 rounded-md border border-border px-2 sm:min-h-9" />
      </label>
      {preview ? (
        <div className="rounded-md border border-border bg-bg p-3 text-sm" aria-live="polite">
          <p className="tabular">
            Talep: {preview.unitsRequested} unit · Planlanan: {preview.unitsPlanned} unit · Kalan kota: {preview.available}
          </p>
          {!preview.fits ? <p className="mt-1 text-warning">Kota yetmediği için {preview.promptCount} soru ölçülecek (%{Math.round(preview.sampledFraction * 100)}); kalanlar sonraki turlarda döndürülür.</p> : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {queued ? <p role="status" className="text-sm text-success">{queued}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => call(true)} disabled={pending || selected.length === 0}>Maliyeti önizle</Button>
        <Button variant="primary" onClick={() => call(false)} disabled={pending || !preview || preview.unitsPlanned === 0}>Onayla ve başlat</Button>
      </div>
    </div>
  );
}
