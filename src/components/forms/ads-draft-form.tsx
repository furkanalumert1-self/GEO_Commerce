"use client";

import { useState } from "react";
import { Badge, Button, Field, inputClass } from "@/components/ui";

type Issue = { level: "error" | "warning" | "info"; field: string; message: string };
const LIMITS = { title: { max: 50, rec: [16, 24] }, body: { max: 100, rec: [32, 48] } } as const;

function Counter({ value, limit }: { value: string; limit: { max: number; rec: readonly [number, number] } }) {
  const n = [...value.trim()].length;
  const tone = n > limit.max ? "text-danger" : n >= limit.rec[0] && n <= limit.rec[1] ? "text-success" : "text-muted";
  return <span className={`text-xs ${tone}`}>{n}/{limit.max} · önerilen {limit.rec[0]}–{limit.rec[1]}</span>;
}

export function AdsDraftForm({ url, opportunities, domain, currency }: { url: string; opportunities: Array<{ id: string; label: string }>; domain: string; currency: string }) {
  const [f, setF] = useState({ platform: "chatgpt" as "chatgpt" | "generic", opportunityId: opportunities[0]?.id ?? "", headline: "", body: "", landingUrl: `https://${domain}/`, dailyBudget: "", maxCpc: "" });
  const [result, setResult] = useState<{ csv: string; payload?: unknown; issues: Issue[]; hints: string[]; valid: boolean | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const chatgpt = f.platform === "chatgpt";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...f, dailyBudget: f.dailyBudget ? Number(f.dailyBudget) : undefined, maxCpc: f.maxCpc ? Number(f.maxCpc) : undefined, currency }),
    });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) return setError(`${body?.error?.message ?? "Taslak oluşturulamadı"}${body?.requestId ? ` · istek no: ${body.requestId}` : ""}`);
    setResult({ csv: body.data.csv, payload: body.data.payload, issues: body.data.validation?.issues ?? [], hints: body.data.draft?.contextHints ?? [], valid: body.data.validation?.valid ?? null });
  };
  const download = (content: string, name: string, type: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
  };
  if (opportunities.length === 0) return <p className="text-sm text-muted">Taslak için açık fırsat yok.</p>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Platform" htmlFor="ad-platform" hint={chatgpt ? "ChatGPT Ads: yanıtın altında sohbet kartı (başlık, metin, kare görsel, tek hedef URL). Hedefleme anahtar kelimeyle değil, sohbet bağlamıyla yapılır." : undefined}>
        <select id="ad-platform" className={inputClass} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value as "chatgpt" | "generic" })}>
          <option value="chatgpt">ChatGPT Ads (OpenAI)</option>
          <option value="generic">Genel brief (Google/Meta)</option>
        </select>
      </Field>
      <Field label="Fırsat" htmlFor="ad-opp"><select id="ad-opp" className={inputClass} value={f.opportunityId} onChange={(e) => setF({ ...f, opportunityId: e.target.value })}>{opportunities.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
      <Field label="Başlık" htmlFor="ad-h" hint={chatgpt ? <Counter value={f.headline} limit={LIMITS.title} /> : undefined}><input id="ad-h" className={inputClass} value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} required minLength={3} /></Field>
      <Field label="Metin" htmlFor="ad-b" hint={chatgpt ? <Counter value={f.body} limit={LIMITS.body} /> : undefined}><textarea id="ad-b" rows={3} className={`${inputClass} py-2`} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required minLength={3} /></Field>
      <Field label="Hedef URL" htmlFor="ad-l" hint="Doğrulanmış işletme alan adında, https"><input id="ad-l" type="url" className={inputClass} value={f.landingUrl} onChange={(e) => setF({ ...f, landingUrl: e.target.value })} required /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Günlük bütçe (${currency}, opsiyonel)`} htmlFor="ad-bud"><input id="ad-bud" type="number" min="0" step="0.01" className={inputClass} value={f.dailyBudget} onChange={(e) => setF({ ...f, dailyBudget: e.target.value })} /></Field>
        {chatgpt ? <Field label={`Maks. tıklama başı teklif (${currency}, opsiyonel)`} htmlFor="ad-cpc"><input id="ad-cpc" type="number" min="0" step="0.01" className={inputClass} value={f.maxCpc} onChange={(e) => setF({ ...f, maxCpc: e.target.value })} /></Field> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>{pending ? "Hazırlanıyor…" : chatgpt ? "Doğrula ve taslak oluştur" : "Taslak oluştur"}</Button>
        {result ? <Button type="button" onClick={() => download(result.csv, chatgpt ? "chatgpt-ads-taslak.csv" : "kampanya-taslagi.csv", "text/csv;charset=utf-8")}>CSV indir</Button> : null}
        {result?.payload ? <Button type="button" onClick={() => download(JSON.stringify(result.payload, null, 2), "openai-ads-api-taslak.json", "application/json")}>API taslağı (JSON)</Button> : null}
      </div>
      {result ? (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
          <p>
            {result.valid === null ? <Badge>Sağlayıcı doğrulaması yok</Badge> : result.valid ? <Badge tone="success">Kurallara uygun</Badge> : <Badge tone="danger">Düzeltme gerekli</Badge>}{" "}
            <span className="text-xs text-muted">Yerel kural kontrolü; nihai onay ChatGPT Ads Manager incelemesindedir.</span>
          </p>
          {result.issues.length ? (
            <ul className="flex flex-col gap-1">
              {result.issues.map((i, k) => (
                <li key={k} className={i.level === "error" ? "text-danger" : i.level === "warning" ? "text-warning" : "text-muted"}>{i.level === "error" ? "Hata" : i.level === "warning" ? "Uyarı" : "Bilgi"}: {i.message}</li>
              ))}
            </ul>
          ) : null}
          {result.hints.length ? (
            <div>
              <p className="text-xs font-medium">Bağlam ipuçları (context hints) · {result.hints.length}</p>
              <p className="text-xs text-muted">{result.hints.slice(0, 12).join(" · ")}{result.hints.length > 12 ? " …" : ""}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
