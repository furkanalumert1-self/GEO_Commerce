import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json, listQuery, parseQuery } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { hasFeature } from "@/modules/billing/plans";
import { revenueSummary } from "@/modules/commerce/service";

export const GET = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "commerce.read");
  if (!hasFeature(access.entitlements, "revenue")) throw new AppError("plan_required", "Gelir ölçümü Commerce ve üzeri paketlerde", { requiredPlan: "commerce" });
  const q = parseQuery(req, listQuery.extend({ model: listQuery.shape.sort }));
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
  return json(await revenueSummary(db, access.workspaceId, access.brandId, { from, to, model: q.model }), { requestId });
});
