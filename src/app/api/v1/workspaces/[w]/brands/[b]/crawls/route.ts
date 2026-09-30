import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json, readJson, withIdempotency } from "@/lib/http/api";
import { enqueue } from "@/lib/queue";
import { assertCan, assertCanRunPaidJob } from "@/modules/tenancy/access";
import { ensureBucket, periodKey, reserve } from "@/modules/billing/quota";

const body = z.object({ maxPages: z.number().int().min(1).max(1000).default(50) });

export const POST = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "brand.manage");
  assertCanRunPaidJob(access);
  const input = await readJson(req, body);
  const key = req.headers.get("idempotency-key") ?? "";
  return withIdempotency(req, access.workspaceId, `crawls:${access.brandId}`, input, requestId, async () => {
    const sub = await db.subscription.findUnique({ where: { workspaceId: access.workspaceId } });
    const period = periodKey(sub?.currentPeriodStart ?? new Date());
    const b = await ensureBucket(db, access.workspaceId, "crawl_urls", period, access.entitlements.crawlUrls);
    const maxPages = Math.min(input.maxPages, b.limit - b.used - b.reserved);
    if (maxPages <= 0) throw new AppError("quota_exceeded", "Crawl URL kotası doldu", { limit: b.limit, used: b.used });
    const opId = `crawl:${access.workspaceId}:${key}`;
    await reserve(db, { workspaceId: access.workspaceId, metric: "crawl_urls", period, limit: access.entitlements.crawlUrls, amount: maxPages, operationId: opId, ttlMs: 3 * 3600_000 });
    const run = await db.crawlRun.create({ data: { workspaceId: access.workspaceId, brandId: access.brandId, maxPages } });
    const job = await enqueue(db, { type: "crawl", operationId: `job:${opId}`, workspaceId: access.workspaceId, brandId: access.brandId, payload: { crawlRunId: run.id, maxPages, quotaOperationId: opId } });
    return { status: 202, data: { jobId: job.id, crawlRunId: run.id, status: "queued", statusUrl: `/api/v1/jobs/${job.id}` } };
  });
});
