import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { createReportSnapshot } from "@/modules/reports/service";

export const GET = brandRoute(async ({ access, requestId }) => {
  const rows = await db.report.findMany({ where: { workspaceId: access.workspaceId, brandId: access.brandId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, template: true, status: true, snapshotAt: true, filters: true, createdAt: true } });
  return json(rows, { requestId });
});

const body = z.object({ template: z.enum(["executive", "monthly"]).default("executive"), days: z.number().int().min(1).max(365).default(30) });

export const POST = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "export");
  const input = await readJson(req, body);
  const to = new Date();
  const r = await createReportSnapshot(db, access, { from: new Date(to.getTime() - input.days * 86_400_000), to, template: input.template, userId: access.principal.userId });
  return json({ id: r.id, status: r.status }, { status: 201, requestId });
});
