"use client";

import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

export function AdsDraftForm({ url, opportunities, domain, currency }: { url: string; opportunities: Array<{ id: string; label: string }>; domain: string; currency: string }) {
  const [f, setF] = useState({ opportunityId: opportunities[0]?.id ?? "", headline: "", body: "", landingUrl: `https://${domain}/`, dailyBudget: "" });
  const [csv, setCsv] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, dailyBudget: f.dailyBudget ? Number(f.dailyBudget) : undefined, currency }) });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) return setError(`${body?.error?.message ?? "Taslak oluşturulamadı"}${body?.requestId ? ` · istek no: ${body.requestId}` : ""}`);
    setCsv(body.data.csv);
  };
  const download = () => {
    if (!csv) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "kampanya-taslagi.csv";
    a.click();
  };
  if (opportunities.length === 0) return <p className="text-sm text-muted">Taslak için açık fırsat yok.</p>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Fırsat" htmlFor="ad-opp"><select id="ad-opp" className={inputClass} value={f.opportunityId} onChange={(e) => setF({ ...f, opportunityId: e.target.value })}>{opportunities.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
      <Field label="Başlık" htmlFor="ad-h"><input id="ad-h" className={inputClass} value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} required minLength={3} /></Field>
      <Field label="Metin" htmlFor="ad-b"><textarea id="ad-b" rows={3} className={`${inputClass} py-2`} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required minLength={3} /></Field>
      <Field label="Landing URL" htmlFor="ad-l"><input id="ad-l" type="url" className={inputClass} value={f.landingUrl} onChange={(e) => setF({ ...f, landingUrl: e.target.value })} required /></Field>
      <Field label={`Günlük bütçe (${currency}, opsiyonel)`} htmlFor="ad-bud"><input id="ad-bud" type="number" min="0" step="0.01" className={inputClass} value={f.dailyBudget} onChange={(e) => setF({ ...f, dailyBudget: e.target.value })} /></Field>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "Hazırlanıyor…" : "Taslak oluştur"}</Button>
        {csv ? <Button type="button" onClick={download}>CSV indir</Button> : null}
      </div>
      {csv ? <p role="status" className="text-xs text-muted">Taslak hazır. Sağlayıcı doğrulaması yapılmadı.</p> : null}
    </form>
  );
}
