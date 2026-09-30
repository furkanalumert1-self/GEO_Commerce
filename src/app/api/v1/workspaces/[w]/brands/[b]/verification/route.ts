import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { createChallenge } from "@/modules/tenancy/domain-verification";

export const POST = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "brand.manage");
  const { method } = await readJson(req, z.object({ method: z.enum(["dns_txt", "html_token"]) }));
  return json(await createChallenge(db, access.workspaceId, access.brandId, method), { status: 201, requestId });
});
