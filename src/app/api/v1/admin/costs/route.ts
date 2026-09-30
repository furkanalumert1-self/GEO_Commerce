import { db } from "@/lib/db";
import { json, route } from "@/lib/http/api";
import { requirePlatformAdmin } from "../guard";

/** Gerçek usage/CostLedger verisinden maliyet; sağlayıcı fiyat varsayımı yok (bilinmeyen maliyet 0 değil, ayrı sayılır). */
export const GET = route(async ({ req, requestId }) => {
  await requirePlatformAdmin(req);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db.costLedger.groupBy({ by: ["provider", "succeeded"], where: { createdAt: { gte: since } }, _sum: { costMicros: true }, _count: { _all: true } });
  return json(rows.map((r) => ({ provider: r.provider, succeeded: r.succeeded, attempts: r._count._all, costUsd: Number(r._sum.costMicros ?? 0n) / 1e6 })), { requestId });
});
