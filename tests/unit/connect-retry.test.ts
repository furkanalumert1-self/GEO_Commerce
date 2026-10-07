import { describe, expect, it } from "vitest";
import { connectWithRetry, isTransientConnectError } from "@/lib/db/connect-retry";

const noSleep = async () => undefined;

describe("veritabanı bağlantı yeniden denemesi", () => {
  it("pooler istemci sınırı dolu hatasında bekleyip yeniden dener", async () => {
    let calls = 0;
    const out = await connectWithRetry(async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15"), { code: "XX000" });
      return "client";
    }, { sleep: noSleep });
    expect(out).toBe("client");
    expect(calls).toBe(3);
  });

  it("geçici olmayan hatayı (ör. yanlış şifre) hemen iletir; deneme sayısı sınırlıdır", async () => {
    let calls = 0;
    await expect(connectWithRetry(async () => { calls++; throw Object.assign(new Error("password authentication failed"), { code: "28P01" }); }, { sleep: noSleep })).rejects.toThrow("password");
    expect(calls).toBe(1);
    calls = 0;
    await expect(connectWithRetry(async () => { calls++; throw Object.assign(new Error("sorry, too many clients already"), { code: "53300" }); }, { sleep: noSleep, attempts: 4 })).rejects.toThrow("too many");
    expect(calls).toBe(4);
  });

  it("geçici bağlantı hatalarını tanır", () => {
    expect(isTransientConnectError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isTransientConnectError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isTransientConnectError(new Error("duplicate key value violates unique constraint"))).toBe(false);
  });
});
