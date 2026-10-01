import type { PrismaClient } from "@/generated/prisma/client";
import { config } from "@/lib/config";
import { hashToken, randomToken } from "@/lib/crypto";
import { AppError } from "@/lib/http/errors";
import { enqueue } from "@/lib/queue";
import { log } from "@/lib/observability/log";
import { openJson, sealJson } from "@/lib/secrets";
import { normalizeShopifyOrder, toMinor } from "@/adapters/commerce";
import {
  buildAuthUrl,
  exchangeCode,
  fetchOrdersPage,
  fetchProductsPage,
  fetchShopInfo,
  missingScopes,
  normalizeShopDomain,
  registerWebhooks,
  revokeToken,
  ShopifyAuthError,
  verifyOAuthQuery,
  type ShopifyCredentials,
} from "@/adapters/commerce/shopify";
import { upsertProducts } from "@/modules/catalog/service";
import { attributeOrders, upsertOrder } from "./service";
import { assertCan, resolveBrandAccess, type BrandAccess, type Principal } from "@/modules/tenancy/access";

/**
 * Mağaza bağlantısı yaşam döngüsü (Shopify OAuth):
 * Bağlı değil → Bağlanıyor (OAuth) → Doğrulanıyor (gerçek API kontrolü) → Bağlı | Hata | Yetki süresi doldu.
 * "Bağlı" yalnız token alındıktan ve mağaza API'si + kapsamlar doğrulandıktan sonra yazılır.
 */
const STATE_TTL_MS = 10 * 60_000;
const MAX_PAGES = 200;

export function shopifyConfigured() {
  const cfg = config();
  return Boolean(cfg.SHOPIFY_CLIENT_ID && cfg.SHOPIFY_CLIENT_SECRET && cfg.SECRETS_ENCRYPTION_KEY);
}

export const shopifyCallbackUrl = () => `${config().APP_URL}/api/v1/integrations/shopify/callback`;
export const shopifyWebhookUrl = (integrationId: string) => `${config().APP_URL}/api/v1/webhooks/shopify/${integrationId}`;

export async function startShopifyConnect(db: PrismaClient, access: BrandAccess, shopInput: string, userId: string): Promise<{ authUrl: string }> {
  assertCan(access, "integrations.manage");
  if (access.isDemo) throw new AppError("unsupported", "Demo çalışma alanında gerçek mağaza bağlanamaz");
  const cfg = config();
  if (!shopifyConfigured()) throw new AppError("not_configured", "Shopify uygulaması yapılandırılmamış (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SECRETS_ENCRYPTION_KEY)");
  const shop = normalizeShopDomain(shopInput);
  if (!shop) throw new AppError("validation_error", "Mağaza adresi magaza-adi.myshopify.com biçiminde olmalı", { fieldErrors: { shopDomain: ["Geçerli bir .myshopify.com adresi girin"] } });
  const nonce = randomToken(24);
  const oauth = { nonceHash: hashToken(nonce), expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(), userId };
  const integration = await db.integration.upsert({
    where: { brandId_provider_storeId: { brandId: access.brandId, provider: "shopify", storeId: shop } },
    update: { status: "connecting", errorCode: null, cursor: { oauth } },
    create: { workspaceId: access.workspaceId, brandId: access.brandId, provider: "shopify", storeId: shop, capabilities: {}, scopes: [], status: "connecting", cursor: { oauth } },
  });
  return { authUrl: buildAuthUrl({ shop, clientId: cfg.SHOPIFY_CLIENT_ID!, redirectUri: shopifyCallbackUrl(), state: `${integration.id}.${nonce}` }) };
}

/** OAuth dönüşü: HMAC, state (tek kullanımlık, süreli), mağaza eşleşmesi ve oturumdaki kullanıcının yetkisi doğrulanır. */
export async function completeShopifyConnect(db: PrismaClient, principal: Principal, params: URLSearchParams): Promise<{ workspaceId: string; brandId: string; ok: boolean; reason?: string }> {
  const cfg = config();
  if (!shopifyConfigured()) throw new AppError("not_configured", "Shopify uygulaması yapılandırılmamış");
  if (!verifyOAuthQuery(params, cfg.SHOPIFY_CLIENT_SECRET!)) throw new AppError("unauthenticated", "Geçersiz Shopify imzası");
  const ts = Number(params.get("timestamp"));
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 600) throw new AppError("unauthenticated", "Süresi geçmiş Shopify isteği");
  const shop = normalizeShopDomain(params.get("shop") ?? "");
  const [integrationId, nonce] = (params.get("state") ?? "").split(".");
  const code = params.get("code");
  if (!shop || !integrationId || !nonce || !code) throw new AppError("validation_error", "Eksik OAuth parametresi");
  const integration = await db.integration.findUnique({ where: { id: integrationId } });
  const oauth = (integration?.cursor as { oauth?: { nonceHash: string; expiresAt: string; userId: string } } | null)?.oauth;
  if (!integration || integration.provider !== "shopify" || integration.storeId !== shop || !oauth) throw new AppError("unauthenticated", "Bağlantı isteği bulunamadı");
  if (oauth.nonceHash !== hashToken(nonce) || new Date(oauth.expiresAt) < new Date()) throw new AppError("unauthenticated", "Bağlantı isteğinin süresi doldu; yeniden bağlanın");
  if (principal.kind !== "user" || principal.userId !== oauth.userId) throw new AppError("forbidden", "Bağlantıyı başlatan kullanıcı ile oturum eşleşmiyor");
  const access = await resolveBrandAccess(db, principal, integration.workspaceId, integration.brandId);
  assertCan(access, "integrations.manage");
  // State tek kullanımlık.
  await db.integration.update({ where: { id: integration.id }, data: { cursor: {}, status: "syncing" } });

  const ids = { workspaceId: integration.workspaceId, brandId: integration.brandId };
  try {
    const token = await exchangeCode({ shop, code, clientId: cfg.SHOPIFY_CLIENT_ID!, clientSecret: cfg.SHOPIFY_CLIENT_SECRET! });
    const creds: ShopifyCredentials = { shop, accessToken: token.accessToken };
    const info = await fetchShopInfo(creds);
    const missing = missingScopes(info.grantedScopes);
    if (missing.length) {
      await db.integration.update({ where: { id: integration.id }, data: { status: "reauth_required", errorCode: `missing_scopes:${missing.join(",")}`, secretRef: null } });
      return { ...ids, ok: false, reason: "missing_scopes" };
    }
    const failedHooks = await registerWebhooks(creds, shopifyWebhookUrl(integration.id)).catch(() => ["all"]);
    await db.integration.update({
      where: { id: integration.id },
      data: {
        status: "healthy",
        secretRef: sealJson({ shop, accessToken: token.accessToken }),
        scopes: info.grantedScopes,
        capabilities: { catalogRead: true, ordersRead: true, refundsRead: true, contentWrite: false, oauth: true },
        errorCode: failedHooks.length ? `webhooks_failed:${failedHooks.join(",")}` : null,
        cursor: { shopName: info.name, currency: info.currency, primaryUrl: info.primaryUrl },
      },
    });
    await enqueueCommerceSync(db, integration.id, ids);
    return { ...ids, ok: true };
  } catch (e) {
    log.warn("shopify.connect_failed", { integrationId: integration.id, error: e instanceof Error ? e.message : "unknown" });
    await db.integration.update({ where: { id: integration.id }, data: { status: e instanceof ShopifyAuthError ? "reauth_required" : "degraded", errorCode: e instanceof ShopifyAuthError ? "auth_rejected" : "connect_failed", secretRef: null } });
    return { ...ids, ok: false, reason: "connect_failed" };
  }
}

export async function enqueueCommerceSync(db: PrismaClient, integrationId: string, ids: { workspaceId: string; brandId: string }) {
  // Aynı dakikada tekrar tıklama mükerrer iş üretmez.
  return enqueue(db, { type: "commerce_sync", operationId: `commerce_sync:${integrationId}:${Math.floor(Date.now() / 60_000)}`, workspaceId: ids.workspaceId, brandId: ids.brandId, payload: { integrationId } });
}

export async function requestSync(db: PrismaClient, access: BrandAccess, provider: string) {
  assertCan(access, "integrations.manage");
  const integration = await db.integration.findFirst({ where: { brandId: access.brandId, workspaceId: access.workspaceId, provider, status: { in: ["healthy", "degraded"] }, secretRef: { not: null } } });
  if (!integration) throw new AppError("conflict", "Senkronizasyon için doğrulanmış bir bağlantı yok");
  return enqueueCommerceSync(db, integration.id, { workspaceId: access.workspaceId, brandId: access.brandId });
}

/** Worker: katalog + sipariş senkronizasyonu. Yetkisiz/başarısız aktarım başarı sayılmaz. */
export async function syncIntegration(db: PrismaClient, integrationId: string): Promise<{ products: number; orders: number }> {
  const integration = await db.integration.findUniqueOrThrow({ where: { id: integrationId } });
  if (integration.provider !== "shopify") throw new AppError("unsupported", "Bu sağlayıcı için senkronizasyon yok");
  if (!integration.secretRef) throw new ShopifyAuthError("Bağlantı anahtarı yok");
  const ids = { workspaceId: integration.workspaceId, brandId: integration.brandId };
  const creds = openJson(integration.secretRef) as unknown as ShopifyCredentials;
  try {
    const info = await fetchShopInfo(creds);
    let products = 0;
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await fetchProductsPage(creds, info, cursor, toMinor);
      products += await upsertProducts(db, ids, page.items, "shopify", integration.id);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    let orders = 0;
    cursor = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await fetchOrdersPage(creds, cursor, normalizeShopifyOrder);
      for (const o of page.items) await upsertOrder(db, { ...ids, connectorId: integration.id }, o);
      orders += page.items.length;
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    if (orders) await attributeOrders(db, ids.workspaceId, ids.brandId);
    await db.integration.update({ where: { id: integration.id }, data: { status: "healthy", lastSyncAt: new Date(), errorCode: integration.errorCode?.startsWith("webhooks_failed") ? integration.errorCode : null } });
    return { products, orders };
  } catch (e) {
    const auth = e instanceof ShopifyAuthError;
    await db.integration.update({ where: { id: integration.id }, data: { status: auth ? "reauth_required" : "degraded", errorCode: auth ? "auth_rejected" : "sync_failed" } });
    throw e;
  }
}

export async function disconnectIntegration(db: PrismaClient, access: BrandAccess, provider: string) {
  assertCan(access, "integrations.manage");
  const list = await db.integration.findMany({ where: { brandId: access.brandId, workspaceId: access.workspaceId, provider } });
  if (!list.length) throw new AppError("not_found", "Bağlantı bulunamadı");
  for (const i of list) {
    if (i.provider === "shopify" && i.secretRef) {
      await revokeToken(openJson(i.secretRef) as unknown as ShopifyCredentials).catch((e) => log.warn("shopify.revoke_failed", { integrationId: i.id, error: e instanceof Error ? e.message : "unknown" }));
    }
    // Aktarılmış katalog/sipariş verisi korunur; yalnız erişim kaldırılır.
    await db.integration.update({ where: { id: i.id }, data: { status: "not_configured", secretRef: null, scopes: [], capabilities: {}, errorCode: null, cursor: {} } });
  }
  return { disconnected: list.length };
}
