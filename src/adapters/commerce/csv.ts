import { ConnectorUnavailableError, type CommerceAdapter, type NormalizedOrder, type NormalizedProduct } from "./types";

/**
 * CSV/feed + imzalı sipariş importu — tüm platformlarda kullanılabilir, açık etiketli fallback.
 */

/** RFC4180 uyumlu basit CSV ayrıştırıcı (tırnak, kaçış, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "129.90" / "129,90" → 12990 minor. Geçersiz → null (sıfır değil). */
export function parseMoneyMinor(v: string | undefined): bigint | null {
  if (v === undefined || v.trim() === "") return null;
  const s = v.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  const neg = s.startsWith("-");
  const abs = BigInt(i!.replace("-", "")) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -abs : abs;
}

export interface ColumnMapping {
  [target: string]: string; // target alan → CSV başlığı
}

export function mapRows(rows: string[][], mapping: ColumnMapping): Array<Record<string, string>> {
  const [header, ...data] = rows;
  if (!header) return [];
  const idx = Object.fromEntries(Object.entries(mapping).map(([t, h]) => [t, header.indexOf(h)]));
  return data.map((r) => Object.fromEntries(Object.entries(idx).filter(([, i]) => i >= 0).map(([t, i]) => [t, (r[i] ?? "").trim()])));
}

export function productsFromCsv(text: string, mapping: ColumnMapping, defaultCurrency: string): NormalizedProduct[] {
  return mapRows(parseCsv(text), mapping)
    .filter((r) => r.externalId && r.name)
    .map((r) => ({
      externalId: r.externalId!,
      name: r.name!,
      description: r.description || null,
      url: r.url || null,
      imageUrl: r.imageUrl || null,
      categoryExternalIds: r.category ? [r.category] : [],
      variants: [
        {
          externalId: r.sku || r.externalId!,
          sku: r.sku || null,
          priceMinor: parseMoneyMinor(r.price),
          currency: r.currency || defaultCurrency,
          stock: r.stock ? Number(r.stock) : null,
          available: r.availability ? /in.?stock|stokta|true|1/i.test(r.availability) : null,
        },
      ],
    }));
}

export function ordersFromCsv(text: string, mapping: ColumnMapping): NormalizedOrder[] {
  const byId = new Map<string, NormalizedOrder>();
  for (const r of mapRows(parseCsv(text), mapping)) {
    if (!r.orderId || !r.currency) continue;
    const o =
      byId.get(r.orderId) ??
      ({
        externalOrderId: r.orderId,
        status: (r.status as NormalizedOrder["status"]) || "paid",
        paidAt: r.paidAt ? new Date(r.paidAt) : null,
        currency: r.currency.toUpperCase(),
        items: [],
        discountMinor: parseMoneyMinor(r.orderDiscount) ?? 0n,
        taxMinor: parseMoneyMinor(r.tax) ?? 0n,
        shippingMinor: parseMoneyMinor(r.shipping) ?? 0n,
        refunds: [],
        anonymousId: r.anonymousId || null,
        sessionRef: r.sessionRef || null,
        updatedAt: new Date(r.updatedAt || r.paidAt || Date.now()),
      } satisfies NormalizedOrder);
    const unit = parseMoneyMinor(r.unitPrice);
    if (unit !== null) {
      o.items.push({ productExternalId: r.productId || null, variantExternalId: r.sku || null, name: r.itemName || null, quantity: Number(r.quantity || 1), unitPriceMinor: unit, discountMinor: parseMoneyMinor(r.itemDiscount) ?? 0n });
    }
    const refund = parseMoneyMinor(r.refundAmount);
    if (refund !== null && r.refundId && !o.refunds.some((x) => x.externalId === r.refundId)) {
      o.refunds.push({ externalId: r.refundId, amountMinor: refund, refundedAt: new Date(r.refundedAt || r.paidAt || Date.now()) });
    }
    byId.set(r.orderId, o);
  }
  return [...byId.values()];
}

const manualOnly = async (): Promise<never> => {
  throw new ConnectorUnavailableError("csv_feed", "CSV/feed bağlantısı yazma desteklemez; export kullanın");
};

export const csvFeedAdapter: CommerceAdapter = {
  provider: "csv_feed",
  label: "CSV / ürün feed'i (manuel import)",
  capabilities: () => ["catalogRead", "ordersRead", "refundsRead"],
  availability: () => ({ state: "available", reason: null }),
  connect: async () => ({ requiresManualSetup: true }),
  validate: async () => ({ ok: true }),
  syncCatalog: async () => ({ items: [], nextCursor: null }),
  syncOrders: async () => ({ items: [], nextCursor: null }),
  verifyWebhook: () => false,
  normalizeEvent: () => null,
  publishPatch: manualOnly,
  rollback: manualOnly,
  disconnect: async () => undefined,
};
