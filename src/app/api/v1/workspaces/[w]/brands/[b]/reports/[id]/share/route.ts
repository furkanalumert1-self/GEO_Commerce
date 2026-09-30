import { z } from "zod";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { notFound } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { createShareLink } from "@/modules/reports/service";

type P = { w: string; b: string; id: string };

export const POST = brandRoute<P>(async ({ req, params, access, requestId }) => {
  assertCan(access, "reports.manage");
  const { days } = await readJson(req, z.object({ days: z.number().int().min(1).max(30).default(7) }));
  const token = await createShareLink(db, access, params.id, days);
  return json({ url: `${config().APP_URL}/r/${token}`, expiresInDays: days }, { status: 201, requestId });
});

/** Tüm aktif paylaşım bağlantılarını iptal eder. */
export const DELETE = brandRoute<P>(async ({ params, access, requestId }) => {
  assertCan(access, "reports.manage");
  const r = await db.report.findFirst({ where: { id: params.id, brandId: access.brandId, workspaceId: access.workspaceId } });
  if (!r) throw notFound("Rapor");
  const n = await db.shareLink.updateMany({ where: { reportId: r.id, revokedAt: null }, data: { revokedAt: new Date() } });
  return json({ revoked: n.count }, { requestId });
});
