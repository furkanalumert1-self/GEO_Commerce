import { db } from "@/lib/db";
import { brandRoute, json } from "@/lib/http/api";
import { publishAction } from "@/modules/actions/service";

export const POST = brandRoute<{ w: string; b: string; id: string }>(async ({ params, access, requestId }) => {
  await publishAction(db, access, params.id);
  return json({ status: "publishing" }, { status: 202, requestId });
});
