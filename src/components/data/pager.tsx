import Link from "next/link";

/** Sunucu tarafı sayfalama (varsayılan 25, maks 100). */
export function Pager({ basePath, sp, page, pageSize, total }: { basePath: string; sp: Record<string, string | undefined>; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v !== undefined) as Array<[string, string]>);
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
      <p className="tabular text-muted">
        {total === 0 ? "0 kayıt" : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} / ${total}`}
      </p>
      <div className="flex gap-2">
        {page > 1 ? <Link className="inline-flex min-h-11 items-center rounded-md border border-border px-3 sm:min-h-8" href={href(page - 1)}>Önceki</Link> : null}
        {page < pages ? <Link className="inline-flex min-h-11 items-center rounded-md border border-border px-3 sm:min-h-8" href={href(page + 1)}>Sonraki</Link> : null}
      </div>
    </nav>
  );
}

export function pageParams(sp: Record<string, string | undefined>, pageSize = 25) {
  const page = Math.max(1, Math.min(10_000, Number(sp.page ?? 1) || 1));
  return { page, pageSize, skip: (page - 1) * pageSize };
}
