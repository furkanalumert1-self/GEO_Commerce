import { db } from "@/lib/db";
import { executionMode, getQueue } from "@/lib/queue";
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
  // inline: Redis/worker kullanılmaz. queue: Redis zorunlu; yoksa işler başlatılamaz → degraded.
  if (executionMode() === "queue") {
    try {
      const q = getQueue();
      if (!q) throw new Error("JOB_EXECUTION_MODE=queue ama REDIS_URL tanımlı değil");
      await q.getJobCounts("waiting");
    } catch (e) {
      ok = false;
      log.error("health.queue", { error: e });
    }
  }
  return Response.json({ status: ok ? "ready" : "degraded" }, { status: ok ? 200 : 503 });
}
