"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";

interface StepResponse {
  outcome: string;
  job: { status: string; progress: { done: number; total: number }; error: string | null; resumable: boolean } | null;
}

export const INLINE_NOTE = "Analiz boyunca sekmenizin açık kalması gerekmektedir. Sekme kapanırsa, geri döndüğünüzde analiz kaldığı yerden devam eder.";

/**
 * Redis'siz (inline) modda bir işi sınırlı adımlarla ilerletir: her adım açık bir POST'tur. Aynı anda tek
 * istek; başka sekme ilerletiyorsa ("busy") bekler. Geçici sunucu/bağlantı hatası (5xx, JSON olmayan yanıt, ağ)
 * 3 kez artan aralıkla kendiliğinden yeniden denenir; sonra "Yeniden dene" gösterilir (sonsuz deneme yok).
 */
export function InlineJobDriver({ advanceUrl, initialStatus, onDone, label = "Analiz" }: { advanceUrl: string; initialStatus: string; onDone?: () => void; label?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const inFlight = useRef(false);
  const retries = useRef(0);
  const lastRefresh = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);

  const terminal = ["succeeded", "partial", "dead", "canceled"].includes(status);

  const step = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(advanceUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => null);
      if ((!body || res.status >= 500 || res.status === 429) && retries.current < 3) {
        retries.current++;
        setNotice("Bağlantı yavaşladı; kaldığı yerden otomatik devam ediliyor…");
        await new Promise((r) => setTimeout(r, 5000 * retries.current));
        return;
      }
      if (!res.ok) {
        setError(`${body?.error?.message ?? "Adım çalıştırılamadı"}${body?.requestId ? ` · istek no: ${body.requestId}` : ""}`);
        setPaused(true);
        return;
      }
      retries.current = 0;
      setNotice(null);
      const data = body.data as StepResponse;
      const job = data.job;
      if (job) {
        setStatus(job.status);
        setProgress(job.progress);
      }
      // Sayfadaki durum etiketi, sayaçlar ve gelen yanıtlar iş sürerken de güncellenir (en sık 10 sn'de bir).
      if (job && !["succeeded", "partial", "dead"].includes(job.status) && Date.now() - lastRefresh.current > 10_000) {
        lastRefresh.current = Date.now();
        router.refresh();
      }
      if (data.outcome === "busy") {
        await new Promise((r) => setTimeout(r, 3000));
      } else if (job?.status === "failed") {
        setError(job.error ?? "Geçici hata");
        setPaused(true);
      } else if (job && ["succeeded", "partial", "dead"].includes(job.status)) {
        if (job.status === "dead") setError(job.error ?? "İş tamamlanamadı");
        router.refresh();
        onDone?.();
      }
    } catch {
      if (retries.current < 3) {
        retries.current++;
        setNotice("Bağlantı yavaşladı; kaldığı yerden otomatik devam ediliyor…");
        await new Promise((r) => setTimeout(r, 5000 * retries.current));
        return;
      }
      setError("Bağlantı kesildi; ilerleme kaydedildi. Devam etmek için yeniden deneyin.");
      setPaused(true);
    } finally {
      inFlight.current = false;
    }
  }, [advanceUrl, onDone, router]);

  // Sekme açıkken ve duraklatılmamışken adımları ardışık yürütür (aynı anda tek istek).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (terminal || paused) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      await step();
      if (!cancelled) setTick((t) => t + 1);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tick, terminal, paused, step]);

  if (terminal && !error) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-3 text-sm" aria-live="polite">
      {!terminal ? (
        <p>
          <span className="font-medium">{label} çalışıyor</span>
          {progress && progress.total > 0 ? <span className="tabular"> · {progress.done}/{progress.total} adım</span> : null}
        </p>
      ) : null}
      {!terminal ? <p className="text-xs text-text-secondary">{INLINE_NOTE}</p> : null}
      {notice && !error ? <p className="text-xs text-text-secondary" role="status">{notice}</p> : null}
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-danger">
          <span>{error}</span>
          {!terminal ? (
            <Button
              size="sm"
              onClick={() => {
                setError(null);
                retries.current = 0;
                setPaused(false);
                setTick((t) => t + 1);
              }}
            >
              Yeniden dene / devam et
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
