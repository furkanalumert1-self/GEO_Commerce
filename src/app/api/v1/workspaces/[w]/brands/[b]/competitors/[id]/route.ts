import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { brandRoute, json } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";

/** Silme yerine arşiv: tarihsel ölçüm korunur; rakip seti değişimi trendde işaretlenir. */
export const DELETE = brandRoute<{ w: string; b: string; id: string }>(async ({ params, access, requestId }) => {
  assertCan(access, "prompts.write");
  const c = await db.competitor.findFirst({ where: { id: params.id, brandId: access.brandId, workspaceId: access.workspaceId } });
  if (!c) throw notFound("Rakip");
  await db.competitor.update({ where: { id: c.id }, data: { archivedAt: new Date() } });
  return json({ id: c.id, archived: true }, { requestId });
});

export const PATCH = brandRoute<{ w: string; b: string; id: string }>(async ({ params, access, requestId }) => {
  assertCan(access, "prompts.write");
  const c = await db.competitor.findFirst({ where: { id: params.id, brandId: access.brandId, workspaceId: access.workspaceId } });
  if (!c) throw notFound("Rakip");
  const active = await db.competitor.count({ where: { brandId: access.brandId, archivedAt: null, confirmedAt: { not: null } } });
  if (!c.confirmedAt && active >= access.entitlements.competitorsPerBrand) {
    const { AppError } = await import("@/lib/http/errors");
    throw new AppError("plan_required", `Paketiniz marka başına ${access.entitlements.competitorsPerBrand} rakip içerir`);
  }
  const u = await db.competitor.update({ where: { id: c.id }, data: { confirmedAt: new Date(), archivedAt: null } });
  return json({ id: u.id, confirmedAt: u.confirmedAt }, { requestId });
});
