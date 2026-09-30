import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { brandRoute } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { reportCsv } from "@/modules/reports/service";

export const GET = brandRoute<{ w: string; b: string; id: string }>(async ({ params, access }) => {
  assertCan(access, "export");
  const r = await db.report.findFirst({ where: { id: params.id, workspaceId: access.workspaceId, brandId: access.brandId } });
  if (!r?.snapshot) throw notFound("Rapor");
  return new Response(reportCsv(r.snapshot as Record<string, unknown>), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="rapor-${r.id.slice(0, 8)}.csv"` } });
});
