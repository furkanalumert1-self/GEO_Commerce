import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { getPrincipal, json, route } from "@/lib/http/api";
import { advanceJob } from "@/lib/queue/advance";
import type { Permission } from "@/lib/permissions";
import { assertCan, isUuid, resolveBrandAccess, resolveWorkspaceAccess } from "@/modules/tenancy/access";

/** Adım bütçesi + kayıt payı; Vercel Hobby (Fluid compute olmadan) dahil tüm planlarda izinli üst sınır. */
export const maxDuration = 120;

/** İşi başlatmak için gereken yetkiyle aynı yetki ilerletmek için de gerekir. */
const PERMISSION: Record<string, Permission> = { monitor_run: "runs.start", crawl: "brand.manage", commerce_sync: "integrations.manage" };

/** Inline modda bir işin sonraki adımını yürütür. Yalnız işin workspace/markasına yetkili kullanıcı. */
export const POST = route<{ id: string }>(async ({ req, params, requestId }) => {
  if (!isUuid(params.id)) throw notFound("Job");
  const principal = await getPrincipal(req);
  const job = await db.jobRecord.findUnique({ where: { id: params.id }, select: { workspaceId: true, brandId: true, type: true } });
  if (!job?.workspaceId || !PERMISSION[job.type]) throw notFound("Job");
  const access = job.brandId ? await resolveBrandAccess(db, principal, job.workspaceId, job.brandId) : await resolveWorkspaceAccess(db, principal, job.workspaceId);
  assertCan(access, PERMISSION[job.type]!);
  return json(await advanceJob(db, params.id, job.workspaceId), { requestId, headers: { "cache-control": "no-store" } });
});
