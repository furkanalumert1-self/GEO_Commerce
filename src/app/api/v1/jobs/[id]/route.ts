import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { getPrincipal, json, route } from "@/lib/http/api";
import { jobStatus } from "@/lib/queue";
import { resolveWorkspaceAccess, isUuid } from "@/modules/tenancy/access";

/** Yalnız çağıranın erişebildiği workspace'e ait job; rastgele job ID okunamaz. */
export const GET = route<{ id: string }>(async ({ req, params, requestId }) => {
  if (!isUuid(params.id)) throw notFound("Job");
  const principal = await getPrincipal(req);
  const job = await db.jobRecord.findUnique({ where: { id: params.id }, select: { workspaceId: true } });
  if (!job?.workspaceId) throw notFound("Job");
  await resolveWorkspaceAccess(db, principal, job.workspaceId);
  const status = await jobStatus(db, params.id, job.workspaceId);
  if (!status) throw notFound("Job");
  return json(status, { requestId });
});
