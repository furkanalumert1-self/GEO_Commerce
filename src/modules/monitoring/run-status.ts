import type { PrismaClient } from "@/generated/prisma/client";

/** Bu süreden uzun ilerlemeyen "sürüyor" çalışması duraklamış sayılır (Redis'siz modda sekme kapatılmış olabilir). */
export const STALL_MS = 10 * 60_000;

export interface RunProgress {
  succeeded: number;
  failed: number;
  pending: number;
  lastActivity: Date | null;
}

/**
 * Çalışma ilerlemesi gözlemlerden canlı hesaplanır (tek kaynak): sayaçlar çalışma bitene kadar 0 kalmaz.
 * Bekleyen = planlanan − başarılı − başarısız; API yeniden denemeleri aynı gözlemi günceller, yeni örneklem sayılmaz.
 */
export async function runProgress(db: PrismaClient, runs: Array<{ id: string; scheduledCount: number }>): Promise<Map<string, RunProgress>> {
  const out = new Map<string, RunProgress>();
  if (!runs.length) return out;
  const rows = await db.observation.groupBy({ by: ["runId", "status"], where: { runId: { in: runs.map((r) => r.id) } }, _count: { _all: true }, _max: { updatedAt: true } });
  for (const r of runs) {
    const mine = rows.filter((x) => x.runId === r.id);
    const succeeded = mine.filter((x) => x.status === "succeeded").reduce((s, x) => s + x._count._all, 0);
    const failed = mine.filter((x) => x.status === "failed" || x.status === "parse_failed").reduce((s, x) => s + x._count._all, 0);
    const last = mine.map((x) => x._max.updatedAt).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    out.set(r.id, { succeeded, failed, pending: Math.max(0, r.scheduledCount - succeeded - failed), lastActivity: last });
  }
  return out;
}

/** Sürmekte görünen ama uzun süredir ilerlemeyen çalışma. */
export function isStalled(run: { status: string; startedAt: Date | null; scheduledAt: Date }, p: RunProgress | undefined, now = Date.now()): boolean {
  if (run.status !== "queued" && run.status !== "running") return false;
  const last = Math.max(p?.lastActivity?.getTime() ?? 0, run.startedAt?.getTime() ?? 0, run.scheduledAt.getTime());
  return now - last > STALL_MS;
}
