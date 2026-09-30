import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { json, rateLimit, route } from "@/lib/http/api";
import { getSharedReport } from "@/modules/reports/service";

export const GET = route<{ token: string }>(async ({ req, params, requestId }) => {
  rateLimit(`share:${req.headers.get("x-forwarded-for") ?? "local"}`, 60, 60_000);
  const r = await getSharedReport(db, params.token);
  if (!r) throw notFound("Rapor");
  return json({ snapshot: r.snapshot, snapshotAt: r.snapshotAt }, { requestId, headers: { "x-robots-tag": "noindex", "cache-control": "no-store" } });
});
