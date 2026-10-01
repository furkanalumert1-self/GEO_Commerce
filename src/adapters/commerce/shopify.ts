import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto";
import type { NormalizedOrder, NormalizedProduct, SyncPage } from "./types";

/**
 * Shopify Admin API istemcisi (OAuth authorization code grant, offline token).
 * Yalnız okuma kapsamları istenir; içerik yazma/yayın bu sürümde desteklenmez (export + manuel bildirim).
 * Ağ çağrıları yalnız doğrulanmış `*.myshopify.com` hostlarına yapılır.
 */
export const SHOPIFY_API_VERSION = "2025-07";
export const SHOPIFY_SCOPES = ["read_products", "read_inventory", "read_orders"] as const;

export class ShopifyAuthError extends Error {}
export class ShopifyApiError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly code: string) {
    super(message);
  }
}

const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

/** Kullanıcı girdisini `magaza.myshopify.com` biçimine normalize eder; başka host kabul edilmez. */
export function normalizeShopDomain(input: string): string | null {
  const v = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const shop = v.includes(".") ? v : `${v}.myshopify.com`;
  return SHOP_RE.test(shop) ? shop : null;
}

export function buildAuthUrl(input: { shop: string; clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ client_id: input.clientId, scope: SHOPIFY_SCOPES.join(","), redirect_uri: input.redirectUri, state: input.state });
  return `https://${input.shop}/admin/oauth/authorize?${q.toString()}`;
}

/**
 * OAuth callback imzası: `hmac` hariç tüm parametreler anahtar sırasıyla `k=v&…` olarak birleştirilir,
 * HMAC-SHA256(hex, client secret) ile karşılaştırılır.
 */
export function verifyOAuthQuery(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(message).digest("hex");
  return safeEqual(digest, hmac);
}

async function shopifyFetch(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (res.status === 429 && attempt < 3) {
    const wait = Math.min(10, Number(res.headers.get("retry-after") ?? "2")) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return shopifyFetch(url, init, attempt + 1);
  }
  if (res.status === 401 || res.status === 403) throw new ShopifyAuthError(`Shopify yetkisi reddedildi (${res.status})`);
  if (!res.ok) throw new ShopifyApiError(`Shopify API hatası (${res.status})`, res.status >= 500 || res.status === 429, `http_${res.status}`);
  return res;
}

export async function exchangeCode(input: { shop: string; code: string; clientId: string; clientSecret: string }): Promise<{ accessToken: string; scope: string }> {
  const res = await shopifyFetch(`https://${input.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: input.clientId, client_secret: input.clientSecret, code: input.code }),
  });
  const json = (await res.json()) as { access_token?: string; scope?: string };
  if (!json.access_token) throw new ShopifyApiError("Erişim anahtarı alınamadı", false, "token_exchange_failed");
  return { accessToken: json.access_token, scope: json.scope ?? "" };
}

export interface ShopifyCredentials {
  shop: string;
  accessToken: string;
}

async function graphql<T>(c: ShopifyCredentials, query: string, variables: Record<string, unknown> = {}, attempt = 0): Promise<T> {
  const res = await shopifyFetch(`https://${c.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shopify-access-token": c.accessToken },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> };
  if (json.errors?.length) {
    if (json.errors.some((e) => e.extensions?.code === "THROTTLED") && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      return graphql(c, query, variables, attempt + 1);
    }
    if (json.errors.some((e) => e.extensions?.code === "ACCESS_DENIED")) throw new ShopifyAuthError("Gerekli Shopify izni yok");
    throw new ShopifyApiError(json.errors.map((e) => e.message).join("; ").slice(0, 300), false, "graphql_error");
  }
  if (!json.data) throw new ShopifyApiError("Boş GraphQL yanıtı", true, "empty_response");
  return json.data;
}

export interface ShopInfo {
  name: string;
  currency: string;
  primaryUrl: string;
  grantedScopes: string[];
}

/** Gerçek bağlantı kontrolü: mağaza bilgisi + verilen kapsamlar. "Bağlı" yalnız bu başarılıysa. */
export async function fetchShopInfo(c: ShopifyCredentials): Promise<ShopInfo> {
  const d = await graphql<{ shop: { name: string; currencyCode: string; primaryDomain: { url: string } }; currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>(
    c,
    `{ shop { name currencyCode primaryDomain { url } } currentAppInstallation { accessScopes { handle } } }`,
  );
  return { name: d.shop.name, currency: d.shop.currencyCode, primaryUrl: d.shop.primaryDomain.url.replace(/\/$/, ""), grantedScopes: d.currentAppInstallation.accessScopes.map((s) => s.handle) };
}

export function missingScopes(granted: string[]): string[] {
  // write_* kapsamı ilgili read_* kapsamını içerir.
  return SHOPIFY_SCOPES.filter((s) => !granted.includes(s) && !granted.includes(s.replace("read_", "write_")));
}

const PRODUCTS_QUERY = `query($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle description onlineStoreUrl
      featuredMedia { preview { image { url } } }
      collections(first: 10) { nodes { title } }
      variants(first: 100) { nodes { id sku price inventoryQuantity availableForSale } }
    }
  }
}`;

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  onlineStoreUrl: string | null;
  featuredMedia: { preview?: { image?: { url: string } | null } | null } | null;
  collections: { nodes: Array<{ title: string }> };
  variants: { nodes: Array<{ id: string; sku: string | null; price: string | null; inventoryQuantity: number | null; availableForSale: boolean }> };
}

export async function fetchProductsPage(c: ShopifyCredentials, shop: ShopInfo, cursor: string | null, toMinor: (v: unknown) => bigint): Promise<SyncPage<NormalizedProduct>> {
  const d = await graphql<{ products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] } }>(c, PRODUCTS_QUERY, { cursor });
  return {
    items: d.products.nodes.map((p) => ({
      externalId: p.id,
      name: p.title,
      description: p.description || null,
      url: p.onlineStoreUrl ?? `${shop.primaryUrl}/products/${p.handle}`,
      imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
      categoryExternalIds: p.collections.nodes.map((x) => x.title),
      variants: p.variants.nodes.map((v) => ({
        externalId: v.id,
        sku: v.sku || null,
        priceMinor: v.price === null ? null : toMinor(v.price),
        currency: v.price === null ? null : shop.currency,
        stock: v.inventoryQuantity,
        available: v.availableForSale,
      })),
    })),
    nextCursor: d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null,
  };
}

/** Siparişler REST sayfalama (Link header page_info); payload webhook ile aynı biçimde normalize edilir. */
export async function fetchOrdersPage(c: ShopifyCredentials, cursor: string | null, normalize: (p: Record<string, unknown>) => NormalizedOrder | null): Promise<SyncPage<NormalizedOrder>> {
  const q = cursor ? `limit=250&page_info=${encodeURIComponent(cursor)}` : "status=any&limit=250";
  const res = await shopifyFetch(`https://${c.shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${q}`, { headers: { "x-shopify-access-token": c.accessToken } });
  const json = (await res.json()) as { orders?: Array<Record<string, unknown>> };
  const next = /<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
  return { items: (json.orders ?? []).map(normalize).filter((o): o is NormalizedOrder => o !== null), nextCursor: next ? decodeURIComponent(next) : null };
}

const WEBHOOK_TOPICS = ["ORDERS_CREATE", "ORDERS_UPDATED", "APP_UNINSTALLED"] as const;

/** Sipariş ve kaldırma webhook'ları. Başarısız kayıt hata olarak döner (sessizce yutulmaz). */
export async function registerWebhooks(c: ShopifyCredentials, callbackUrl: string): Promise<string[]> {
  const failed: string[] = [];
  for (const topic of WEBHOOK_TOPICS) {
    const d = await graphql<{ webhookSubscriptionCreate: { userErrors: Array<{ message: string }> } }>(
      c,
      `mutation($topic: WebhookSubscriptionTopic!, $url: URL!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) { userErrors { message } } }`,
      { topic, url: callbackUrl },
    );
    const errs = d.webhookSubscriptionCreate.userErrors.filter((e) => !/already been taken|already exists/i.test(e.message));
    if (errs.length) failed.push(topic);
  }
  return failed;
}

/** Erişim anahtarını iptal eder (uygulama kaldırılır). */
export async function revokeToken(c: ShopifyCredentials): Promise<void> {
  await shopifyFetch(`https://${c.shop}/admin/api_permissions/current.json`, { method: "DELETE", headers: { "x-shopify-access-token": c.accessToken } });
}
