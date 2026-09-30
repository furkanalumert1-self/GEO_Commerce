"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ShellWorkspace } from "./shell";

/**
 * Workspace/marka değiştirici. Seçenekler yalnız sunucunun erişim verdiği kayıtlardır; hedef sayfa yine
 * sunucuda yetki kontrolünden geçer. Uygun filtreler (tarih/motor) korunur.
 */
export function ContextSwitcher({ workspaces, currentWorkspaceId, currentBrandId }: { workspaces: ShellWorkspace[]; currentWorkspaceId: string; currentBrandId: string | null }) {
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

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="ws-switch">Çalışma alanı</label>
      <select
        id="ws-switch"
        className="min-h-11 max-w-[14rem] rounded-md border border-border bg-surface px-2 text-sm sm:min-h-9"
        value={currentWorkspaceId}
        onChange={(e) => router.push(`/w/${e.target.value}/overview`)}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>
      {ws && ws.brands.length > 0 ? (
        <>
          <label className="sr-only" htmlFor="brand-switch">Marka</label>
          <select
            id="brand-switch"
            className="min-h-11 max-w-[14rem] rounded-md border border-border bg-surface px-2 text-sm sm:min-h-9"
            value={currentBrandId ?? ""}
            onChange={(e) => e.target.value && router.push(`/w/${currentWorkspaceId}/b/${e.target.value}/${section}${qs}`)}
          >
            {!currentBrandId ? <option value="">Marka seçin</option> : null}
            {ws.brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}
