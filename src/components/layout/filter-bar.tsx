import Link from "next/link";
import { cn } from "@/components/ui";
import { ENGINE_SHORT, tzLabel } from "@/lib/format";

/**
 * Ortak filtre çubuğu: tarih (7/30/90/custom) ve motor; URL search params ile.
 * Tarih değişince sayfadaki tüm widget'lar aynı cohort ile yeniden hesaplanır (server render).
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
    for (const [k, v] of Object.entries({ range, engine, ...patch })) if (v) q.set(k, v);
    return `${basePath}?${q.toString()}`;
  };
  const pill = (active: boolean) =>
    cn("inline-flex min-h-11 items-center rounded-md border px-3 text-sm sm:min-h-8", active ? "border-primary bg-primary-soft font-medium text-primary" : "border-border bg-surface hover:bg-bg");
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Filtreler">
      <div className="flex flex-wrap items-center gap-1" aria-label="Tarih aralığı">
        {["7", "30", "90"].map((r) => (
          <Link key={r} href={href({ range: r })} className={pill(range === r)} aria-current={range === r ? "true" : undefined}>
            {r} gün
          </Link>
        ))}
        <form action={basePath} className="flex flex-wrap items-center gap-1">
          <input type="hidden" name="range" value="custom" />
          {engine ? <input type="hidden" name="engine" value={engine} /> : null}
          <label className="sr-only" htmlFor="from">Başlangıç</label>
          <input id="from" name="from" type="date" defaultValue={sp.from} className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm sm:min-h-8" />
          <label className="sr-only" htmlFor="to">Bitiş</label>
          <input id="to" name="to" type="date" defaultValue={sp.to} className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm sm:min-h-8" />
          <button type="submit" className={pill(range === "custom")}>Özel</button>
        </form>
      </div>
      {showEngine && engines && engines.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1" aria-label="Motor">
          <Link href={href({ engine: null })} className={pill(!engine)}>Tüm motorlar</Link>
          {engines.map((e) => (
            <Link key={e} href={href({ engine: e })} className={pill(engine === e)}>
              {ENGINE_SHORT[e] ?? e}
            </Link>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted">Saat dilimi: {tzLabel(timeZone)}</p>
    </div>
  );
}
