"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui";
import type { ShellWorkspace } from "./shell";

const selectClass = (layout: "inline" | "stacked") =>
  cn(
    "min-h-11 rounded-md border border-border bg-surface px-2.5 text-sm font-medium hover:border-border-strong lg:min-h-9",
    layout === "stacked" ? "w-full" : "min-w-0 max-w-[11rem] flex-1 sm:max-w-[14rem] sm:flex-none",
  );

/**
 * Workspace/marka değiştirici. Seçenekler yalnız sunucunun erişim verdiği kayıtlardır; hedef sayfa yine
 * sunucuda yetki kontrolünden geçer. Uygun filtreler (tarih/motor) korunur.
 */
export function ContextSwitcher({
  workspaces,
  currentWorkspaceId,
  currentBrandId,
  layout = "inline",
  idSuffix = "",
}: {
  workspaces: ShellWorkspace[];
  currentWorkspaceId: string;
  currentBrandId: string | null;
  layout?: "inline" | "stacked";
  /** Masaüstü kenar çubuğu ve mobil başlık aynı sayfada iki kopya render eder; id'ler tekil kalmalı. */
  idSuffix?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const ws = workspaces.find((w) => w.id === currentWorkspaceId);
  const keep = new URLSearchParams();
  for (const k of ["range", "from", "to", "engine"]) {
    const v = sp.get(k);
    if (v) keep.set(k, v);
  }
  const qs = keep.toString() ? `?${keep.toString()}` : "";
  const section = pathname.match(/\/b\/[^/]+\/([^/]+)/)?.[1] ?? "dashboard";

  // Aynı adlı çalışma alanları (ör. üç "Homedius") domain + kısa kimlikle ayırt edilir.
  const dup = new Set(workspaces.map((w) => w.name).filter((n, i, a) => a.indexOf(n) !== i));
  const wsLabel = (w: ShellWorkspace) => (dup.has(w.name) ? `${w.name} · ${w.brands[0]?.domain ?? w.id.slice(0, 8)} · ${w.id.slice(0, 8)}` : w.name);
  const singleBrand = ws && ws.brands.length === 1 && currentBrandId === ws.brands[0]!.id ? ws.brands[0]! : null;

  return (
    <div className={layout === "stacked" ? "flex flex-col gap-1 rounded-[var(--radius-md)] border border-border bg-surface p-2" : "flex min-w-0 flex-1 items-center gap-2"}>
      <label className={layout === "stacked" ? "px-1 text-xs font-medium text-text-secondary" : "sr-only"} htmlFor={`ws-switch${idSuffix}`}>Çalışma alanı</label>
      <select
        id={`ws-switch${idSuffix}`}
        className={cn(selectClass(layout), layout === "stacked" && "border-transparent font-semibold hover:border-border")}
        value={currentWorkspaceId}
        onChange={(e) => router.push(`/w/${e.target.value}/overview`)}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>{wsLabel(w)}</option>
        ))}
      </select>
      {singleBrand ? (
        layout === "stacked" ? <p className="truncate px-2.5 text-xs text-text-secondary" title={singleBrand.domain}>{singleBrand.domain} · {currentWorkspaceId.slice(0, 8)}</p> : null
      ) : ws && ws.brands.length > 0 ? (
        <>
          <label className={layout === "stacked" ? "mt-1 px-1 text-xs font-medium text-text-secondary" : "sr-only"} htmlFor={`brand-switch${idSuffix}`}>Marka</label>
          <select
            id={`brand-switch${idSuffix}`}
            className={selectClass(layout)}
            value={currentBrandId ?? ""}
            onChange={(e) => e.target.value && router.push(`/w/${currentWorkspaceId}/b/${e.target.value}/${section}${qs}`)}
          >
            {!currentBrandId ? <option value="">Marka seçin</option> : null}
            {ws.brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name} · {b.domain}</option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}
