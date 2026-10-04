"use client";

import { ChevronDown, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Badge, Button, cn, inputClass } from "@/components/ui";
import type { PickerData, PickerGroup } from "@/modules/prompts/picker";

type Source = "suggested" | "archived" | "own";
type Selected = { text: string; source: Source; id: string | null };
type Outcome = { saved: string[]; failed: Array<{ text: string; reason: string }> } | null;

const norm = (s: string) => s.trim().toLocaleLowerCase("tr-TR");

/** Açılır panel: dışarı tıklama ve Escape ile kapanır; odak tetikleyiciye döner. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return { open, setOpen, ref, trigger };
}

/**
 * Ürün grubu → soru seçimi. Seçim kayıt veya ölçüm başlatmaz; tek "takibe ekle" düğmesi mevcut API'leri
 * (POST /prompts, PATCH /prompts/:id) soru başına çağırır. Mükerrer/kota kuralları sunucudadır;
 * kısmi başarıda kaydedilenler gösterilir, başarısızlar seçimde kalır.
 */
export function QuestionPicker({ data, api, nextHint }: { data: PickerData; api: string; nextHint?: string }) {
  const router = useRouter();
  const uid = useId();
  const [groups, setGroups] = useState<PickerGroup[]>(data.groups);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [gq, setGq] = useState("");
  const [qq, setQq] = useState("");
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [own, setOwn] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [used, setUsed] = useState(data.used);
  const { open: gOpen, setOpen: setGOpen, ref: gRef, trigger: gTrigger } = usePopover();
  const { open: qOpen, setOpen: setQOpen, ref: qRef, trigger: qTrigger } = usePopover();
  const group = groups.find((g) => g.key === groupKey) ?? null;
  const left = Math.max(0, data.limit - used);
  const newCount = selected.length; // her seçim (yeni veya arşivden geri alma) bir aktif soru kotası kullanır
  const over = Math.max(0, newCount - left);

  const pickGroup = (key: string) => {
    if (key !== groupKey) { setSelected([]); setOutcome(null); setQq(""); }
    setGroupKey(key);
    setGOpen(false);
    gTrigger.current?.focus();
  };
  const toggle = (q: Selected) => setSelected((s) => (s.some((x) => x.text === q.text) ? s.filter((x) => x.text !== q.text) : [...s, q]));
  const isSel = (text: string) => selected.some((x) => x.text === text);
  const filteredGroups = groups.filter((g) => norm(g.label).includes(norm(gq)));
  const match = (t: string) => norm(t).includes(norm(qq));
  const ownSelected = selected.filter((s) => s.source === "own");

  const addOwn = () => {
    const text = (own ?? "").trim();
    if (text.length < 5 || !group) return;
    const exists = [...group.tracked, ...group.archived].some((q) => norm(q.text) === norm(text)) || isSel(text);
    if (!exists) setSelected((s) => [...s, { text, source: "own", id: null }]);
    setOwn(null);
  };

  const createGroup = () => {
    const label = (newGroup ?? "").trim();
    if (label.length < 2) return;
    const existing = groups.find((g) => norm(g.label) === norm(label));
    if (existing) { pickGroup(existing.key); setNewGroup(null); return; }
    const g: PickerGroup = { key: `new:${label}`, clusterId: null, label, category: null, tracked: [], archived: [], suggested: [] };
    setGroups((gs) => [...gs, g]);
    pickGroup(g.key);
    setNewGroup(null);
  };

  const call = async (url: string, method: string, body: object) => {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, code: json?.error?.code as string | undefined, message: (json?.error?.message as string | undefined) ?? "Kaydedilemedi" };
  };

  const save = async () => {
    if (!group || selected.length === 0) return;
    setSaving(true);
    setOutcome(null);
    const saved: string[] = [];
    const failed: Array<{ text: string; reason: string }> = [];
    let quotaHit = false;
    // Grubu henüz olmayan seçimler grup adıyla gönderilir; sunucu aynı adlı grubu oluşturur/yeniden kullanır.
    const clusterId = group.clusterId;
    for (const q of selected) {
      if (quotaHit) { failed.push({ text: q.text, reason: "Soru kotası dolu" }); continue; }
      let r: { ok: boolean; code?: string; message: string };
      if (q.source === "archived" && q.id) {
        // Mevcut iş kuralı: önce arşivden çıkar, sonra etkinleştir (kota kontrolü sunucuda).
        r = await call(`${api}/prompts/${q.id}`, "PATCH", { archived: false });
        if (r.ok) r = await call(`${api}/prompts/${q.id}`, "PATCH", { active: true });
      } else {
        r = await call(`${api}/prompts`, "POST", { text: q.text, locale: data.locale, ...(clusterId ? { clusterId } : { clusterLabel: group.label, ...(group.category ? { category: group.category } : {}) }) });
      }
      if (r.ok) saved.push(q.text);
      else {
        if (r.code === "quota_exceeded") quotaHit = true;
        failed.push({ text: q.text, reason: r.code === "quota_exceeded" ? "Soru kotası dolu" : r.code === "conflict" ? "Bu soru veya çok benzeri zaten takipte" : r.message });
      }
    }
    setUsed((u) => u + saved.length);
    setGroups((gs) => gs.map((g) => g.key !== group.key ? g : {
      ...g,
      tracked: [...g.tracked, ...saved.map((text) => ({ id: selected.find((s) => s.text === text)?.id ?? null, text }))],
      archived: g.archived.filter((a) => !saved.includes(a.text)),
      suggested: g.suggested.filter((a) => !saved.includes(a.text)),
    }));
    setSelected((s) => s.filter((x) => !saved.includes(x.text)));
    setOutcome({ saved, failed });
    setSaving(false);
    if (saved.length) router.refresh();
  };

  const section = (title: string, items: Array<{ text: string; id: string | null }>, source: Source | "tracked") => {
    const visible = items.filter((q) => match(q.text));
    if (!visible.length) return null;
    return (
      <div role="group" aria-label={title}>
        <p className="px-2.5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">{title}</p>
        {visible.map((q) =>
          source === "tracked" ? (
            <div key={q.text} className="flex items-start gap-2.5 rounded-md px-2.5 py-2 text-text-secondary">
              <input type="checkbox" checked disabled readOnly className="mt-1 h-4 w-4 flex-none accent-[var(--color-primary)]" aria-label={`${q.text} (takip ediliyor)`} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{q.text}</span>
              <Badge tone="success">Takip ediliyor</Badge>
            </div>
          ) : (
            <label key={q.text} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-surface-subtle">
              <input type="checkbox" checked={isSel(q.text)} onChange={() => toggle({ text: q.text, source, id: q.id })} className="mt-1 h-4 w-4 flex-none accent-[var(--color-primary)]" />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{q.text}</span>
              {source === "archived" ? <Badge>Arşivde</Badge> : null}
            </label>
          ),
        )}
      </div>
    );
  };

  const questionList = group;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex flex-col gap-5">
        {/* 1. Ürün grubu */}
        <div className="flex flex-col gap-1.5">
          <span id={`${uid}-g`} className="text-sm font-semibold">1. Ürün grubu</span>
          <div className="relative" ref={gRef}>
            <button ref={gTrigger} type="button" aria-haspopup="listbox" aria-expanded={gOpen} aria-labelledby={`${uid}-g ${uid}-gv`} onClick={() => setGOpen((o) => !o)} className="flex min-h-12 w-full items-center justify-between gap-2 rounded-md border border-border-strong/60 bg-surface px-3.5 text-left text-sm hover:border-border-strong">
              <span id={`${uid}-gv`} className={cn("min-w-0 truncate", !group && "text-text-secondary")}>{group?.label ?? "Ürün grubu seçin"}</span>
              <ChevronDown size={16} aria-hidden />
            </button>
            {gOpen ? (
              <div className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[420px] overflow-auto rounded-[12px] border border-border bg-surface p-2 shadow-[var(--shadow-overlay)]">
                <input autoFocus value={gq} onChange={(e) => setGq(e.target.value)} placeholder="Ürün grubu ara…" aria-label="Ürün grubu ara" className={cn(inputClass, "mb-1.5")} />
                <div role="listbox" aria-label="Ürün grupları">
                  {filteredGroups.map((g) => (
                    <button key={g.key} type="button" role="option" aria-selected={g.key === groupKey} onClick={() => pickGroup(g.key)} className={cn("flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm hover:bg-surface-subtle", g.key === groupKey && "bg-primary-soft")}>
                      <span className="min-w-0 [overflow-wrap:anywhere]">{g.label}</span>
                      <span className="flex-none text-xs text-text-secondary">{g.tracked.length ? `${g.tracked.length} soru takipte` : "henüz soru yok"}</span>
                    </button>
                  ))}
                  {filteredGroups.length === 0 ? <p className="px-2.5 py-2 text-sm text-text-secondary">Sonuç yok. Yeni ürün grubu ekleyebilirsiniz.</p> : null}
                </div>
                <div className="mt-1.5 border-t border-border pt-1.5">
                  <button type="button" className="min-h-11 px-2.5 text-sm font-medium text-primary hover:underline" onClick={() => { setGOpen(false); setNewGroup(gq); }}>+ Yeni ürün grubu ekle</button>
                </div>
              </div>
            ) : null}
          </div>
          {newGroup !== null ? (
            <div className="mt-1 flex flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <span>Yeni ürün grubu adı</span>
                <input autoFocus value={newGroup} onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createGroup(); } }} placeholder="ör. Yatak Koruyucu" className={inputClass} />
              </label>
              <Button type="button" onClick={createGroup} disabled={(newGroup ?? "").trim().length < 2}>Grubu seç</Button>
              <Button type="button" variant="ghost" onClick={() => setNewGroup(null)}>Vazgeç</Button>
            </div>
          ) : null}
        </div>

        {/* 2. Sorular */}
        <div className="flex flex-col gap-1.5">
          <span id={`${uid}-q`} className="text-sm font-semibold">2. Sorular</span>
          <div className="relative" ref={qRef}>
            <button ref={qTrigger} type="button" aria-haspopup="listbox" aria-expanded={qOpen} aria-disabled={!group} aria-labelledby={`${uid}-q ${uid}-qv`} onClick={() => group && setQOpen((o) => !o)} className={cn("flex min-h-12 w-full items-center justify-between gap-2 rounded-md border border-border-strong/60 px-3.5 text-left text-sm", group ? "bg-surface hover:border-border-strong" : "cursor-not-allowed bg-surface-subtle text-text-secondary")}>
              <span id={`${uid}-qv`}>{!group ? "Önce ürün grubu seçin" : selected.length ? `${selected.length} soru seçildi` : "Soru seçin (birden fazla seçebilirsiniz)"}</span>
              <ChevronDown size={16} aria-hidden />
            </button>
            {qOpen && questionList ? (
              <div className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[440px] overflow-auto rounded-[12px] border border-border bg-surface p-2 text-sm shadow-[var(--shadow-overlay)]">
                <input autoFocus value={qq} onChange={(e) => setQq(e.target.value)} placeholder="Soru ara…" aria-label="Soru ara" className={inputClass} />
                <div role="listbox" aria-multiselectable="true" aria-label={`${questionList.label} soruları`}>
                  {section("Önerilen sorular", questionList.suggested, "suggested")}
                  {section("Kendi yazdıklarınız", ownSelected, "own")}
                  {section("Takip ettiğiniz", questionList.tracked, "tracked")}
                  {section("Arşivdeki sorular", questionList.archived, "archived")}
                  {!questionList.suggested.length && !questionList.tracked.length && !questionList.archived.length && !ownSelected.length ? (
                    <p className="px-2.5 py-3 text-text-secondary">Bu grup için öneri yok. “Kendi sorumu yaz” ile ekleyebilirsiniz.</p>
                  ) : [...questionList.suggested, ...questionList.tracked, ...questionList.archived, ...ownSelected].every((q) => !match(q.text)) ? (
                    <p className="px-2.5 py-3 text-text-secondary">Aramanızla eşleşen soru yok. Seçimleriniz korunuyor.</p>
                  ) : null}
                </div>
                <div className="mt-1.5 border-t border-border pt-1.5">
                  <button type="button" className="min-h-11 px-2.5 font-medium text-primary hover:underline" onClick={() => { setQOpen(false); setOwn(""); }}>+ Kendi sorumu yaz</button>
                </div>
              </div>
            ) : null}
          </div>
          {own !== null && group ? (
            <div className="mt-1 flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span>Sorunuz</span>
                <input autoFocus value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOwn(); } }} maxLength={500} placeholder="ör. Bebek yatağı kaç santim olmalı?" className={inputClass} />
              </label>
              {own.trim().length >= 5 ? <p className="text-xs text-text-secondary">Önizleme: <span className="text-text">{own.trim()}</span></p> : null}
              <div className="flex gap-2"><Button type="button" onClick={addOwn} disabled={own.trim().length < 5}>Seçime ekle</Button><Button type="button" variant="ghost" onClick={() => setOwn(null)}>Vazgeç</Button></div>
            </div>
          ) : null}
          {selected.length ? (
            <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Seçilen sorular">
              {selected.map((s) => (
                <li key={s.text} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/25 bg-primary-soft py-0.5 pl-3 pr-1 text-[13px] text-primary-hover">
                  <span className="[overflow-wrap:anywhere]">{s.text}</span>
                  <button type="button" onClick={() => toggle(s)} aria-label={`Kaldır: ${s.text}`} className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full hover:bg-surface"><X size={14} aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2.5 text-sm" role="status">
          <span><b className="tabular">{used}</b>/{data.limit} soru takip ediliyor</span>
          <span className="h-2 min-w-[100px] flex-1 overflow-hidden rounded-full bg-border" aria-hidden><span className="block h-full bg-primary" style={{ width: `${Math.min(100, (used / Math.max(1, data.limit)) * 100)}%` }} /></span>
          <span className="text-text-secondary">{left ? `${left} yeni soru ekleyebilirsiniz` : "Yeni soru için mevcut takibi düzenleyin"}</span>
        </div>
      </div>

      {/* Özet */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5">
        <h3 className="text-base font-semibold">Özet</h3>
        <p className="mt-1 text-sm text-text-secondary">{selected.length ? `${group?.label} grubunda ${selected.length} soru seçildi:` : group ? "Listeden soru işaretleyin." : "Henüz soru seçmediniz."}</p>
        {selected.length ? (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {selected.map((s) => <li key={s.text} className="[overflow-wrap:anywhere]">{s.text}{s.source === "archived" ? <> <Badge>Arşivden geri alınacak</Badge></> : s.source === "own" ? <> <Badge tone="primary">Kendi sorunuz</Badge></> : null}</li>)}
          </ol>
        ) : null}
        {over > 0 ? <p className="mt-2 text-sm text-warning">Kotanız {left} yeni soruya izin veriyor; {over} soru kaydedilemez. Mevcut takipten soru arşivleyerek yer açabilirsiniz.</p> : null}
        <Button type="button" variant="primary" className="mt-4 w-full" onClick={save} disabled={saving || selected.length === 0 || left === 0}>{saving ? "Kaydediliyor…" : "Seçilen soruları takibe ekle"}</Button>
        {outcome ? (
          <div role="status" className={cn("mt-3 rounded-md px-3 py-2.5 text-sm", outcome.failed.length ? "bg-warning-soft" : "bg-success-soft")}>
            <p className="font-semibold">{outcome.saved.length} soru takibe eklendi.</p>
            {outcome.failed.length ? (
              <>
                <p className="mt-1">{outcome.failed.length} soru eklenemedi; seçimde bırakıldı:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{outcome.failed.map((f) => <li key={f.text} className="[overflow-wrap:anywhere]">{f.text} — {f.reason}</li>)}</ul>
              </>
            ) : null}
            <p className="mt-1 text-xs">Ölçüm başlatılmadı.{nextHint ? ` ${nextHint}` : ""}</p>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-text-secondary">Seçim yapmak ölçüm başlatmaz. Ölçümden önce sorular, platformlar ve kota kullanımı ayrıca gösterilir.</p>
      </div>
    </div>
  );
}
