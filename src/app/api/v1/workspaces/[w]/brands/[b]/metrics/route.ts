import { db } from "@/lib/db";
import { brandRoute, json, listQuery, parseQuery } from "@/lib/http/api";
import { brandMetrics } from "@/modules/monitoring/queries";

export const GET = brandRoute(async ({ req, access, requestId }) => {
  const q = parseQuery(req, listQuery);
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
  const m = await brandMetrics(db, access.workspaceId, access.brandId, { from, to, engines: q.engine ? [q.engine] : undefined, locale: q.language && q.country ? `${q.language}-${q.country}` : undefined });
  return json(m, { requestId });
});
