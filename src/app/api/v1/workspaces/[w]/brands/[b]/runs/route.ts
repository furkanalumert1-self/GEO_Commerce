import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, json, readJson, withIdempotency } from "@/lib/http/api";
import { startMonitoringRun } from "@/modules/monitoring/start";

const body = z.object({
  promptIds: z.array(z.string().uuid()).max(300).optional(),
  engines: z.array(z.enum(["chatgpt", "gemini", "perplexity", "google_ai_overviews", "copilot"])).min(1).max(5),
  locales: z.array(z.string().regex(/^[a-z]{2}-[A-Z]{2}$/)).min(1).max(5),
  repeats: z.number().int().min(1).max(5).default(1),
  preview: z.boolean().default(false),
});

/** POST runs: preview → maliyet tahmini; aksi halde kota reserve + 202 job. Idempotency-Key zorunlu. */
export const POST = brandRoute(async ({ req, access, requestId }) => {
  const input = await readJson(req, body);
  if (input.preview) {
    const out = await startMonitoringRun(db, access, { ...input, repetitions: input.repeats, previewOnly: true, idempotencyKey: "preview" });
    return json(out.preview, { requestId });
  }
  const key = req.headers.get("idempotency-key") ?? "";
  return withIdempotency(req, access.workspaceId, `runs:${access.brandId}`, input, requestId, async () => {
    const out = await startMonitoringRun(db, access, { ...input, repetitions: input.repeats, idempotencyKey: key });
    return { status: 202, data: { jobId: out.jobId, runId: out.run?.id, status: "queued", statusUrl: `/api/v1/jobs/${out.jobId}`, preview: out.preview } };
  });
});

export const GET = brandRoute(async ({ access, requestId }) => {
  const runs = await db.monitoringRun.findMany({ where: { workspaceId: access.workspaceId, brandId: access.brandId }, orderBy: { scheduledAt: "desc" }, take: 25 });
  return json(runs, { requestId });
});
