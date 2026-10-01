import { db } from "@/lib/db";
import { brandRoute, json } from "@/lib/http/api";
import { requestSync } from "@/modules/commerce/connect";

/** Elle senkronizasyon: yalnız doğrulanmış bağlantıda; aynı dakikada tekrar mükerrer iş üretmez. */
export const POST = brandRoute<{ w: string; b: string; provider: string }>(async ({ params, access, requestId }) => {
  const job = await requestSync(db, access, params.provider);
  return json({ jobId: job.id, status: job.status }, { status: 202, requestId });
});
