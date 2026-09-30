"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

export function CompetitorForm({ url }: { url: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [server, setServer] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs.name = "Ad girin";
    if (!/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}/i.test(domain.trim())) errs.domain = "Geçerli alan adı girin";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    setServer(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, domain }) });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) return setServer(`${body?.error?.message ?? "Eklenemedi"}${body?.requestId ? ` · istek no: ${body.requestId}` : ""}`);
    setName("");
    setDomain("");
    router.refresh();
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      {Object.keys(errors).length ? <p role="alert" className="text-sm text-danger">Lütfen işaretli alanları düzeltin.</p> : null}
      <Field label="Marka adı" htmlFor="c-name" error={errors.name}>
        <input id="c-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name)} />
      </Field>
      <Field label="Alan adı" htmlFor="c-domain" error={errors.domain}>
        <input id="c-domain" className={inputClass} value={domain} onChange={(e) => setDomain(e.target.value)} aria-invalid={Boolean(errors.domain)} />
      </Field>
      {server ? <p role="alert" className="text-sm text-danger">{server}</p> : null}
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Ekleniyor…" : "Ekle ve onayla"}</Button>
    </form>
  );
}
