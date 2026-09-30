"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

export function BrandCreateForm({ url, workspaceId }: { url: string; workspaceId: string }) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", domain: "", country: "TR", language: "tr", currency: "TRY", timezone: "Europe/Istanbul" });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) {
      setFieldErrors(body?.error?.fieldErrors ?? {});
      return setError(`${body?.error?.message ?? "Eklenemedi"}${body?.requestId ? ` · istek no: ${body.requestId}` : ""}`);
    }
    router.push(`/w/${workspaceId}/onboarding?brand=${body.data.id}`);
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <Field label="Marka adı" htmlFor="b-name" error={fieldErrors.name?.[0]}><input id="b-name" className={inputClass} value={f.name} onChange={set("name")} required /></Field>
      <Field label="Alan adı" htmlFor="b-domain" error={fieldErrors.domain?.[0]}><input id="b-domain" className={inputClass} value={f.domain} onChange={set("domain")} required /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Ülke" htmlFor="b-country"><input id="b-country" className={inputClass} maxLength={2} value={f.country} onChange={set("country")} /></Field>
        <Field label="Dil" htmlFor="b-lang"><input id="b-lang" className={inputClass} maxLength={5} value={f.language} onChange={set("language")} /></Field>
        <Field label="Para birimi" htmlFor="b-cur"><input id="b-cur" className={inputClass} maxLength={3} value={f.currency} onChange={set("currency")} /></Field>
      </div>
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Ekleniyor…" : "Ekle ve kuruluma geç"}</Button>
    </form>
  );
}
