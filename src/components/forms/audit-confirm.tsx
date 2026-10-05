"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";

export interface ProposalQuestion {
  text: string;
  kind: "discovery" | "need" | "info";
  topic?: string;
  issues?: string[];
}

export interface Proposal {
  business: { type: string; confidence: "high" | "medium" | "low"; reasons: string[]; evidenceUrls?: string[] };
  topics: string[];
  questions: ProposalQuestion[];
  incomplete: string | null;
  brandName: string;
}

const TYPE_LABEL: Record<string, string> = {
  manufacturer: "Üretici / kendi markası",
  retailer: "Çok markalı mağaza",
  brand_store: "Kendi markası + mağaza (karma)",
  marketplace: "Pazaryeri",
  service: "Hizmet / ajans",
  saas: "Yazılım (SaaS)",
  service_saas: "Hizmet + yazılım (karma)",
  unknown: "Belirlenemedi",
};
const KIND: Record<string, string> = { discovery: "Keşif", need: "İhtiyaç", info: "Bilgi" };
const CONF: Record<string, string> = { high: "yüksek güven", medium: "orta güven", low: "düşük güven — lütfen doğrulayın" };
const ENGINE: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Gemini", claude: "Claude", perplexity: "Perplexity" };

/**
 * Ücretsiz ölçüm onayı: işletme türü, konular, 5 soru, platformlar ve kapsam tek ekranda. Onaylanmadan AI
 * platformlarına soru sorulmaz. Düzenlenen sorular sunucuda yeniden kontrol edilir.
 */
export function AuditConfirm({
  token,
  proposal,
  scopeEngines,
  unavailable,
  pages,
  products,
  onConfirmed,
}: {
  token: string;
  proposal: Proposal;
  scopeEngines: string[];
  unavailable: Array<{ engine: string }>;
  pages: number;
  products: number;
  onConfirmed: (view: unknown) => void;
}) {
  const [type, setType] = useState(proposal.business.type);
  const [topics, setTopics] = useState<string[]>([proposal.topics[0] ?? "", proposal.topics[1] ?? ""]);
  const [questions, setQuestions] = useState<ProposalQuestion[]>(proposal.questions);
  const [selected, setSelected] = useState<boolean[]>(proposal.questions.map(() => true));
  const [incomplete, setIncomplete] = useState<string | null>(proposal.incomplete);
  const [pending, setPending] = useState<"preview" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = (path: string, body: unknown) => fetch(`/api/v1/audits/${encodeURIComponent(token)}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const regenerate = async () => {
    setPending("preview");
    setError(null);
    const res = await api("questions", { action: "preview", businessType: type, topics: topics.map((t) => t.trim()).filter(Boolean) });
    const body = await res.json().catch(() => null);
    setPending(null);
    if (!res.ok) return setError(body?.error?.message ?? "Sorular oluşturulamadı");
    setQuestions(body.data.questions);
    setSelected(body.data.questions.map(() => true));
    setIncomplete(body.data.incomplete);
  };

  const check = async (i: number) => {
    const text = questions[i]?.text ?? "";
    if (!text.trim()) return;
    const res = await api("questions", { action: "check", questions: [text] });
    const body = await res.json().catch(() => null);
    if (res.ok) setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, issues: body.data.questions[0].issues } : q)));
  };

  const chosen = questions.filter((q, i) => selected[i] && q.text.trim());
  const blocked = chosen.some((q) => (q.issues ?? []).length > 0);
  const confirm = async () => {
    setPending("confirm");
    setError(null);
    const res = await api("confirm", { questions: chosen.map((q) => q.text.trim()), businessType: type !== proposal.business.type ? type : undefined, topics: topics.map((t) => t.trim()).filter(Boolean) });
    const body = await res.json().catch(() => null);
    setPending(null);
    if (!res.ok) return setError(body?.error?.message ?? "Ölçüm başlatılamadı");
    onConfirmed(body.data);
  };

  const service = ["service", "saas", "service_saas"].includes(type);
  // Siteden soru seti çıkarılamadıysa kullanıcıdan kategori istenir (öneri yok; boş soru listesi).
  const needsTopic = proposal.questions.length === 0;
  return (
    <Card>
      <CardHeader
        title={needsTopic ? "Ne sattığınızı yazın" : "Ölçüm öncesi onay"}
        description={needsTopic ? `Sitenizden (${pages} sayfa) ölçülecek ürün grubunu güvenle çıkaramadık. Sattığınız 1–2 ana kategoriyi yazıp “Soruları oluştur”a basın; sorular siz onaylayınca AI platformlarına sorulur.` : `Siteniz incelendi (${pages} sayfa${products ? `, ${products} ürün` : ""}). AI platformlarına sorular siz onaylayınca sorulur.`}
      />
      <div className="flex flex-col gap-5 px-4 pb-5 sm:px-6">
        <section aria-labelledby="ac-type">
          <h3 id="ac-type" className="text-sm font-semibold">İşletme türü</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label="İşletme türü" value={type} onChange={(e) => setType(e.target.value)} className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm sm:min-h-9">
              {Object.entries(TYPE_LABEL).filter(([k]) => k !== "unknown" || proposal.business.type === "unknown").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {type === proposal.business.type ? <Badge tone={proposal.business.confidence === "low" ? "warning" : "neutral"}>Tahmin · {CONF[proposal.business.confidence]}</Badge> : <Badge tone="primary">Sizin seçiminiz</Badge>}
          </div>
          {type === proposal.business.type && proposal.business.reasons.length ? <p className="mt-1 text-xs text-text-secondary">Neden: {proposal.business.reasons.join("; ")}</p> : null}
        </section>

        <section aria-labelledby="ac-topics">
          <h3 id="ac-topics" className="text-sm font-semibold">{service ? "Ölçülecek hizmetler / çözümler" : "Ölçülecek kategoriler"} (en çok 2)</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            {[0, 1].map((i) => (
              <input key={i} aria-label={`${service ? "Hizmet" : "Kategori"} ${i + 1}`} value={topics[i]} maxLength={40} placeholder={service ? "ör. SEO" : "ör. Ev tekstili"} onChange={(e) => setTopics((t) => t.map((x, j) => (j === i ? e.target.value : x)))} className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm sm:min-h-9" />
            ))}
            <Button onClick={regenerate} disabled={pending !== null || !topics.some((t) => t.trim())}>{pending === "preview" ? "Oluşturuluyor…" : questions.length ? "Soruları yeniden oluştur" : "Soruları oluştur"}</Button>
          </div>
          <p className="mt-1 text-xs text-text-secondary">Bu bir ön taramadır: site geneli değil, seçili {service ? "hizmetler" : "kategoriler"} için 5 soru ölçülür.</p>
        </section>

        <section aria-labelledby="ac-q">
          <h3 id="ac-q" className="text-sm font-semibold">Sorulacak sorular</h3>
          {incomplete && !(needsTopic && questions.length === 0) ? <Alert tone="warning" title="Soru seti eksik">{incomplete}</Alert> : null}
          {questions.length === 0 ? <p className="mt-2 text-sm text-text-secondary">Kategori yazıp “Soruları oluştur”a bastığınızda sorular burada görünür.</p> : null}
          <ul className="mt-2 flex flex-col gap-2">
            {questions.map((q, i) => (
              <li key={i} className="flex items-start gap-2">
                <input type="checkbox" aria-label={`Soru ${i + 1} dahil`} checked={selected[i] ?? false} onChange={(e) => setSelected((s) => s.map((x, j) => (j === i ? e.target.checked : x)))} className="mt-3 sm:mt-2.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={q.kind === "info" ? "neutral" : "primary"}>{KIND[q.kind] ?? q.kind}</Badge>
                  </div>
                  <textarea aria-label={`Soru ${i + 1}`} value={q.text} maxLength={200} rows={2} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? { ...x, text: e.target.value, issues: undefined } : x)))} onBlur={() => check(i)} className="mt-1 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-snug" />
                  {q.issues?.length ? <p className="mt-1 text-xs text-danger">{q.issues.join(" · ")}</p> : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-secondary">Keşif ve ihtiyaç soruları markanızın önerilip önerilmediğini ölçer; bilgi sorusunda marka önerisi beklenmez ve ayrı raporlanır.</p>
        </section>

        <section aria-labelledby="ac-scope" className="rounded-md border border-border bg-bg p-3 text-sm">
          <h3 id="ac-scope" className="font-semibold">Kapsam</h3>
          <p className="mt-1">Platformlar: {scopeEngines.map((e) => ENGINE[e] ?? e).join(", ")}{unavailable.length ? <span className="text-text-secondary"> · {unavailable.map((u) => ENGINE[u.engine] ?? u.engine).join(", ")}: şu anda kullanılamıyor</span> : null}</p>
          <p className="tabular mt-1">{chosen.length} soru × {scopeEngines.length} platform = {chosen.length * scopeEngines.length} yanıt · ücretsiz ölçüm</p>
          <p className="mt-1 text-xs text-text-secondary">Web aramalı API yanıtları kullanılır; uygulamalardaki sonuçla birebir aynı değildir. Ülke/dil istenen pazardır, doğrulanmış konum değildir.</p>
        </section>

        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={confirm} disabled={pending !== null || chosen.length === 0 || blocked}>{pending === "confirm" ? "Başlatılıyor…" : "Onayla ve ölçümü başlat"}</Button>
          {blocked ? <span className="self-center text-sm text-danger">Önce işaretli sorunları düzeltin.</span> : null}
        </div>
      </div>
    </Card>
  );
}
