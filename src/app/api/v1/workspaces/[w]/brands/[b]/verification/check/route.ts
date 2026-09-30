import { db } from "@/lib/db";
import { brandRoute, json } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { checkChallenge } from "@/modules/tenancy/domain-verification";

export const POST = brandRoute(async ({ access, requestId }) => {
  assertCan(access, "brand.manage");
  return json(await checkChallenge(db, access.workspaceId, access.brandId), { requestId });
});
