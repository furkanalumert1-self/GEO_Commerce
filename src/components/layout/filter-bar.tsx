import Link from "next/link";
import { cn } from "@/components/ui";
import { ENGINE_SHORT, tzLabel } from "@/lib/format";

/**
 * Ortak filtre çubuğu: tarih (7/30/90/custom) ve motor; URL search params ile.
 * Tarih değişince sayfadaki tüm widget'lar aynı soru kümesiyle yeniden hesaplanır (server render).
 * Mobilde kompakt açılır alan (details); ≥640 px her zaman açık.
 */
export function FilterBar({
  basePath,
  sp,
  timeZone,
  engines,
  showEngine = true,
}: {
  basePath: string;
  sp: Record<string, string | undefined>;
  timeZone: string;
  engines?: string[];
  showEngine?: boolean;
}) {
  const range = sp.range ?? "30";
  const engine = sp.engine ?? "";
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = { range, engine, from: range === "custom" ? sp.from : null, to: range === "custom" ? sp.to : null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `${basePath}?${q.toString()}`;
  };
  const seg = (active: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-[6px] px-3 text-sm sm:min-h-8",
      active ? "bg-surface font-medium text-text shadow-[var(--shadow-card)] ring-1 ring-border" : "text-text-secondary hover:text-text",
    );
  const activeCount = (range !== "30" ? 1 : 0) + (engine ? 1 : 0);
  // Kapalı <details> içeriği yeni tarayıcılarda CSS ile gösterilemez; masaüstünde ayrı, her zaman açık sürüm.
  const controls = (s: string) => (
  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mt-0" role="group" aria-label="Filtreler">
    <div className="flex flex-wrap items-center gap-0.5 rounded-md bg-surface-subtle p-0.5" role="group" aria-label="Dönem">
      {["7", "30", "90"].map((r) => (
        <Link key={r} href={href({ range: r, from: null, to: null })} className={seg(range === r)} aria-current={range === r ? "true" : undefined}>
          {r} gün
        </Link>
      ))}
      <details className="relative">
        <summary className={cn(seg(range === "custom"), "no-marker cursor-pointer")}>{range === "custom" && sp.from && sp.to ? `${sp.from} – ${sp.to}` : "Özel aralık"}</summary>
        <form action={basePath} className="absolute left-0 z-20 mt-2 flex w-[17rem] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-surface p-3 shadow-[var(--shadow-overlay)]">
          <input type="hidden" name="range" value="custom" />
          {engine ? <input type="hidden" name="engine" value={engine} /> : null}
          <label className="text-xs font-medium text-text-secondary" htmlFor={`from${s}`}>Başlangıç</label>
          <input id={`from${s}`} name="from" type="date" required defaultValue={sp.from} className="min-h-11 rounded-md border border-border-strong/60 bg-surface px-2 text-sm sm:min-h-9" />
          <label className="text-xs font-medium text-text-secondary" htmlFor={`to${s}`}>Bitiş</label>
          <input id={`to${s}`} name="to" type="date" required defaultValue={sp.to} className="min-h-11 rounded-md border border-border-strong/60 bg-surface px-2 text-sm sm:min-h-9" />
          <button type="submit" className="mt-1 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover sm:min-h-9">Uygula</button>
        </form>
      </details>
    </div>
    {showEngine && engines && engines.length > 0 ? (
      <div className="flex flex-wrap items-center gap-0.5 rounded-md bg-surface-subtle p-0.5" role="group" aria-label="Platform">
        <Link href={href({ engine: null })} className={seg(!engine)} aria-current={!engine ? "true" : undefined}>Tüm platformlar</Link>
        {engines.map((e) => (
          <Link key={e} href={href({ engine: e })} className={seg(engine === e)} aria-current={engine === e ? "true" : undefined}>
            {ENGINE_SHORT[e] ?? e}
          </Link>
        ))}
      </div>
    ) : null}
    {activeCount > 0 ? (
      <Link href={basePath} className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-primary hover:underline underline-offset-2 sm:min-h-8">
        Sıfırla <span className="text-text-secondary">({activeCount} aktif filtre)</span>
      </Link>
    ) : null}
    <p className="text-xs text-text-secondary">Saat dilimi: {tzLabel(timeZone)}</p>
  </div>
  );
  return (
    <>
      <details className="filter-sheet mb-6 sm:hidden">
        <summary className="no-marker inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium shadow-[var(--shadow-card)]">
          Filtreler
          <span className="font-normal text-text-secondary">
            · {range === "custom" ? "Özel aralık" : `${range} gün`} · {engine ? (ENGINE_SHORT[engine] ?? engine) : "Tüm platformlar"}
            {activeCount ? ` (${activeCount} aktif)` : ""}
          </span>
        </summary>
        {controls("-m")}
      </details>
      <div className="mb-8 hidden sm:block">{controls("")}</div>
    </>
  );
}
