"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

const POLL_MS = 3_000;
const GIVE_UP_MS = 6 * 60_000;

/**
 * Fix with AI: taslak işini başlatır ve arka planda izler. Üretim sunucuda sürer; kullanıcı sayfadan ayrılsa
 * da taslak oluşur (Aksiyonlar'da görünür). Sayfaya dönüldüğünde süren iş (pendingJobId) izlenmeye devam eder.
 */
export function DraftJobButton({
  url,
  body,
  label,
  variant = "secondary",
  actionBase,
  pendingJobId,
  disabled,
  disabledReason,
}: {
  url: string;
  body: unknown;
  label: string;
  variant?: "primary" | "secondary";
  /** Hazır taslağın adresi için önek (ör. "/w/…/b/…/actions/"). */
  actionBase: string;
  pendingJobId?: string | null;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(pendingJobId ?? null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!jobId) return;
    const started = Date.now();
    let stop = false;
    const tick = async () => {
      if (stop) return;
      setElapsed(Math.round((Date.now() - started) / 1000));
      try {
        const res = await fetch(`/api/v1/jobs/${jobId}`, { cache: "no-store" });
        const job = (await res.json().catch(() => null))?.data as { status?: string; resultId?: string | null; error?: string | null } | undefined;
        if (job?.status === "succeeded" && job.resultId) {
          stop = true;
          router.push(`${actionBase}${job.resultId}`);
          return;
        }
        if (job && ["failed", "dead", "canceled"].includes(job.status ?? "")) {
          stop = true;
          setJobId(null);
          setError(`Taslak hazırlanamadı: ${job.error ?? "bilinmeyen hata"}. Tekrar deneyebilirsiniz; başarısız denemeler kotanızdan düşmez.`);
          return;
        }
      } catch {
        /* geçici bağlantı sorunu: izlemeye devam */
      }
      if (Date.now() - started > GIVE_UP_MS) {
        stop = true;
        setJobId(null);
        setError("Taslak beklenenden uzun sürüyor. Hazır olduğunda Aksiyonlar sayfasında görünür.");
        return;
      }
      setTimeout(tick, POLL_MS);
    };
    const first = setTimeout(tick, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(first);
    };
  }, [jobId, actionBase, router]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data?.jobId) {
        setError(json?.error?.message ?? "Taslak başlatılamadı; biraz sonra tekrar deneyin");
        return;
      }
      setElapsed(0);
      setJobId(json.data.jobId);
    } catch {
      setError("Bağlantı hatası; tekrar deneyin");
    } finally {
      setStarting(false);
    }
  };

  const running = Boolean(jobId);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" variant={variant} onClick={start} disabled={starting || running || disabled} title={disabled ? disabledReason : undefined}>
        {starting ? "Başlatılıyor…" : running ? `Taslak hazırlanıyor… ${elapsed > 0 ? `${elapsed} sn` : ""}` : label}
      </Button>
      {running ? (
        <span role="status" className="max-w-sm text-xs text-text-secondary">
          Genelde 30–90 sn sürer. Bu sayfadan ayrılabilirsiniz; taslak hazır olunca Aksiyonlar&apos;da görünür.
        </span>
      ) : null}
      {disabled && disabledReason ? <span className="text-xs text-muted">{disabledReason}</span> : null}
      {error ? (
        <span role="alert" className="max-w-sm text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
