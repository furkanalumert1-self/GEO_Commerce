import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { json, route } from "@/lib/http/api";
import { getBillingAdapter } from "@/adapters/billing";
import { applyBillingEvent, recordInbox } from "@/modules/billing/service";
import { log } from "@/lib/observability/log";

/** İmzalı billing webhook: raw body imza doğrulama → durable inbox → 2xx. */
export const POST = route(async ({ req, requestId }) => {
  const adapter = getBillingAdapter();
  if (adapter.status() !== "ready") throw new AppError("not_configured", "Billing yapılandırılmamış");
  const raw = await req.text();
  let evt;
  try {
    evt = adapter.parseWebhook(raw, req.headers.get("stripe-signature"));
  } catch {
    throw new AppError("validation_error", "Geçersiz imza");
  }
  const inbox = await recordInbox(db, "stripe", evt.id, raw, { type: evt.type });
  if (inbox.duplicate) return json({ received: true, duplicate: true }, { requestId });
  try {
    const result = await applyBillingEvent(db, evt);
    await db.inboxEvent.update({ where: { id: inbox.id }, data: { processedAt: new Date() } });
    return json({ received: true, result }, { requestId });
  } catch (e) {
    await db.inboxEvent.update({ where: { id: inbox.id }, data: { error: (e as Error).message.slice(0, 300) } });
    log.error("billing.apply_failed", { requestId, error: e });
    throw e;
  }
});
