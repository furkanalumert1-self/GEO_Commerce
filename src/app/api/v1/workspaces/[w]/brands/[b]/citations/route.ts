import { db } from "@/lib/db";
import { brandRoute, json } from "@/lib/http/api";

/** Kaynak/site bazında toplam: site sayısı ile URL sayısı ayrı tutulur. */
export const GET = brandRoute(async ({ access, requestId }) => {
  const rows = await db.citation.groupBy({ by: ["domain", "association", "sourceType"], where: { workspaceId: access.workspaceId, observation: { brandId: access.brandId } }, _count: { _all: true } });
  return json(rows.map((r) => ({ domain: r.domain, association: r.association, sourceType: r.sourceType, citations: r._count._all })), { requestId });
});
