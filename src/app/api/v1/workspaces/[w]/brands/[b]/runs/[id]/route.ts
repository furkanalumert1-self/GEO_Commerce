import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { brandRoute, json } from "@/lib/http/api";

export const GET = brandRoute<{ w: string; b: string; id: string }>(async ({ params, access, requestId }) => {
  const run = await db.monitoringRun.findFirst({ where: { id: params.id, workspaceId: access.workspaceId, brandId: access.brandId } });
  if (!run) throw notFound("Run");
  return json(run, { requestId });
});
