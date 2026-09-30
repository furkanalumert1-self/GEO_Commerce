import { db } from "@/lib/db";
import { brandRoute, json } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { config } from "@/lib/config";

export const GET = brandRoute(async ({ access, requestId }) => {
  assertCan(access, "ads.read");
  const accounts = await db.adsAccount.findMany({ where: { workspaceId: access.workspaceId, brandId: access.brandId }, select: { id: true, provider: true, externalId: true, currency: true, country: true, capabilities: true, accessStatus: true, lastVerifiedAt: true, automationLevel: true, killSwitch: true, policyVersion: true } });
  return json({ automationEnabled: config().ADS_AUTOMATION_ENABLED, accounts }, { requestId });
});
