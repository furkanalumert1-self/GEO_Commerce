"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, cn, inputClass } from "@/components/ui";
import type { CandidateStatus, ProductCandidate } from "@/modules/catalog/candidates";

const STATUS: Record<CandidateStatus, { label: string; tone: "success" | "primary" | "warning" | "neutral" }> = {
  new: { label: "Yeni", tone: "success" },
  update: { label: "Güncellenecek", tone: "primary" },
  imported: { label: "Aktarıldı", tone: "neutral" },
  incomplete: { label: "Bilgi eksik", tone: "warning" },
  review: { label: "İnceleme gerekli", tone: "neutral" },
};

const money = (minor: string | null, cur: string | null) => {
  if (!minor || !cur) return "Bilinmiyor";
  try {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: cur }).format(Number(minor) / 100);
  } catch {
    return `${Number(minor) / 100} ${cur}`;
  }
};

/**
 * Bulunan ürün adayları: seç → kataloğa aktar. Aktarım onaysız yapılmaz; sitenize hiçbir şey yazılmaz.
 * "Ürün bağlantısı ekle" aynı doğrulama/önizleme hattından geçer.
 */
export function ProductCandidates({ api, candidates, returnHref }: { api: string; candidates: ProductCandidate[]; returnHref?: string | null }) {
  const router = useRouter();
  const selectable = useMemo(() => candidates.filter((c) => c.status !== "imported"), [candidates]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectable.filter((c) => c.status === "new" || c.status === "update" || c.status === "incomplete").map((c) => c.url)));
  const [added, setAdded] = useState<ProductCandidate[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; skipped?: Array<{ url: string; reason: string }> } | null>(null);
  const rows = [...added, ...candidates];
  const toggle = (url: string) => setSelected((s) => { const n = new Set(s); if (n.has(url)) n.delete(url); else n.add(url); return n; });
  const allSelectable = [...added, ...selectable];
  const allOn = allSelectable.length > 0 && allSelectable.every((c) => selected.has(c.url));

  const preview = async () => {
    setLinkError(null);
    setChecking(true);
    const res = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview", url: linkUrl.trim() }) });
    const body = await res.json().catch(() => null);
    setChecking(false);
    if (!res.ok) return setLinkError(body?.error?.fieldErrors?.url?.[0] ?? body?.error?.message ?? "Bağlantı kontrol edilemedi");
    const c = body.data.candidate as (Omit<ProductCandidate, "status" | "note" | "missing" | "sampledAt"> & { pageUrl: string }) | null;
    if (!c) return setLinkError(body.data.reason ?? "Bu sayfada ürün bilgisi bulunamadı");
    if (rows.some((r) => r.url === c.url)) return setLinkError("Bu ürün listede zaten var");
    const missing = [...(c.priceMinor === null ? ["fiyat"] : []), ...(c.available === null ? ["stok"] : [])];
    const cand: ProductCandidate = { ...c, sampledAt: new Date().toISOString(), status: missing.length ? "incomplete" : "new", note: missing.length ? `Sayfada okunamadı: ${missing.join(", ")}` : "Sizin eklediğiniz bağlantı", missing };
    setAdded((a) => [cand, ...a]);
    setSelected((s) => new Set(s).add(cand.url));
    setLinkUrl("");
  };

  const importSelected = async () => {
    setPending(true);
    setResult(null);
    const urls = [...selected];
    const res = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "import", urls }) });
    const body = await res.json().catch(() => null);
    setPending(false);
    if (!res.ok) return setResult({ ok: false, text: body?.error?.message ?? "Aktarım yapılamadı" });
    const d = body.data as { imported: number; updated: number; skipped: Array<{ url: string; reason: string }> };
    setResult({ ok: d.skipped.length === 0, text: `${d.imported} ürün eklendi, ${d.updated} ürün güncellendi.${d.skipped.length ? ` ${d.skipped.length} bağlantı aktarılamadı.` : ""}`, skipped: d.skipped });
    setAdded([]);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 sm:px-6">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(allSelectable.map((c) => c.url)))} />
          Tümünü seç ({allSelectable.length})
        </label>
        <Button type="button" variant="primary" onClick={importSelected} disabled={pending || selected.size === 0}>{pending ? "Aktarılıyor…" : `Seçilen ${selected.size} ürünü kataloğa aktar`}</Button>
      </div>
      {result ? (
        <div role="status" className={cn("mx-5 rounded-md px-3 py-2.5 text-sm sm:mx-6", result.ok ? "bg-success-soft" : "bg-warning-soft")}>
          <p className="font-medium">{result.text}</p>
          {result.skipped?.length ? <ul className="mt-1 list-disc pl-5">{result.skipped.map((s) => <li key={s.url} className="[overflow-wrap:anywhere]">{s.url} — {s.reason}</li>)}</ul> : null}
          {result.ok && returnHref ? <p className="mt-1"><a className="font-medium text-primary underline" href={returnHref}>Yarım kalan işinize dönün</a></p> : null}
          <p className="mt-1 text-xs text-text-secondary">Ölçüm veya taslak kendiliğinden başlamaz.</p>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-5 pb-2 text-sm text-text-secondary sm:px-6">Henüz ürün adayı yok. Siteyi inceleyin, ürün bağlantısı ekleyin veya ürün dosyası yükleyin.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border" aria-label="Ürün adayları">
          {rows.map((c) => {
            const st = STATUS[c.status];
            const disabled = c.status === "imported";
            return (
              <li key={c.url} className="flex items-start gap-3 px-5 py-3 sm:px-6">
                <input type="checkbox" aria-label={`Seç: ${c.name}`} className="mt-1 h-4 w-4 flex-none accent-[var(--color-primary)]" checked={selected.has(c.url)} disabled={disabled} onChange={() => toggle(c.url)} />
                {c.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- harici mağaza görseli; optimize edilmez
                  <img src={c.image} alt="" className="h-12 w-12 flex-none rounded-md border border-border object-cover" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span aria-hidden className="h-12 w-12 flex-none rounded-md bg-surface-subtle" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere]">{c.name}</p>
                  <a className="text-xs text-primary hover:underline [overflow-wrap:anywhere]" href={c.url} target="_blank" rel="noopener noreferrer">{c.url.replace(/^https?:\/\//, "")}</a>
                  <p className="mt-1 text-sm text-text-secondary">
                    {c.category ? `${c.category} · ` : ""}{money(c.priceMinor, c.currency)} · {c.available === null ? "Stok bilinmiyor" : c.available ? "Stokta" : "Stokta yok"}
                    {c.source === "meta" ? " · sayfa etiketlerinden okundu" : ""}
                  </p>
                </div>
                <div className="flex flex-none flex-col items-end gap-1 text-right">
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {c.note ? <span className="max-w-[12rem] text-xs text-text-secondary">{c.note}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-1.5 px-5 pb-5 sm:px-6">
        <label htmlFor="product-link" className="text-sm font-medium">Ürün bağlantısı ekle</label>
        <div className="flex flex-wrap gap-2">
          <input id="product-link" className={cn(inputClass, "min-w-0 flex-1")} placeholder="https://magazaniz.com/urun-adi" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} aria-invalid={Boolean(linkError)} aria-describedby={linkError ? "product-link-error" : "product-link-hint"} />
          <Button type="button" onClick={preview} disabled={checking || linkUrl.trim().length < 8}>{checking ? "Kontrol ediliyor…" : "Kontrol et"}</Button>
        </div>
        {linkError ? <p id="product-link-error" role="alert" className="text-xs text-danger">{linkError}</p> : <p id="product-link-hint" className="text-xs text-text-secondary">Sayfadaki ürün bilgileri okunur ve listeye eklenir; aktarmak için seçip onaylayın.</p>}
      </div>
    </div>
  );
}
