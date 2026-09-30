"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function DomainVerification({ api }: { api: string }) {
  const [challenge, setChallenge] = useState<{ instructions: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const post = async (url: string, body: unknown) => {
    setPending(true);
    setMsg(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) {
      setMsg(json?.error?.message ?? "İşlem başarısız");
      return null;
    }
    return json.data;
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={async () => setChallenge(await post(api, { method: "dns_txt" }))}>DNS TXT ile doğrula</Button>
        <Button disabled={pending} onClick={async () => setChallenge(await post(api, { method: "html_token" }))}>HTML meta ile doğrula</Button>
      </div>
      {challenge ? (
        <>
          <code className="block overflow-x-auto rounded-md bg-bg p-2 text-xs">{challenge.instructions}</code>
          <Button disabled={pending} onClick={async () => {
            const r = await post(`${api}/check`, {});
            if (r) setMsg(r.verified ? "Alan adı doğrulandı." : "Kayıt henüz bulunamadı; DNS yayılımı birkaç saat sürebilir.");
          }}>Kontrol et</Button>
        </>
      ) : null}
      {msg ? <p role="status" className="text-sm">{msg}</p> : null}
    </div>
  );
}
