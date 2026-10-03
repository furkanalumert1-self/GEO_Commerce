"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Field, inputClass } from "@/components/ui";

const schema = z.object({
  domain: z
    .string()
    .trim()
    .min(3, "Web sitenizi girin")
    .max(253)
    .regex(/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i, "Geçerli bir web sitesi girin (ör. magazaniz.com)"),
  locale: z.enum(["tr-TR", "en-US"]),
});

type Values = z.infer<typeof schema>;

function fingerprint(): string {
  try {
    const k = "geo_fp";
    const existing = window.localStorage.getItem(k);
    if (existing) return existing;
    const v = crypto.randomUUID();
    window.localStorage.setItem(k, v);
    return v;
  } catch {
    return `${navigator.userAgent}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  }
}

export function AuditForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<{ message: string; requestId?: string } | null>(null);
  const { register, handleSubmit, formState, setError } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { domain: "", locale: "tr-TR" } });

  const onSubmit = async (v: Values) => {
    setServerError(null);
    const res = await fetch("/api/v1/audits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: v.domain, locale: v.locale, fingerprint: fingerprint() }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const fe = body?.error?.fieldErrors?.domain?.[0];
      if (fe) setError("domain", { message: fe });
      setServerError({ message: body?.error?.message ?? "Audit başlatılamadı", requestId: body?.requestId });
      return;
    }
    router.push(`/audit/${body.data.token}`);
  };

  const err = formState.errors.domain?.message;
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3">
      {serverError ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm">
          {serverError.message}
          {serverError.requestId ? <span className="block text-xs text-muted">İstek no: {serverError.requestId}</span> : null}
        </div>
      ) : null}
      <Field label="Web siteniz" htmlFor="domain" error={err} hint={demo ? "Web siteniz canlı taranır. Örnek veriyle denemek için lumabakim.example yazabilirsiniz." : "Yalnız herkese açık sayfalar taranır; robots.txt kurallarına uyulur."}>
        <input id="domain" placeholder="magazaniz.com" inputMode="url" autoComplete="url" className={inputClass} aria-invalid={Boolean(err)} aria-describedby={err ? "domain-error" : "domain-hint"} {...register("domain")} />
      </Field>
      <Field label="Hedef ülke ve dil" htmlFor="locale">
        <select id="locale" className={inputClass} {...register("locale")}>
          <option value="tr-TR">Türkiye · Türkçe</option>
          <option value="en-US">ABD · İngilizce</option>
        </select>
      </Field>
      <Button type="submit" variant="primary" className="mt-1 min-h-12 text-base sm:min-h-12" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? "Başlatılıyor…" : "Ücretsiz ölçümü başlat"}
      </Button>
    </form>
  );
}
