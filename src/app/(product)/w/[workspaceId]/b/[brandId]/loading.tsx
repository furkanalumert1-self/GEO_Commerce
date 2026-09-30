import { Skeleton } from "@/components/ui";

/** Sabit boyutlu iskelet; sahte KPI/animasyonlu sayı yok. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Yükleniyor" className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px]" />)}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
