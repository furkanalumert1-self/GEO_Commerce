import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, parseQuery } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { toCsv } from "@/modules/reports/csv";

/** Outreach görev listesi (CSV). Kendiliğinden e-posta gönderilmez. */
export const GET = brandRoute(async ({ req, access }) => {
  assertCan(access, "export");
  const { days } = parseQuery(req, z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }));
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.citation.groupBy({ by: ["domain", "sourceType"], where: { workspaceId: access.workspaceId, association: "third_party", observation: { brandId: access.brandId, sampledAt: { gte: since } } }, _count: { _all: true } });
  const csv = toCsv(["domain", "source_type", "citations", "task"], rows.sort((a, b) => b._count._all - a._count._all).map((r) => [r.domain, r.sourceType, r._count._all, "Marka bilgisinin doğruluğunu ve yer alma fırsatını değerlendir"]));
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="citation-outreach.csv"` } });
});
