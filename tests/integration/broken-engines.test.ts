import { describe, expect, it } from "vitest";
import { hashToken, randomToken } from "@/lib/crypto";
import { recentlyBrokenEngines } from "@/modules/monitoring/start";
import { db } from "./helpers";

const audit = (failedCalls: string[], at: Date) =>
  db.audit.create({ data: { domain: `x-${randomToken(4)}.example`, locale: "tr-TR", tokenHash: hashToken(randomToken(24)), fingerprintHash: randomToken(8), expiresAt: new Date(Date.now() + 86_400_000), status: "partial", resultSummary: { scopeEngines: ["chatgpt", "copilot"], failedCalls }, updatedAt: at } });

describe("kredisi biten platform", () => {
  it("son ücretsiz ölçümlerde kalıcı hata veren platform dışarıda kalır; 24 saat sonra yeniden denenir; başarı gelince geri döner", async () => {
    const now = Date.now();
    await audit(["copilot:insufficient_quota"], new Date(now - 60_000));
    await audit(["copilot:insufficient_quota"], new Date(now - 30_000));
    expect(await recentlyBrokenEngines(db, ["copilot"], now)).toEqual(["copilot"]);
    // Son hata 24 saatten eskiyse bir kez denenir (sağlayıcı düzelmiş olabilir).
    expect(await recentlyBrokenEngines(db, ["copilot"], now + 25 * 3600_000)).toEqual([]);
    // Geçici hata kalıcı sayılmaz; başarılı ölçüm platformu geri getirir.
    await audit([], new Date(now - 1_000));
    expect(await recentlyBrokenEngines(db, ["copilot"], now)).toEqual([]);
  });
});

describe("yönetici sağlayıcı kontrolü", () => {
  it("başarılı kontrol, kredi yüklendikten sonra platformu 24 saat beklemeden geri getirir", async () => {
    const now = Date.now();
    const failing = (at: Date) =>
      db.audit.create({ data: { domain: `p-${randomToken(4)}.example`, locale: "tr-TR", tokenHash: hashToken(randomToken(24)), fingerprintHash: randomToken(8), expiresAt: new Date(now + 86_400_000), status: "partial", resultSummary: { scopeEngines: ["perplexity"], failedCalls: ["perplexity:insufficient_quota"] }, updatedAt: at } });
    await failing(new Date(now - 120_000));
    await failing(new Date(now - 90_000));
    expect(await recentlyBrokenEngines(db, ["perplexity"], now)).toEqual(["perplexity"]);
    await db.costLedger.create({ data: { workspaceId: null, provider: "perplexity", operation: "check", attemptId: `check:perplexity:${randomToken(6)}`, costMicros: 0n, succeeded: true, createdAt: new Date(now - 30_000) } });
    expect(await recentlyBrokenEngines(db, ["perplexity"], now)).toEqual([]);
  });
});
