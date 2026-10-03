import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ordersFromCsv } from "@/adapters/commerce/csv";

describe("örnek sipariş CSV'si", () => {
  it("6 satırdan 5 sipariş, kalemler ve iadeler doğru okunur", () => {
    const text = readFileSync("docs/samples/siparis-ornek.csv", "utf8");
    const fields = ["orderId", "currency", "paidAt", "status", "productId", "sku", "itemName", "quantity", "unitPrice", "refundId", "refundAmount", "refundedAt", "anonymousId"];
    const orders = ordersFromCsv(text, Object.fromEntries(fields.map((f) => [f, f])) as never);
    expect(orders).toHaveLength(5);
    expect(orders.find((o) => o.externalOrderId === "TEST-1002")!.items).toHaveLength(2);
    expect(orders.find((o) => o.externalOrderId === "TEST-1003")!.refunds[0]!.amountMinor).toBe(899900n);
  });
});
