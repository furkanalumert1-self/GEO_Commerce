import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, EmptyState, PageHeader, TableWrap, Td, Th, cn } from "@/components/ui";
import { Pager, pageParams } from "@/components/data/pager";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { unlockedOpportunityIds } from "@/modules/opportunities/access";
import { fmtDate, GAP_LABEL, OPP_STATUS_LABEL } from "@/lib/format";
import { IMPACT_LABEL, impactLevel } from "@/lib/view-models";

const seg = (active: boolean) =>
  cn("inline-flex min-h-11 items-center rounded-[6px] px-3 text-sm sm:min-h-8", active ? "bg-surface font-medium text-text shadow-[var(--shadow-card)] ring-1 ring-border" : "text-text-secondary hover:text-text");

export const metadata: Metadata = { title: "Fırsatlar" };

const STATUSES = ["new", "triaged", "in_progress", "measuring", "won", "dismissed"] as const;

export default async function OpportunitiesPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const status = STATUSES.find((s) => s === sp.status);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const sort = sp.sort === "due" ? "due" : sp.sort === "intent" ? "intent" : "score";
  const { page, pageSize, skip } = pageParams(sp);
  const where = { workspaceId, brandId, ...(status ? { status } : {}), ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}) };
  const [rows, total, unlocked, members] = await Promise.all([
    db.opportunity.findMany({ where, orderBy: sort === "due" ? [{ dueAt: { sort: "asc", nulls: "last" } }] : [{ score: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }], skip, take: pageSize, include: { cluster: { select: { label: true, type: true } } } }),
    db.opportunity.count({ where }),
    unlockedOpportunityIds(db, access),
    db.membership.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, email: true } } } }),
  ]);
  const owner = Object.fromEntries(members.map((m) => [m.user.id, m.user.name ?? m.user.email]));
  const base = `/w/${workspaceId}/b/${brandId}/opportunities`;
  const lockedCount = unlocked === "all" ? 0 : total - [...unlocked].length;
  const link = (patch: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, sort, q: q || undefined, ...patch })) if (v) qs.set(k, v);
    return `${base}?${qs}`;
  };
  return (
    <>
      <PageHeader title="Fırsatlar" description="Rakiplere kaybedilen sorular, öncelik sırasıyla. Fırsatı açın, kanıtı ve teşhisi inceleyin, AI ile iyileştir ile değişiklik hazırlayın." />
      {lockedCount > 0 ? (
        <div className="mb-4">
          <Alert tone="primary" title={`${lockedCount} fırsatın detayı paketinizde kilitli`}>
            {access.entitlements.planKey === "starter" ? "Starter ilk 10 fırsatın detayını gösterir. Tüm üretilen fırsatlar ve AI ile iyileştir Growth paketinde." : "Detaylar için paketinizi yükseltin."}{" "}
            <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Paketleri karşılaştır</Link>
          </Alert>
        </div>
      ) : null}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-0.5 rounded-md bg-surface-subtle p-0.5" role="group" aria-label="Durum filtresi">
          <Link href={link({ status: undefined })} aria-current={!status ? "true" : undefined} className={seg(!status)}>Tümü</Link>
          {STATUSES.map((s) => (
            <Link key={s} href={link({ status: s })} aria-current={status === s ? "true" : undefined} className={seg(status === s)}>{OPP_STATUS_LABEL[s]}</Link>
          ))}
        </div>
        <form action={base} role="search" className="flex items-center gap-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          {sort !== "score" ? <input type="hidden" name="sort" value={sort} /> : null}
          <label htmlFor="opp-q" className="sr-only">Fırsat ara</label>
          <input id="opp-q" name="q" type="search" defaultValue={q} placeholder="Fırsat ara" className="min-h-11 w-56 rounded-md border border-border-strong/60 bg-surface px-3 text-sm sm:min-h-9" />
          <button type="submit" className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-subtle sm:min-h-9">Ara</button>
        </form>
        {status || q ? <Link className="inline-flex min-h-11 items-center text-sm text-primary hover:underline sm:min-h-9" href={base}>Filtreleri sıfırla</Link> : null}
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={status || q ? "Sonuç yok" : "Henüz fırsat yok"} description={status || q ? "Seçili filtrelerde fırsat yok." : "Ölçümler tamamlandıkça rakiplere kaybedilen niyetler burada listelenir."} action={status || q ? <Link className="text-primary underline" href={base}>Filtreleri sıfırla</Link> : undefined} />
        ) : (
          <TableWrap label="Fırsatlar">
            <thead>
              <tr>
                <Th><Link href={link({ sort: "score" })} aria-sort={sort === "score" ? "descending" : "none"}>Fırsat</Link></Th>
                <Th>Tür</Th>
                <Th>Tahmini etki</Th>
                <Th numeric>Skor</Th>
                <Th>Durum</Th>
                <Th>Sorumlu</Th>
                <Th><Link href={link({ sort: "due" })} aria-sort={sort === "due" ? "ascending" : "none"}>Hedef tarih</Link></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const isLocked = unlocked !== "all" && !unlocked.has(o.id);
                if (isLocked) {
                  return (
                    <tr key={o.id}>
                      <Td colSpan={7} className="text-muted">🔒 Kilitli fırsat — detay için paket yükseltin</Td>
                    </tr>
                  );
                }
                return (
                  <tr key={o.id}>
                    <Td className="max-w-[28rem]">
                      <Link className="font-medium hover:underline underline-offset-2" href={`${base}/${o.id}`}>{o.title}</Link>
                      <p className="text-xs text-muted">{o.cluster.label} · {o.locale} · {o.channel === "paid" ? "Ücretli" : "Organik"}</p>
                    </Td>
                    <Td>{GAP_LABEL[o.gapType]}</Td>
                    <Td className="text-text-secondary">{IMPACT_LABEL[impactLevel(o)]}</Td>
                    <Td numeric>{o.score ?? "—"} {o.provisional ? <Badge tone="warning">Geçici</Badge> : null}</Td>
                    <Td><Badge tone={o.status === "won" ? "success" : o.status === "dismissed" ? "neutral" : "primary"}>{OPP_STATUS_LABEL[o.status]}</Badge></Td>
                    <Td>{o.ownerId ? owner[o.ownerId] : "—"}</Td>
                    <Td className="text-muted">{fmtDate(o.dueAt, access.brand.timezone)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        <Pager basePath={base} sp={sp} page={page} pageSize={pageSize} total={total} />
      </Card>
    </>
  );
}
