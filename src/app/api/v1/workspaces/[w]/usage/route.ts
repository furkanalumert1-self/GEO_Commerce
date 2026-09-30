import { db } from "@/lib/db";
import { json, workspaceRoute } from "@/lib/http/api";
import { periodKey, usageSummary } from "@/modules/billing/quota";

export const GET = workspaceRoute(async ({ access, requestId }) => {
  const sub = await db.subscription.findUnique({ where: { workspaceId: access.workspaceId } });
  const period = periodKey(sub?.currentPeriodStart ?? new Date());
  return json({ period, resetAt: sub?.currentPeriodEnd ?? null, plan: access.entitlements.planKey, trial: access.entitlements.trial, usage: await usageSummary(db, access.workspaceId, period) }, { requestId });
});
