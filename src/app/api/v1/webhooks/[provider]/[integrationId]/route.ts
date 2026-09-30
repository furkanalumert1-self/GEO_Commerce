import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { AppError, notFound } from "@/lib/http/errors";
import { json, route } from "@/lib/http/api";
import { sha256 } from "@/lib/crypto";
import { getCommerceAdapters } from "@/adapters/commerce";
import { recordInbox } from "@/modules/billing/service";
import { upsertOrder } from "@/modules/commerce/service";
import { isUuid } from "@/modules/tenancy/access";

/**
 * Commerce webhook: sağlayıcının resmi imza protokolü (genel HMAC varsayımı zorlanmaz).
 * Durable inbox'a yazıldıktan sonra 2xx; replay duplicate order yaratmaz (unique + inbox).
 */
export const POST = route<{ provider: string; integrationId: string }>(async ({ req, params, requestId }) => {
  if (!isUuid(params.integrationId)) throw notFound("Entegrasyon");
  const integration = await db.integration.findUnique({ where: { id: params.integrationId } });
  if (!integration || integration.provider !== params.provider) throw notFound("Entegrasyon");
  const adapter = getCommerceAdapters()[params.provider];
  if (!adapter) throw notFound("Sağlayıcı");
  const raw = await req.text();
  const headers = Object.fromEntries([...req.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  const secret = params.provider === "shopify" ? config().SHOPIFY_CLIENT_SECRET : undefined;
  if (!secret || !adapter.verifyWebhook(raw, headers, secret)) throw new AppError("unauthenticated", "Geçersiz webhook imzası");
  const eventId = headers["x-shopify-webhook-id"] ?? headers["x-webhook-id"] ?? sha256(raw);
  const inbox = await recordInbox(db, `${params.provider}:${integration.id}`, eventId, raw, { topic: headers["x-shopify-topic"] ?? null });
  if (inbox.duplicate) return json({ received: true, duplicate: true }, { requestId });
  const order = adapter.normalizeEvent(JSON.parse(raw));
  if (order) await upsertOrder(db, { workspaceId: integration.workspaceId, brandId: integration.brandId, connectorId: integration.id }, order);
  await db.inboxEvent.update({ where: { id: inbox.id }, data: { processedAt: new Date() } });
  return json({ received: true }, { requestId });
});
