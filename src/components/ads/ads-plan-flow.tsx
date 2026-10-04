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
  copy: { title: string; body: string } | null;
  targets: Array<{ url: string; label: string }>;
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

/**
 * Reklam planı akışı: ürün grubu → dayandığı sorular → taslak → hedef sayfa → önizleme → kopyala/indir.
 * Yalnız taslak üretir; yayın/hesap bağlama yoktur. Öneri gerekçesi organik AI yanıtlarıdır, reklam performansı değildir.
 */
export function AdsPlanFlow({ groups, brandName, domain, days, initialGroup }: { groups: FlowGroup[]; brandName: string; domain: string; days: number; initialGroup?: string }) {
  const [key, setKey] = useState<string>(groups.some((g) => g.clusterId === initialGroup) ? initialGroup! : groups[0]?.clusterId ?? "");
  const group = groups.find((g) => g.clusterId === key) ?? null;
  const [title, setTitle] = useState(group?.copy?.title ?? "");
  const [body, setBody] = useState(group?.copy?.body ?? "");
  const [target, setTarget] = useState(group?.targets[0]?.url ?? "__custom");
  const [custom, setCustom] = useState("");
  const [copied, setCopied] = useState(false);
  const url = target === "__custom" ? custom.trim() : target;
  const urlOk = useMemo(() => {
    try {
      const u = new URL(url);
      const d = domain.replace(/^www\./, "");
      return u.protocol === "https:" && (u.hostname === d || u.hostname.endsWith(`.${d}`) || u.hostname === `www.${d}`);
    } catch {
      return false;
    }
  }, [url, domain]);

  const choose = (k: string) => {
    const g = groups.find((x) => x.clusterId === k);
    setKey(k);
    setTitle(g?.copy?.title ?? "");
    setBody(g?.copy?.body ?? "");
    setTarget(g?.targets[0]?.url ?? "__custom");
    setCopied(false);
  };
  const lost = group ? group.lostTo.reduce((a, b) => a + b.count, 0) : 0;
  const ready = Boolean(title.trim() && body.trim() && urlOk);
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
    const rows = [["Reklam grubu", "Başlık", "Metin", "Hedef sayfa"], [group?.label ?? "", title.trim(), body.trim(), url]];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`], { type: "text/csv;charset=utf-8" }));
    a.download = `reklam-taslagi-${(group?.label ?? "grup").toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, "-")}.csv`;
    a.click();
  };

  if (!groups.length) {
    return <p className="text-sm text-text-secondary">Reklam planı için önce takip edeceğiniz soruları seçip bir ölçüm yapın; plan ölçülen sorulardan hazırlanır.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Adımlar">
        {["Ürün grubu", "Sorular", "Reklam taslağı", "Hedef sayfa", "Önizleme ve çıktı"].map((s, i) => {
          const done = i === 0 ? Boolean(group) : i === 1 ? Boolean(group) : i === 2 ? Boolean(title.trim() && body.trim()) : i === 3 ? urlOk : ready;
          return (
            <li key={s} className={cn("flex items-center gap-1.5", done ? "text-text" : "text-text-secondary")}>
              <span aria-hidden className={cn("grid h-6 w-6 place-items-center rounded-[8px] text-xs font-semibold", done ? "bg-success-soft text-success" : "bg-surface-subtle")}>{done ? "✓" : i + 1}</span>
              {s}
              <span className="sr-only">{done ? " (tamam)" : " (bekliyor)"}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold">1. Ürün grubu</span>
            <select className={cn(inputClass, "min-h-12")} value={key} onChange={(e) => choose(e.target.value)}>
              {groups.map((g) => <option key={g.clusterId} value={g.clusterId}>{g.label}{g.answers ? ` · ${g.answers} yanıt` : ""}</option>)}
            </select>
          </label>

          {group ? (
            <div className="rounded-r-[10px] border-l-[3px] border-primary bg-surface-subtle px-3 py-2.5 text-sm">
              <p className="font-semibold">2. Neden bu öneri?</p>
              {group.answers ? (
                <p className="mt-0.5">
                  Son {days} günde bu gruptaki {group.prompts.length} soruya verilen {group.answers} AI yanıtının {group.brandMentioned}&apos;inde markanız anıldı
                  {lost ? `; rakipler ${lost} kez öne çıktı (${group.lostTo.slice(0, 3).map((c) => `${c.name} ${c.count}`).join(", ")})` : ""}.
                </p>
              ) : (
                <p className="mt-0.5">Bu grup için henüz ölçüm yok; taslak ürün grubunuzdan hazırlandı.</p>
              )}
              {group.prompts.length ? (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-text-secondary">{group.prompts.map((p) => <li key={p} className="[overflow-wrap:anywhere]">{p}</li>)}</ul>
              ) : null}
              <p className="mt-1.5 text-xs text-text-secondary">Bu organik görünürlük verisidir; reklam performansı, arama hacmi veya kesin hedefleme değildir.</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 text-sm">
            <label htmlFor="ad-title" className="font-semibold">3. Başlık</label>
            <input id="ad-title" className={inputClass} value={title} onChange={(e) => { setTitle(e.target.value); setCopied(false); }} maxLength={120} />
            <span className="text-right text-xs text-text-secondary">{[...title.trim()].length} karakter</span>
            <label htmlFor="ad-body" className="font-semibold">Metin</label>
            <textarea id="ad-body" rows={3} className={cn(inputClass, "py-2")} value={body} onChange={(e) => { setBody(e.target.value); setCopied(false); }} maxLength={300} />
            <span className="text-right text-xs text-text-secondary">{[...body.trim()].length} karakter</span>
            <span className="text-xs text-text-secondary">Metin ürün grubunuzdan hazırlandı. “En iyi”, “en ucuz” gibi iddiaları yalnız sitenizde kanıtlıyorsanız ekleyin. Karakter sınırlarını reklam platformunda kontrol edin.</span>
          </div>

          <div className="flex flex-col gap-1.5 text-sm">
            <label htmlFor="ad-target" className="font-semibold">4. Hedef sayfa</label>
            <select id="ad-target" className={cn(inputClass, "min-h-12")} value={target} onChange={(e) => { setTarget(e.target.value); setCopied(false); }}>
              {(group?.targets ?? []).map((t) => <option key={t.url} value={t.url}>{t.label}</option>)}
              <option value="__custom">Başka bir sayfa adresi gireceğim</option>
            </select>
            {target === "__custom" ? <input aria-label="Hedef sayfa adresi" className={inputClass} placeholder={`https://${domain}/...`} value={custom} onChange={(e) => { setCustom(e.target.value); setCopied(false); }} /> : null}
            {url && !urlOk ? <span className="text-xs text-danger" role="alert">Hedef sayfa https ile başlamalı ve {domain} alan adınızda olmalı.</span> : <span className="text-xs text-text-secondary">Kendi alan adınızdaki tek bir sayfa.</span>}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
          <p className="text-base font-semibold">5. Önizleme</p>
          <p className="text-xs text-text-secondary">Yaklaşık görünüm; nihai inceleme reklam platformundadır.</p>
          <div className="flex gap-3 rounded-[14px] border border-border p-3.5">
            <div aria-hidden className="grid h-16 w-16 flex-none place-items-center rounded-[10px] bg-surface-subtle text-center text-[11px] text-text-secondary">Kare görsel</div>
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
          {copied ? <p role="status" className="text-sm text-success">Taslak panoya kopyalandı.</p> : null}
          {!ready ? <p className="text-xs text-text-secondary">Kopyalamak için başlık, metin ve geçerli bir hedef sayfa gerekli.</p> : null}
          <p className="text-xs text-text-secondary">Durum: <Badge>Taslak</Badge> · {brandName} için reklam yayını bu ekrandan yapılmaz; taslağı reklam platformunda kullanın.</p>
        </div>
      </div>
    </div>
  );
}
