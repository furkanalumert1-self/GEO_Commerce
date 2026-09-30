"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Field, inputClass } from "@/components/ui";

const schema = z.object({
  text: z.string().trim().min(5, "En az 5 karakter").max(500),
  clusterId: z.string().optional(),
  clusterLabel: z.string().trim().max(120).optional(),
  weight: z.coerce.number().min(0.1).max(5),
});

export function PromptForm({ url, clusters, locale }: { url: string; clusters: Array<{ id: string; label: string }>; locale: string }) {
  const router = useRouter();
  const [server, setServer] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { register, handleSubmit, formState, reset, watch } = useForm({ resolver: zodResolver(schema), defaultValues: { text: "", clusterId: "", clusterLabel: "", weight: 1 } });
  const clusterId = watch("clusterId");

  const onSubmit = handleSubmit(async (v) => {
    setServer(null);
    setDone(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: v.text, weight: v.weight, locale, ...(v.clusterId ? { clusterId: v.clusterId } : { clusterLabel: v.clusterLabel || undefined }) }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setServer(`${body?.error?.message ?? "Kaydedilemedi"}${body?.requestId ? ` · istek no: ${body.requestId}` : ""}`);
      return;
    }
    setDone(`Eklendi · ticari niyet ${body.data.commercialScore}/100`);
    reset();
    router.refresh();
  });

  const errs = Object.entries(formState.errors);
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      {errs.length ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm">
          Lütfen işaretli alanları düzeltin.
        </div>
      ) : null}
      <Field label="Soru" htmlFor="p-text" error={formState.errors.text?.message}>
        <textarea id="p-text" rows={3} className={`${inputClass} py-2`} aria-invalid={Boolean(formState.errors.text)} aria-describedby={formState.errors.text ? "p-text-error" : undefined} {...register("text")} />
      </Field>
      <Field label="Niyet kümesi" htmlFor="p-cluster">
        <select id="p-cluster" className={inputClass} {...register("clusterId")}>
          <option value="">Yeni küme oluştur</option>
          {clusters.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </Field>
      {!clusterId ? (
        <Field label="Yeni küme adı" htmlFor="p-cl-label" hint="Boş bırakılırsa sorudan türetilir">
          <input id="p-cl-label" className={inputClass} {...register("clusterLabel")} />
        </Field>
      ) : null}
      <Field label="Ağırlık" htmlFor="p-weight" error={formState.errors.weight?.message} hint="0,1–5 arası; skorlarda ağırlık olarak kullanılır">
        <input id="p-weight" type="number" step="0.1" min="0.1" max="5" className={inputClass} {...register("weight")} />
      </Field>
      {server ? <p role="alert" className="text-sm text-danger">{server}</p> : null}
      {done ? <p role="status" className="text-sm text-success">{done}</p> : null}
      <Button type="submit" variant="primary" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Kaydediliyor…" : "Prompt ekle"}</Button>
    </form>
  );
}
