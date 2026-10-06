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
