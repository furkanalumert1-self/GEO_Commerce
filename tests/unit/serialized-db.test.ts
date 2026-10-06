import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { serializedDb } from "@/modules/monitoring/service";

describe("paralel ölçümde veritabanı erişimi", () => {
  it("sorgular sırayla çalışır (aynı anda en çok bir bağlantı); hata kuyruğu durdurmaz", async () => {
    let active = 0;
    let peak = 0;
    const query = async (x: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (x === 2) throw new Error("db");
      return x;
    };
    const fake = { observation: { update: query }, $transaction: async (fn: () => Promise<number>) => query(await fn()) } as unknown as PrismaClient;
    const { client } = serializedDb(fake);
    const c = client as unknown as { observation: { update: (x: number) => Promise<number> }; $transaction: (fn: () => Promise<number>) => Promise<number> };
    const results = await Promise.allSettled([c.observation.update(1), c.observation.update(2), c.$transaction(async () => 3), c.observation.update(4)]);
    expect(peak).toBe(1);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled"]);
  });
});

describe("müşteriye gösterilen iş hatası", () => {
  it("veritabanı/altyapı ayrıntısı gösterilmez; kullanıcı hatası olduğu gibi kalır", async () => {
    const { customerJobError } = await import("@/lib/queue");
    const raw = "Invalid `prisma.observation.create()` invocation: Database error. Code: `XX000`. Message: `(EMAXCONNSESSION) max clients reached in session mode`";
    expect(customerJobError(raw)).toMatch(/^Geçici bir sunucu sorunu/);
    expect(customerJobError(raw)).not.toMatch(/prisma|EMAXCONN|XX000/);
    expect(customerJobError("Katalogda ürün yok")).toBe("Katalogda ürün yok");
    expect(customerJobError(null)).toBe("Bilinmeyen hata");
  });
});
