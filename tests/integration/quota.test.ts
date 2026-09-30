import { describe, expect, it } from "vitest";
import { commit, release, releaseExpired, reserve } from "@/modules/billing/quota";
import { db, makeTenant } from "./helpers";

describe("kota reserve/commit/release", () => {
  it("eşzamanlı rezervasyonlar limiti aşamaz", async () => {
    const { ws } = await makeTenant();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => reserve(db, { workspaceId: ws.id, metric: "answer_units", period: "p1", limit: 50, amount: 10, operationId: `op-c-${ws.id}-${i}` })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const b = await db.usageBucket.findFirstOrThrow({ where: { workspaceId: ws.id } });
    expect(b.reserved).toBe(50);
  });

  it("aynı operationId ile retry çift borçlandırmaz", async () => {
    const { ws } = await makeTenant();
    const op = `op-r-${ws.id}`;
    const [a, b] = await Promise.all([
      reserve(db, { workspaceId: ws.id, metric: "answer_units", period: "p1", limit: 100, amount: 20, operationId: op }),
      reserve(db, { workspaceId: ws.id, metric: "answer_units", period: "p1", limit: 100, amount: 20, operationId: op }),
    ]);
    expect(a.id).toBe(b.id);
    await commit(db, op, 15);
    await commit(db, op, 15); // idempotent
    const bucket = await db.usageBucket.findFirstOrThrow({ where: { workspaceId: ws.id } });
    expect(bucket.used).toBe(15); // başarısız 5 birim tüketilmedi
    expect(bucket.reserved).toBe(0);
  });

  it("release ve süresi dolan lease temizliği", async () => {
    const { ws } = await makeTenant();
    await reserve(db, { workspaceId: ws.id, metric: "answer_units", period: "p1", limit: 100, amount: 30, operationId: `op-x-${ws.id}`, ttlMs: -1000 });
    await reserve(db, { workspaceId: ws.id, metric: "answer_units", period: "p1", limit: 100, amount: 10, operationId: `op-y-${ws.id}` });
    await release(db, `op-y-${ws.id}`);
    expect(await releaseExpired(db)).toBeGreaterThanOrEqual(1);
    const bucket = await db.usageBucket.findFirstOrThrow({ where: { workspaceId: ws.id } });
    expect(bucket.reserved).toBe(0);
    expect(bucket.used).toBe(0);
  });
});
