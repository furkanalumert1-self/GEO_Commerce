"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";

/**
 * Tek eylemli API butonu: pending iken disable, onaylı destructive işlem, hata inline + requestId,
 * maliyetli POST'larda Idempotency-Key. Başarıda sayfa verisi yenilenir veya yönlendirilir.
 */
export function ApiButton({
  url,
  method = "POST",
  body,
  label,
  pendingLabel,
  variant = "secondary",
  confirm,
  redirectTo,
  idempotent = false,
  disabled,
  disabledReason,
  onSuccessMessage,
}: {
  url: string;
  method?: "POST" | "PATCH" | "DELETE" | "PUT";
  body?: unknown;
  label: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  confirm?: string;
  /** Başarıda yönlendirme; "{alan}" yer tutucuları yanıt verisinden doldurulur (ör. "/x/{id}", "{url}"). */
  redirectTo?: string;
  idempotent?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSuccessMessage?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const run = async () => {
    if (confirm && !window.confirm(confirm)) return;
    setPending(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json", ...(idempotent ? { "idempotency-key": crypto.randomUUID() } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        // Sunucu/ağ zaman aşımında gövde JSON olmaz: teknik kod yerine ne yapılacağı söylenir.
        const fallback = !json || res.status >= 500 ? "Sunucu zamanında yanıt vermedi. Biraz sonra tekrar deneyin; işlem tamamlandıysa sayfayı yenileyince görünür." : "İşlem tamamlanamadı";
        setError(`${json?.error?.message ?? fallback}${json?.requestId ? ` · istek no: ${json.requestId}` : ""}`);
        return;
      }
      if (redirectTo) {
        const target = redirectTo.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(json?.data?.[k] ?? "")));
        if (/^https:\/\//.test(decodeURIComponent(target))) window.location.assign(decodeURIComponent(target));
        else router.push(target);
        return;
      }
      if (onSuccessMessage) setOk(onSuccessMessage);
      router.refresh();
    } catch {
      setError("Bağlantı hatası; tekrar deneyin");
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" variant={variant} onClick={run} disabled={pending || disabled} title={disabled ? disabledReason : undefined} aria-describedby={disabled && disabledReason ? undefined : undefined}>
        {pending ? (pendingLabel ?? "İşleniyor…") : label}
      </Button>
      {disabled && disabledReason ? <span className="text-xs text-muted">{disabledReason}</span> : null}
      {error ? (
        <span role="alert" className="max-w-sm text-xs text-danger">
          {error}
        </span>
      ) : null}
      {ok ? (
        <span role="status" className="text-xs text-success">
          {ok}
        </span>
      ) : null}
    </span>
  );
}
