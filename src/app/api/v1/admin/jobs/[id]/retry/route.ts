import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/api";
import { enqueue, relayOutbox } from "@/lib/queue";
import { replayDeadJob } from "@/workers/runner";
import { requirePlatformAdmin } from "../../../guard";

export const POST = route<{ id: string }>(async ({ req, params, requestId }) => {
  const admin = await requirePlatformAdmin(req);
  const { reason } = await readJson(req, z.object({ reason: z.string().trim().min(5).max(300) }));
  const job = await db.jobRecord.findUnique({ where: { id: params.id } });
  if (!job) throw notFound("Job");
  if (job.status !== "dead") throw new AppError("conflict", "Yalnız DLQ'daki işler yeniden oynatılabilir");
  await replayDeadJob(db, job.id);
  await db.outboxEvent.create({ data: { workspaceId: job.workspaceId, eventType: "job.enqueue", payload: { jobId: job.id } } });
  await relayOutbox(db).catch(() => undefined);
  await db.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: admin.id, actorType: "platform_admin", scope: "admin", action: "job.replayed", target: job.id, reason, requestId } });
  void enqueue;
  return json({ id: job.id, status: "queued" }, { requestId });
});
