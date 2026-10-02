import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/http/errors";
import { executionMode, jobStatus } from "@/lib/queue";
import { stepDeadline } from "@/lib/queue/inline";
import { runJob, type RunOutcome } from "@/workers/runner";

/**
 * Inline modda bir işin tek sınırlı adımını yürütür (istek içinde, await edilerek). Kilit (lease) sayesinde
 * paralel/çift istek ikinci kez çalıştırmaz ("busy"). Kalıcı durum JobRecord'dadır; sekme kapanırsa iş
 * "devam bekliyor" durumunda kalır ve aynı uç noktayla sürdürülür. Arka planda kendiliğinden ilerlemez.
 */
export async function advanceJob(db: PrismaClient, jobId: string, workspaceId: string | null) {
  if (executionMode() !== "inline") throw new AppError("conflict", "Bu dağıtımda işler worker tarafından yürütülür");
  const before = await db.jobRecord.findUnique({ where: { id: jobId } });
  if (!before) throw new AppError("not_found", "İş bulunamadı");
  let outcome: RunOutcome | "terminal" = "terminal";
  if (["queued", "running", "failed"].includes(before.status)) {
    outcome = await runJob(db, jobId, "inline", { deadline: stepDeadline() });
  }
  const status = await jobStatus(db, jobId, workspaceId);
  return { outcome: outcome === "skipped" ? "busy" : outcome, job: status };
}
