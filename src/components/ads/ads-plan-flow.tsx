"use client";

import { useMemo, useState } from "react";
import { Badge, Button, cn, inputClass } from "@/components/ui";

export interface FlowGroup {
  clusterId: string;
  label: string;
  answers: number;
  brandMentioned: number;
  lostTo: Array<{ name: string; count: number }>;
  prompts: string[];
  promptStats: Array<{ text: string; answers: number; brand: number; lost: number }>;
  copy: { title: string; body: string } | null;
  targets: Array<{ url: string; label: string; kind: "category" | "product" | "home" }>;
}

type StepState = "done" | "review" | "todo";
const STATE_LABEL: Record<StepState, string> = { done: "Tamamlandı", review: "İncelemeniz gerekiyor", todo: "Bekliyor" };

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
/** Bilgi sorusu: marka/ürün önerisi beklenmez; reklam bağlamı olarak önerilmez (varsayılan seçili değil). */
const informational = (t: string) => /(nedir|ne işe yarar|nasıl kullanılır|nasıl yapılır|neden olur|zararlı mı|faydaları)/i.test(t);

/**
 * Reklam planı akışı: ürün grubu → plana dahil sorular → taslak → hedef sayfa → önizleme → kopyala/indir.
 * Otomatik doldurulan alan "inceleme" sayılmaz; adım durumları kullanıcının gerçek seçimine bağlıdır.
 * Yalnız taslak üretir; yayın/onay/hesap bağlama yoktur. Gerekçe organik AI yanıtlarıdır, reklam performansı değildir.
 */
export function AdsPlanFlow({ groups, brandName, domain, days, initialGroup, catalogEmpty }: { groups: FlowGroup[]; brandName: string; domain: string; days: number; initialGroup?: string; catalogEmpty: boolean }) {
  const initial = groups.find((g) => g.clusterId === initialGroup) ?? null;
  const [key, setKey] = useState<string>(initial?.clusterId ?? "");
  const group = groups.find((g) => g.clusterId === key) ?? null;
  const defaults = (g: FlowGroup | null) => new Set((g?.promptStats ?? []).filter((p) => !informational(p.text)).map((p) => p.text));
  const [chosen, setChosen] = useState<Set<string>>(() => defaults(initial));
  const [promptsReviewed, setPromptsReviewed] = useState(false);
  const [title, setTitle] = useState(initial?.copy?.title ?? "");
  const [body, setBody] = useState(initial?.copy?.body ?? "");
  const [copyReviewed, setCopyReviewed] = useState(false);
  const [target, setTarget] = useState("");
  const [custom, setCustom] = useState("");
  const [copied, setCopied] = useState(false);
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

  const choose = (k: string) => {
    const g = groups.find((x) => x.clusterId === k) ?? null;
    setKey(k);
    setChosen(defaults(g));
    setPromptsReviewed(false);
    setTitle(g?.copy?.title ?? "");
    setBody(g?.copy?.body ?? "");
    setCopyReviewed(false);
    setTarget("");
    setCustom("");
    setCopied(false);
  };
  const stats = (group?.promptStats ?? []).filter((p) => chosen.has(p.text));
  const sel = stats.reduce((a, p) => ({ answers: a.answers + p.answers, brand: a.brand + p.brand, lost: a.lost + p.lost }), { answers: 0, brand: 0, lost: 0 });
  const hasStats = (group?.promptStats.length ?? 0) > 0;
  const steps: Array<[string, StepState]> = [
    ["Ürün grubu", group ? "done" : "todo"],
    ["Sorular", !group ? "todo" : !hasStats ? "done" : promptsReviewed && chosen.size > 0 ? "done" : "review"],
    ["Reklam taslağı", !group ? "todo" : copyReviewed && title.trim() && body.trim() ? "done" : "review"],
    ["Hedef sayfa", urlOk ? "done" : group ? "review" : "todo"],
    ["Önizleme ve çıktı", copied ? "done" : "todo"],
  ];
  const ready = Boolean(group && title.trim() && body.trim() && urlOk && copyReviewed && (!hasStats || (promptsReviewed && chosen.size > 0)));
  const text = `Başlık: ${title.trim()}\nMetin: ${body.trim()}\nHedef sayfa: ${url}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const download = () => {
    const rows = [["Reklam grubu", "Başlık", "Metin", "Hedef sayfa", "Dayandığı sorular"], [group?.label ?? "", title.trim(), body.trim(), url, [...chosen].join(" | ")]];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`], { type: "text/csv;charset=utf-8" }));
    a.download = `reklam-taslagi-${(group?.label ?? "grup").toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, "-")}.csv`;
    a.click();
    setCopied(true);
  };

  if (!groups.length) {
    return <p className="text-sm text-text-secondary">Reklam planı için önce takip edeceğiniz soruları seçip bir ölçüm yapın; plan ölçülen sorulardan hazırlanır.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Adımlar">
        {steps.map(([label, st]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", st === "done" ? "bg-success-soft text-success" : st === "review" ? "bg-warning-soft text-warning" : "bg-surface-subtle text-text-secondary")}>{STATE_LABEL[st]}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold">1. Ürün grubu</span>
            <select className={cn(inputClass, "min-h-12")} value={key} onChange={(e) => choose(e.target.value)}>
              <option value="">— Ürün grubu seçin —</option>
              {groups.map((g) => <option key={g.clusterId} value={g.clusterId}>{g.label}{g.answers ? ` · ${g.answers} yanıt` : ""}</option>)}
            </select>
          </label>

          {group ? (
            <fieldset className="flex flex-col gap-1.5 text-sm">
              <legend className="font-semibold">2. Plana dahil edilecek sorular</legend>
              {hasStats ? (
                <>
                  {group.promptStats.map((p) => {
                    const info = informational(p.text);
                    return (
                      <label key={p.text} className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2">
                        <input type="checkbox" className="mt-1 h-4 w-4 flex-none accent-[var(--color-primary)]" checked={chosen.has(p.text)} onChange={() => { setChosen((c) => { const n = new Set(c); if (n.has(p.text)) n.delete(p.text); else n.add(p.text); return n; }); setPromptsReviewed(true); setCopied(false); }} />
                        <span className="min-w-0 flex-1">
                          <span className="[overflow-wrap:anywhere]">{p.text}</span>
                          <span className="block text-xs text-text-secondary">{p.answers} yanıt · markanız {p.brand}&apos;inde anıldı{p.lost ? ` · rakipler ${p.lost} yanıtta öne çıktı` : ""}{info ? " · bilgi sorusu; reklam için önerilmez" : ""}</span>
                        </span>
                      </label>
                    );
                  })}
                  {!promptsReviewed ? <button type="button" className="min-h-9 self-start text-sm font-medium text-primary hover:underline" onClick={() => setPromptsReviewed(true)}>Seçimi onayla</button> : null}
                  <p className="text-xs text-text-secondary">
                    {chosen.size ? `Seçili ${chosen.size} soruya verilen ${sel.answers} AI yanıtının ${sel.brand}'inde markanız anıldı${sel.lost ? `, ${sel.lost}'inde rakipler öne çıktı` : ""} (son ${days} gün).` : "En az bir soru seçin."} Bu organik görünürlük verisidir; reklam performansı, arama hacmi veya kesin hedefleme değildir.
                  </p>
                </>
              ) : (
                <p className="text-text-secondary">Bu grup için henüz ölçüm yok; taslak yalnız ürün grubundan hazırlandı.</p>
              )}
            </fieldset>
          ) : null}

          {group ? (
            <div className="flex flex-col gap-1.5 text-sm">
              <label htmlFor="ad-title" className="font-semibold">3. Başlık</label>
              <input id="ad-title" className={inputClass} value={title} onChange={(e) => { setTitle(e.target.value); setCopyReviewed(true); setCopied(false); }} maxLength={120} />
              <span className="text-right text-xs text-text-secondary">{[...title.trim()].length} karakter</span>
              <label htmlFor="ad-body" className="font-semibold">Metin</label>
              <textarea id="ad-body" rows={3} className={cn(inputClass, "py-2")} value={body} onChange={(e) => { setBody(e.target.value); setCopyReviewed(true); setCopied(false); }} maxLength={300} />
              <span className="text-right text-xs text-text-secondary">{[...body.trim()].length} karakter</span>
              {catalogEmpty ? <p className="rounded-md bg-warning-soft px-3 py-2 text-xs">Ürün ayrıntıları doğrulanmamış genel taslak: ürün özelliği, fiyat veya stok iddiası içermez. Ürünlerinizi ekledikten sonra metni güncelleyin.</p> : null}
              <span className="text-xs text-text-secondary">Metin hazır öneridir; kullanmadan önce okuyun. “En iyi”, “en ucuz” gibi iddiaları yalnız sitenizde kanıtlıyorsanız ekleyin. Karakter sınırlarını reklam platformunda kontrol edin.</span>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={copyReviewed} onChange={(e) => { setCopyReviewed(e.target.checked); setCopied(false); }} />
                Metni okudum, kullanılabilir
              </label>
            </div>
          ) : null}

          {group ? (
            <div className="flex flex-col gap-1.5 text-sm">
              <label htmlFor="ad-target" className="font-semibold">4. Hedef sayfa</label>
              <select id="ad-target" className={cn(inputClass, "min-h-12")} value={target} onChange={(e) => { setTarget(e.target.value); setCopied(false); }} aria-invalid={!urlOk && target !== ""} aria-describedby="ad-target-help">
                <option value="">— İlgili ürün veya kategori sayfasını seçin —</option>
                {group.targets.map((t) => <option key={t.url} value={t.url}>{t.label}{t.kind === "home" ? " (önerilmez)" : ""}</option>)}
                <option value="__custom">Başka bir sayfa adresi gireceğim</option>
              </select>
              {target === "__custom" ? <input aria-label="Hedef sayfa adresi" className={inputClass} placeholder={`https://${domain}/...`} value={custom} onChange={(e) => { setCustom(e.target.value); setCopied(false); }} /> : null}
              <span id="ad-target-help" className={cn("text-xs", url && !urlOk ? "text-danger" : "text-text-secondary")} role={url && !urlOk ? "alert" : undefined}>
                {url && !urlOk ? `Hedef sayfa https ile başlamalı ve ${domain} alan adınızda olmalı.` : !url ? "Kopyalamak için bir hedef sayfa seçin. Ana sayfa genelde ilgili ürün/kategori sayfası kadar uygun değildir." : "Kendi alan adınızdaki tek bir sayfa."}
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <p className="text-base font-semibold">5. Önizleme</p>
          <p className="text-xs text-text-secondary">Yaklaşık görünüm; nihai inceleme reklam platformundadır.</p>
          <div className="flex gap-3 rounded-[14px] border border-border p-3.5">
            <div aria-hidden className="grid h-16 w-16 flex-none place-items-center rounded-[10px] border border-dashed border-border-strong/60 bg-surface-subtle px-1 text-center text-[11px] text-text-secondary">Görsel yer tutucu</div>
            <div className="min-w-0">
              <p className="text-xs text-text-secondary">Sponsorlu · {domain}</p>
              <p className="font-semibold [overflow-wrap:anywhere]">{title.trim() || "Başlık"}</p>
              <p className="text-sm [overflow-wrap:anywhere]">{body.trim() || "Metin"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" onClick={copy} disabled={!ready}>Taslağı kopyala</Button>
            <Button type="button" onClick={download} disabled={!ready}>CSV indir</Button>
          </div>
          {copied ? <p role="status" className="text-sm text-success">Taslak hazır: panoya kopyalandı veya indirildi. Bu, yayın ya da onay anlamına gelmez.</p> : null}
          {!ready ? <p className="text-xs text-text-secondary">Kopyalamak için ürün grubu, soru seçimi, okunmuş metin ve geçerli bir hedef sayfa gerekli.</p> : null}
          <p className="text-xs text-text-secondary">Durum: <Badge>Taslak</Badge> · {brandName} için reklam yayını bu ekrandan yapılmaz; taslağı reklam platformunda kullanın.</p>
        </div>
      </div>
    </div>
  );
}
