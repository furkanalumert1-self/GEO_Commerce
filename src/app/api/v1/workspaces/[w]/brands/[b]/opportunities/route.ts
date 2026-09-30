import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, json, parseQuery } from "@/lib/http/api";
import { unlockedOpportunityIds } from "@/modules/opportunities/access";

const q = z.object({ status: z.enum(["new", "triaged", "in_progress", "measuring", "won", "dismissed"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).max(10_000).default(0) });

export const GET = brandRoute(async ({ req, access, requestId }) => {
  const f = parseQuery(req, q);
  const unlocked = await unlockedOpportunityIds(db, access);
  const rows = await db.opportunity.findMany({
    where: { workspaceId: access.workspaceId, brandId: access.brandId, ...(f.status ? { status: f.status } : {}) },
    orderBy: [{ score: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
    skip: f.offset,
    take: f.limit,
    select: { id: true, title: true, gapType: true, locale: true, channel: true, score: true, provisional: true, status: true, priority: true, ownerId: true, dueAt: true, confidence: true },
  });
  const data = rows.map((r) => (unlocked === "all" || unlocked.has(r.id) ? { ...r, locked: false } : { id: r.id, locked: true }));
  return json(data, { requestId });
});
