/**
 * CommerceAdapter sözleşmesi (§7.1). Her platform ayrı adapter; public API/partner erişimi
 * ve gerçek mağaza testi olmadan "connected"/"tam destek" gösterilmez.
 */
export type CommerceCapability = "catalogRead" | "ordersRead" | "eventsRead" | "contentWrite" | "refundsRead" | "oauth";

export type ConnectorState = "not_configured" | "connecting" | "syncing" | "healthy" | "degraded" | "reauth_required" | "unsupported";

export interface NormalizedProduct {
  externalId: string;
  name: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  categoryExternalIds: string[];
  variants: Array<{ externalId: string; sku: string | null; priceMinor: bigint | null; currency: string | null; stock: number | null; available: boolean | null }>;
}

export interface NormalizedOrder {
  externalOrderId: string;
  status: "pending" | "paid" | "canceled" | "refunded" | "partially_refunded";
  paidAt: Date | null;
  currency: string;
  items: Array<{ productExternalId: string | null; variantExternalId: string | null; name: string | null; quantity: number; unitPriceMinor: bigint; discountMinor: bigint }>;
  discountMinor: bigint;
  taxMinor: bigint;
  shippingMinor: bigint;
  refunds: Array<{ externalId: string; amountMinor: bigint; refundedAt: Date }>;
  anonymousId: string | null;
  sessionRef: string | null;
  updatedAt: Date;
}

export interface SyncPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CommerceAdapter {
  provider: string;
  label: string;
  capabilities(): CommerceCapability[];
  /** Platform uygulama anahtarları yapılandırılmış mı / resmi erişim doğrulandı mı. */
  availability(): { state: "available" | "not_configured" | "unsupported"; reason: string | null };
  connect(input: { shopDomain: string; redirectUri: string; state: string }): Promise<{ authUrl?: string; requiresManualSetup?: boolean }>;
  validate(credentials: Record<string, string>): Promise<{ ok: boolean; reason?: string }>;
  syncCatalog(credentials: Record<string, string>, cursor: string | null): Promise<SyncPage<NormalizedProduct>>;
  syncOrders(credentials: Record<string, string>, cursor: string | null): Promise<SyncPage<NormalizedOrder>>;
  verifyWebhook(raw: string, headers: Record<string, string>, secret: string): boolean;
  normalizeEvent(payload: unknown): NormalizedOrder | null;
  publishPatch(credentials: Record<string, string>, patch: { resourceRef: string; fields: Record<string, unknown>; expectedHash: string }): Promise<{ newHash: string; backup: unknown }>;
  rollback(credentials: Record<string, string>, input: { resourceRef: string; backup: unknown; expectedHash: string }): Promise<void>;
  disconnect(credentials: Record<string, string>): Promise<void>;
}

export class ConnectorUnavailableError extends Error {
  constructor(public readonly provider: string, public readonly reason: string) {
    super(reason);
  }
}
