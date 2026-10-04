"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, inputClass } from "@/components/ui";

/** Takipteki soruyu düzenleme: yeni sürüm oluşturur (eski ölçümler silinmez). Mükerrer kontrolü sunucuda. */
export function PromptEdit({ url, text }: { url: string; text: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    setError(null);
    const res = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: value.trim() }) });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) return setError(body?.error?.message ?? "Kaydedilemedi");
    setOpen(false);
    router.refresh();
  };
  if (!open) return <Button type="button" variant="ghost" onClick={() => setOpen(true)}>Düzenle</Button>;
  return (
    <div className="flex min-w-[14rem] flex-col gap-1.5">
      <label className="sr-only" htmlFor={`edit-${url}`}>Soru metni</label>
      <textarea id={`edit-${url}`} rows={2} className={`${inputClass} py-2`} value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} />
      <p className="text-xs text-text-secondary">Kaydetmek yeni sürüm oluşturur; önceki ölçümler korunur ve yeni sürüm yeni bir başlangıç ölçümü gerektirir.</p>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" variant="primary" onClick={save} disabled={pending || value.trim().length < 5 || value.trim() === text}>{pending ? "Kaydediliyor…" : "Kaydet"}</Button>
        <Button type="button" variant="ghost" onClick={() => { setOpen(false); setValue(text); setError(null); }}>Vazgeç</Button>
      </div>
    </div>
  );
}
