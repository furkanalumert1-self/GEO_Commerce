import { db } from "@/lib/db";
import { json, rateLimit, readJson, route } from "@/lib/http/api";
import { eventsBatchSchema, ingestEvents } from "@/modules/commerce/service";

/**
 * Tracker event batch. Public siteKey secret değildir: domain allowlist + rate limit.
 * Para olayları doğrulanmış mağaza siparişiyle teyit edilir; bu uç gelir kaynağı değildir.
 */
export const POST = route(async ({ req, requestId }) => {
  const input = await readJson(req, eventsBatchSchema);
  rateLimit(`events:${input.siteKey}`, 600, 60_000);
  const out = await ingestEvents(db, input, req.headers.get("origin"));
  return json({ ...out, trustedRevenue: false }, { status: 202, requestId, headers: { "access-control-allow-origin": req.headers.get("origin") ?? "*" } });
});

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": req.headers.get("origin") ?? "*", "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600" } });
}
