"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function ShareReportButton({ url }: { url: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        disabled={pending}
        onClick={async () => {
          if (!window.confirm("7 gün geçerli, herkesin açabileceği bir paylaşım bağlantısı oluşturulsun mu?")) return;
          setPending(true);
          const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: 7 }) });
          const body = await res.json().catch(() => null);
          setPending(false);
          if (!res.ok) return setError(body?.error?.message ?? "Bağlantı oluşturulamadı");
          setLink(body.data.url);
        }}
      >
        Paylaşım bağlantısı
      </Button>
      {link ? <input readOnly aria-label="Paylaşım bağlantısı" className="w-64 rounded-md border border-border px-2 text-xs" value={link} onFocus={(e) => e.currentTarget.select()} /> : null}
      {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
    </span>
  );
}
