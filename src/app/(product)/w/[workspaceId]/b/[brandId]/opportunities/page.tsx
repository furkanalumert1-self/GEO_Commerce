import Link from "next/link";
import type { Metadata } from "next";
import { Alert, Badge, Card, EmptyState, PageHeader, TableWrap, Td, Th, cn } from "@/components/ui";
import { Pager, pageParams } from "@/components/data/pager";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { unlockedOpportunityIds } from "@/modules/opportunities/access";
import { fmtDate, GAP_LABEL, OPP_STATUS_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Fırsatlar" };

const STATUSES = ["new", "triaged", "in_progress", "measuring", "won", "dismissed"] as const;

export default async function OpportunitiesPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const status = STATUSES.find((s) => s === sp.status);
  const sort = sp.sort === "due" ? "due" : sp.sort === "intent" ? "intent" : "score";
  const { page, pageSize, skip } = pageParams(sp);
  const where = { workspaceId, brandId, ...(status ? { status } : {}) };
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
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, sort, ...patch })) if (v) q.set(k, v);
    return `${base}?${q}`;
  };
  return (
    <>
      <PageHeader title="Fırsatlar" description="Kanıt → teşhis → aksiyon → yeniden ölçüm. Skor = 0,30 niyet + 0,25 görünürlük farkı + 0,20 katalog uyumu + 0,15 kanıt + 0,10 uygulanabilirlik (deneysel ağırlıklar)." />
      {lockedCount > 0 ? (
        <div className="mb-4">
          <Alert tone="primary" title={`${lockedCount} fırsatın detayı paketinizde kilitli`}>
            {access.entitlements.planKey === "starter" ? "Starter ilk 10 fırsatın detayını gösterir. Tüm üretilen fırsatlar ve Fix with AI Growth paketinde." : "Detaylar için paketinizi yükseltin."}{" "}
            <Link className="text-primary underline" href={`/w/${workspaceId}/billing`}>Paketleri karşılaştır</Link>
          </Alert>
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-1" aria-label="Durum filtresi">
        <Link href={link({ status: undefined })} className={cn("inline-flex min-h-11 items-center rounded-md border px-3 text-sm sm:min-h-8", !status ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface")}>Tümü</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={link({ status: s })} className={cn("inline-flex min-h-11 items-center rounded-md border px-3 text-sm sm:min-h-8", status === s ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface")}>{OPP_STATUS_LABEL[s]}</Link>
        ))}
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={status ? "Sonuç yok" : "Henüz fırsat yok"} description={status ? "Bu durumda fırsat yok." : "Ölçümler tamamlandıkça rakiplere kaybedilen niyetler burada listelenir."} action={status ? <Link className="text-primary underline" href={base}>Filtreleri sıfırla</Link> : undefined} />
        ) : (
          <TableWrap label="Fırsatlar">
            <thead>
              <tr>
                <Th><Link href={link({ sort: "score" })} aria-sort={sort === "score" ? "descending" : "none"}>Fırsat</Link></Th>
                <Th>Tür</Th>
                <Th numeric>Skor</Th>
                <Th>Durum</Th>
                <Th>Sahip</Th>
                <Th><Link href={link({ sort: "due" })} aria-sort={sort === "due" ? "ascending" : "none"}>Termin</Link></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const isLocked = unlocked !== "all" && !unlocked.has(o.id);
                if (isLocked) {
                  return (
                    <tr key={o.id}>
                      <Td colSpan={6} className="text-muted">🔒 Kilitli fırsat — detay için paket yükseltin</Td>
                    </tr>
                  );
                }
                return (
                  <tr key={o.id}>
                    <Td className="max-w-[28rem]">
                      <Link className="font-medium text-primary hover:underline" href={`${base}/${o.id}`}>{o.title}</Link>
                      <p className="text-xs text-muted">{o.cluster.label} · {o.locale} · {o.channel === "paid" ? "Ücretli" : "Organik"}</p>
                    </Td>
                    <Td>{GAP_LABEL[o.gapType]}</Td>
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
