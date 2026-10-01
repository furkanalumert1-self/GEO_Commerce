import { db } from "@/lib/db";
import { brandRoute, json } from "@/lib/http/api";
import { disconnectIntegration } from "@/modules/commerce/connect";

/** Bağlantıyı kes: token iptal edilir ve silinir; aktarılmış veri korunur. */
export const DELETE = brandRoute<{ w: string; b: string; provider: string }>(async ({ params, access, requestId }) => {
  return json(await disconnectIntegration(db, access, params.provider), { requestId });
});
