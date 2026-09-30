import { db } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { log } from "@/lib/observability/log";

export const dynamic = "force-dynamic";

/** Minimal durum; bağımlılık ayrıntıları yalnız iç loglarda. */
export async function GET() {
  let ok = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (e) {
    ok = false;
    log.error("health.db", { error: e });
  }
  try {
    const q = getQueue();
    if (q) await q.getJobCounts("waiting");
  } catch (e) {
    ok = false;
    log.error("health.redis", { error: e });
  }
  return Response.json({ status: ok ? "ready" : "degraded" }, { status: ok ? 200 : 503 });
}
