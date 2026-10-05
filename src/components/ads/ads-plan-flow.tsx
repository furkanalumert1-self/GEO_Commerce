"use client";

import { useMemo, useState } from "react";
import { Badge, Button, cn, inputClass } from "@/components/ui";

export interface FlowDraft {
  key: string;
  angle: string;
  title: string;
  body: string;
  cta: string;
  facts: string[];
}

export interface FlowGroup {
  clusterId: string;
  label: string;
  answers: number;
  brandMentioned: number;
  lostTo: Array<{ name: string; count: number }>;
  prompts: string[];
  promptStats: Array<{ text: string; answers: number; brand: number; lost: number }>;
  /** Bu gruba eşleşen doğrulanmış ürün adları (katalog). */
  products: string[];
  /** 3 farklı açıdan taslak (ürün keşfi / ihtiyaç / hediye veya karşılaştırma). */
  drafts: FlowDraft[];
  targets: Array<{ url: string; label: string; kind: "category" | "product" | "home" }>;
}

type Mode = "measurement" | "product" | "manual";
type StepState = "done" | "needed" | "todo";
const STATE_LABEL: Record<StepState, string> = { done: "Tamamlandı", needed: "Gerekli", todo: "Bekliyor" };

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
/** Bilgi sorusu: marka/ürün önerisi beklenmez; reklam bağlamı olarak varsayılan seçili değil. */
const informational = (t: string) => /(nedir|ne işe yarar|nasıl kullanılır|nasıl yapılır|neden olur|zararlı mı|faydaları|nelere dikkat)/i.test(t);

/**
 * Reklam taslağı akışı (3 adım): Konu ve ürünler → Metni seçin → Önizleyin ve alın. Kaynak modu açık seçilir:
 * ölçüm sonuçlarından (soru seçimi gerekir) veya ürün bilgilerinden (soru gerekmez); ikisi de yoksa elle taslak.
 * Tamamlanma gerçek koşullara bağlıdır; kategori/metin değişince seçim ve onay sıfırlanır. Yayın yapılmaz.
 */
export function AdsPlanFlow({ groups, brandName, domain, days, initialGroup, catalogEmpty }: { groups: FlowGroup[]; brandName: string; domain: string; days: number; initialGroup?: string; catalogEmpty: boolean }) {
  const initial = groups.find((g) => g.clusterId === initialGroup) ?? null;
  const modeFor = (g: FlowGroup | null): Mode => (g && g.promptStats.length ? "measurement" : g && g.products.length ? "product" : "manual");
  const defaults = (g: FlowGroup | null) => new Set((g?.promptStats ?? []).filter((p) => !informational(p.text)).map((p) => p.text));
  const [key, setKey] = useState<string>(initial?.clusterId ?? "");
  const group = groups.find((g) => g.clusterId === key) ?? null;
  const [mode, setMode] = useState<Mode>(modeFor(initial));
  const [chosen, setChosen] = useState<Set<string>>(() => defaults(initial));
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  // Hedef sayfa varsayılanı: kategori sayfası, yoksa ilk ürün (ana sayfa varsayılan değildir).
  const defaultTarget = (g: FlowGroup | null) => (g?.targets.find((t) => t.kind === "category") ?? g?.targets.find((t) => t.kind === "product"))?.url ?? "";
  const [target, setTarget] = useState(() => defaultTarget(initial));
  const [custom, setCustom] = useState("");
  const [copied, setCopied] = useState<"copy" | "csv" | null>(null);
  const url = target === "__custom" ? custom.trim() : target;
  const urlOk = useMemo(() => {
    try {
      const u = new URL(url);
      const d = domain.replace(/^www\./, "");
      return u.protocol === "https:" && (u.hostname === d || u.hostname.endsWith(`.${d}`));
    } catch {
      return false;
    }
  }, [url, domain]);

  const reset = (g: FlowGroup | null, m: Mode) => {
    setMode(m);
    setChosen(defaults(g));
    setDraftKey(null);
    setTitle("");
    setBody("");
    setEdited(false);
    setCopied(null);
  };
  const chooseGroup = (k: string) => {
    const g = groups.find((x) => x.clusterId === k) ?? null;
    setKey(k);
    setTarget(defaultTarget(g));
    setCustom("");
    reset(g, modeFor(g));
  };
  const selectDraft = (d: FlowDraft) => {
    setDraftKey(d.key);
    setTitle(d.title);
    setBody(d.body);
    setEdited(false);
    setCopied(null);
  };

  const hasStats = (group?.promptStats.length ?? 0) > 0;
  const hasProducts = (group?.products.length ?? 0) > 0;
  const contextOk = mode === "measurement" ? chosen.size > 0 : mode === "product" ? hasProducts : true;
  const textOk = Boolean(title.trim() && body.trim() && (draftKey || mode === "manual"));
  // Tek somut engel ve çözümü (kopyalama kapalıysa).
  const blocker = !group
    ? "Önce bir ürün grubu seçin."
    : !contextOk
      ? mode === "measurement"
        ? "Ölçüm sonuçlarından hazırlamak için en az bir soru seçin ya da “Ürün bilgilerinden” moduna geçin."
        : "Bu grup için ürün bilgisi yok; ürün ekleyin ya da elle taslak yazın."
      : !url
        ? "İlgili ürün veya kategori sayfasını seçin."
        : !urlOk
          ? `Hedef sayfa https ile başlamalı ve ${domain} alan adınızda olmalı.`
          : !textOk
            ? "Bir taslak seçin (“Bu taslağı seç”) veya metni yazın."
            : null;
  const steps: Array<[string, StepState]> = [
    ["Konu ve ürünler", group && contextOk && urlOk ? "done" : group ? "needed" : "needed"],
    ["Metni seçin", textOk ? "done" : group && contextOk ? "needed" : "todo"],
    ["Önizleyin ve alın", copied ? "done" : !blocker ? "needed" : "todo"],
  ];
  const sourceLabel = mode === "measurement" ? `Ölçüm sonuçlarından (${chosen.size} soru)` : mode === "product" ? "Ürün bilgilerinden hazırlanıyor" : "Elle taslak";
  const text = `Başlık: ${title.trim()}\nMetin: ${body.trim()}\nHedef sayfa: ${url}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copy");
    } catch {
      setCopied(null);
    }
  };
  const download = () => {
    const rows = [["Reklam grubu", "Kaynak", "Başlık", "Metin", "Hedef sayfa", "Dayandığı sorular"], [group?.label ?? "", sourceLabel, title.trim(), body.trim(), url, mode === "measurement" ? [...chosen].join(" | ") : ""]];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`], { type: "text/csv;charset=utf-8" }));
    a.download = `reklam-taslagi-${(group?.label ?? "grup").toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, "-")}.csv`;
    a.click();
    setCopied("csv");
  };

  if (!groups.length) {
    return <p className="text-sm text-text-secondary">Reklam taslağı için önce ürün gruplarınızı oluşturun: Ürünlerim sayfasında siteyi inceleyin, kategori sütunu olan bir ürün dosyası (CSV) yükleyin veya takip edeceğiniz soruları seçin.</p>;
  }

  const draft = group?.drafts.find((d) => d.key === draftKey) ?? null;
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Adımlar">
        {steps.map(([label, st], i) => (
          <li key={label} className="flex items-center gap-1.5">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", st === "done" ? "bg-success-soft text-success" : st === "needed" ? "bg-warning-soft text-warning" : "bg-surface-subtle text-text-secondary")}>{STATE_LABEL[st]}</span>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-5 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <section aria-labelledby="ads-s1" className="flex flex-col gap-3 text-sm">
            <h3 id="ads-s1" className="font-semibold">1. Konu ve ürünler</h3>
            <label className="flex flex-col gap-1.5">
              <span>Ürün grubu</span>
              <select className={cn(inputClass, "min-h-12")} value={key} onChange={(e) => chooseGroup(e.target.value)}>
                <option value="">— Ürün grubu seçin —</option>
                {groups.map((g) => <option key={g.clusterId} value={g.clusterId}>{g.label}{g.answers ? ` · ${g.answers} yanıt` : g.products.length ? ` · ${g.products.length} ürün` : ""}</option>)}
              </select>
            </label>

            {group ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1">Taslağın kaynağı</legend>
                <div className="flex flex-wrap gap-2">
                  {([["measurement", "Ölçüm sonuçlarından", hasStats], ["product", "Ürün bilgilerinden", hasProducts], ["manual", "Elle yazacağım", true]] as Array<[Mode, string, boolean]>).map(([m, label, enabled]) => (
                    <label key={m} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3", mode === m ? "border-primary bg-primary/5" : "border-border", !enabled && "cursor-not-allowed opacity-50")}>
                      <input type="radio" name="ads-mode" value={m} checked={mode === m} disabled={!enabled} onChange={() => reset(group, m)} className="accent-[var(--color-primary)]" />
                      {label}
                    </label>
                  ))}
                </div>
                {!hasStats ? <p className="text-xs text-text-secondary">Bu grup için ölçüm sonucu yok; ürün bilgilerinden hazırlanabilir. Ölçüm sonucu gibi gösterilmez.</p> : null}

                {mode === "measurement" ? (
                  <div className="flex flex-col gap-1.5">
                    {group.promptStats.map((p) => {
                      const info = informational(p.text);
                      return (
                        <label key={p.text} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2">
                          <input type="checkbox" className="mt-1 h-4 w-4 flex-none accent-[var(--color-primary)]" checked={chosen.has(p.text)} onChange={() => { setChosen((c) => { const n = new Set(c); if (n.has(p.text)) n.delete(p.text); else n.add(p.text); return n; }); setCopied(null); }} />
                          <span className="min-w-0 flex-1">
                            <span className="[overflow-wrap:anywhere]">{p.text}</span>
                            <span className="block text-xs text-text-secondary">{p.answers} yanıt · {p.brand ? `markanız ${p.brand} yanıtta anıldı` : "markanız anılmadı"}{p.lost ? ` · rakipler ${p.lost} yanıtta öne çıktı` : ""}{info ? " · bilgi sorusu" : ""}</span>
                          </span>
                        </label>
                      );
                    })}
                    <p className="text-xs text-text-secondary">Son {days} günün organik AI yanıtlarıdır; reklam performansı veya arama hacmi değildir.</p>
                  </div>
                ) : null}

                {mode === "product" ? (
                  <details className="rounded-md border border-border px-3 py-2">
                    <summary className="min-h-9 cursor-pointer py-1">Bu gruba bağlı {group.products.length} ürün</summary>
                    <ul className="mt-1 list-disc pl-5 text-text-secondary">{group.products.slice(0, 8).map((p) => <li key={p} className="[overflow-wrap:anywhere]">{p}</li>)}</ul>
                  </details>
                ) : null}
                {catalogEmpty && mode !== "measurement" ? <p className="rounded-md bg-warning-soft px-3 py-2 text-xs">Katalogda ürün yok: Ürünlerim sayfasında “Siteyi incele ve ürünleri bul” ile ürünlerinizi ekleyince taslaklar ürünlerinize göre hazırlanır.</p> : null}
              </fieldset>
            ) : null}

            {group ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ad-target">Hedef sayfa</label>
                <select id="ad-target" className={cn(inputClass, "min-h-12")} value={target} onChange={(e) => { setTarget(e.target.value); setCopied(null); }} aria-invalid={!urlOk && target !== ""} aria-describedby="ad-target-help">
                  <option value="">— İlgili ürün veya kategori sayfasını seçin —</option>
                  {group.targets.map((t) => <option key={t.url} value={t.url}>{t.label}{t.kind === "home" ? " (önerilmez)" : ""}</option>)}
                  <option value="__custom">Başka bir sayfa adresi gireceğim</option>
                </select>
                {target === "__custom" ? <input aria-label="Hedef sayfa adresi" className={inputClass} placeholder={`https://${domain}/...`} value={custom} onChange={(e) => { setCustom(e.target.value); setCopied(null); }} /> : null}
                <span id="ad-target-help" className={cn("text-xs", url && !urlOk ? "text-danger" : "text-text-secondary")} role={url && !urlOk ? "alert" : undefined}>
                  {url && !urlOk ? `Hedef sayfa https ile başlamalı ve ${domain} alan adınızda olmalı.` : "Ürün veya kategori sayfası önerilir; ana sayfa genelde daha az uygundur. Sayfanın açıldığını reklam platformunda yayın öncesi kontrol edin."}
                </span>
              </div>
            ) : null}
          </section>

          {group && contextOk ? (
            <section aria-labelledby="ads-s2" className="flex flex-col gap-3 text-sm">
              <h3 id="ads-s2" className="font-semibold">2. Metni seçin</h3>
              {mode !== "manual" ? (
                <ul className="grid gap-2">
                  {group.drafts.map((d) => (
                    <li key={d.key} className={cn("rounded-md border px-3 py-2.5", draftKey === d.key ? "border-primary bg-primary/5" : "border-border")}>
                      <p className="text-xs font-semibold text-text-secondary">{d.angle}</p>
                      <p className="font-medium [overflow-wrap:anywhere]">{d.title}</p>
                      <p className="[overflow-wrap:anywhere]">{d.body}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Button type="button" onClick={() => selectDraft(d)} variant={draftKey === d.key ? "primary" : "secondary"}>{draftKey === d.key ? "Seçildi" : "Bu taslağı seç"}</Button>
                        <span className="text-xs text-text-secondary">Önerilen buton: {d.cta}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!hasProducts && mode !== "measurement" ? <p className="text-xs text-text-secondary">Ürün bilgisi olmadığı için taslaklar geneldir; ürün özelliği, fiyat veya stok iddiası içermez.</p> : null}
              {draftKey || mode === "manual" ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ad-title" className="font-medium">Başlık</label>
                  <input id="ad-title" className={inputClass} value={title} onChange={(e) => { setTitle(e.target.value); setEdited(true); setCopied(null); }} maxLength={120} />
                  <span className="text-right text-xs text-text-secondary">{[...title.trim()].length} karakter</span>
                  <label htmlFor="ad-body" className="font-medium">Metin</label>
                  <textarea id="ad-body" rows={3} className={cn(inputClass, "py-2")} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); setCopied(null); }} maxLength={300} />
                  <span className="text-right text-xs text-text-secondary">{[...body.trim()].length} karakter{edited ? " · düzenlendi" : ""}</span>
                  <span className="text-xs text-text-secondary">“En iyi”, indirim, fiyat, stok veya performans iddiasını yalnız sitenizde kanıtlıyorsanız ekleyin.</span>
                  {draft?.facts.length ? (
                    <details className="text-xs text-text-secondary">
                      <summary className="min-h-9 cursor-pointer py-1">Kullanılan ürün bilgileri</summary>
                      <ul className="list-disc pl-5">{draft.facts.map((f) => <li key={f} className="[overflow-wrap:anywhere]">{f}</li>)}</ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <p className="text-base font-semibold">3. Önizleyin ve alın</p>
          <p className="text-xs text-text-secondary">Örnek reklam görünümü; resmî reklam formatı değildir, nihai görünüm reklam platformundadır.</p>
          <div className="rounded-[14px] border border-border p-3.5">
            <p className="text-xs text-text-secondary">Sponsorlu · {domain}</p>
            <p className="font-semibold [overflow-wrap:anywhere]">{title.trim() || "Başlık"}</p>
            <p className="text-sm [overflow-wrap:anywhere]">{body.trim() || "Metin"}</p>
            {draft ? <p className="mt-1 text-xs font-medium text-primary">{draft.cta}</p> : null}
            <p className="mt-2 text-[11px] text-text-secondary">Görsel eklenmedi; görseli reklam platformunda ekleyin.</p>
          </div>
          {group ? <p className="text-xs text-text-secondary">Kaynak: {sourceLabel}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" onClick={copy} disabled={Boolean(blocker)}>Taslağı kopyala</Button>
            <Button type="button" onClick={download} disabled={Boolean(blocker)}>CSV indir</Button>
          </div>
          {copied ? <p role="status" className="text-sm text-success">{copied === "copy" ? "Taslak panoya kopyalandı." : "CSV indirildi."} Bu, yayın ya da onay anlamına gelmez.</p> : null}
          {blocker ? <p className="text-xs text-text-secondary" role="status">{blocker}</p> : null}
          <p className="text-xs text-text-secondary">Durum: <Badge>Taslak</Badge> · {brandName} için yayın bu ekrandan yapılmaz.</p>
        </div>
      </div>
    </div>
  );
}
