import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { hasFeature } from "@/modules/billing/plans";

/** Sipariş drilldown — müşteri PII içermez (yalnız pseudonymous kimlik yok, tutarlar ve durum). */
export const GET = brandRoute(async ({ access, requestId }) => {
  assertCan(access, "commerce.read");
  if (!hasFeature(access.entitlements, "revenue")) throw new AppError("plan_required", "Gelir ölçümü Commerce ve üzeri paketlerde");
  const rows = await db.order.findMany({ where: { workspaceId: access.workspaceId, brandId: access.brandId }, orderBy: { paidAt: "desc" }, take: 100, select: { id: true, externalOrderId: true, status: true, paidAt: true, currency: true, grossMinor: true, discountMinor: true, refundedMinor: true, netMinor: true, attributions: { select: { modelVersion: true, channel: true } } } });
  return json(rows, { requestId });
});
