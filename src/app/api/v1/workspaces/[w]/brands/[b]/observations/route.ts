import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, json, parseQuery } from "@/lib/http/api";

const q = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(25), runId: z.string().uuid().optional(), engine: z.string().max(40).optional(), status: z.enum(["succeeded", "failed", "parse_failed", "pending"]).optional() });

export const GET = brandRoute(async ({ req, access, requestId }) => {
  const f = parseQuery(req, q);
  const rows = await db.observation.findMany({
    where: { workspaceId: access.workspaceId, brandId: access.brandId, ...(f.runId ? { runId: f.runId } : {}), ...(f.engine ? { engine: f.engine } : {}), ...(f.status ? { status: f.status } : {}) },
    select: { id: true, runId: true, provider: true, engine: true, model: true, surface: true, country: true, language: true, status: true, errorCode: true, sampledAt: true, repetition: true, attempt: true, rawText: true, listDetected: true, mentions: true, citations: true, promptVersion: { select: { text: true, version: true } } },
    orderBy: { id: "asc" },
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });
  return json(rows.slice(0, f.limit), { requestId, nextCursor: rows.length > f.limit ? rows[f.limit - 1]!.id : null });
});
