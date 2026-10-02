"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { InlineJobDriver } from "@/components/data/inline-job-driver";

/**
 * İş başlatan düğme (ör. site taraması). Worker modunda iş kuyruğa alınır; inline modda aynı yerde sınırlı
 * adımlarla ilerletilir ve ilerleme gösterilir.
 */
export function JobStartButton({ url, body, label, inline, queuedMessage, runningLabel }: { url: string; body: unknown; label: string; inline: boolean; queuedMessage: string; runningLabel: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const start = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      if (!res.ok) return setError(`${json?.error?.message ?? "Başlatılamadı"}${json?.requestId ? ` · istek no: ${json.requestId}` : ""}`);
      if (inline && json?.data?.jobId) setJobId(json.data.jobId);
      else {
        setMessage(queuedMessage);
        router.refresh();
      }
    } catch {
      setError("Bağlantı hatası; tekrar deneyin");
    } finally {
      setPending(false);
    }
  };
  return (
    <span className="inline-flex max-w-md flex-col gap-2">
      <Button onClick={start} disabled={pending || Boolean(jobId)}>{pending ? "Başlatılıyor…" : label}</Button>
      {jobId ? <InlineJobDriver advanceUrl={`/api/v1/jobs/${jobId}/advance`} initialStatus="queued" label={runningLabel} onDone={() => setMessage("Tamamlandı")} /> : null}
      {message ? <span role="status" className="text-xs text-success">{message}</span> : null}
      {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
