import { db } from "@/lib/db";
import { json, route } from "@/lib/http/api";
import { requirePlatformAdmin } from "../guard";

export const GET = route(async ({ req, requestId }) => {
  await requirePlatformAdmin(req);
  const [queued, running, dead, tenants, inboxErrors] = await Promise.all([
    db.jobRecord.count({ where: { status: "queued" } }),
    db.jobRecord.count({ where: { status: "running" } }),
    db.jobRecord.count({ where: { status: "dead" } }),
    db.workspace.count(),
    db.inboxEvent.count({ where: { error: { not: null } } }),
  ]);
  return json({ jobs: { queued, running, dead }, tenants, inboxErrors }, { requestId });
});
