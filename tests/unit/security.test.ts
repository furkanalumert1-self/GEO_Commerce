import { describe, expect, it } from "vitest";
import { assertPublicUrl, isBlockedIp } from "@/lib/http/safe-fetch";
import { createSecretBox, hmacSha256, randomToken, stableStringify } from "@/lib/crypto";
import { redact, stripQuery } from "@/lib/observability/log";
import { parseConfig } from "@/lib/config";
import { can } from "@/lib/permissions";

describe("SSRF", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", "ff02::1"])("%s engellenir", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])("%s public", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
  it("şema, port, kimlik bilgisi ve localhost reddi", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("http://example.com:8080/")).rejects.toThrow();
    await expect(assertPublicUrl("http://user:pw@example.com/")).rejects.toThrow();
    await expect(assertPublicUrl("http://localhost/")).rejects.toThrow();
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow();
  });
  it("DNS iç ağa çözümlenirse (rebinding) reddedilir", async () => {
    await expect(assertPublicUrl("https://evil.example/", { resolver: async () => ["93.184.216.34", "10.0.0.5"] })).rejects.toThrow();
    await expect(assertPublicUrl("https://ok.example/", { resolver: async () => ["93.184.216.34"] })).resolves.toMatchObject({ address: "93.184.216.34" });
  });
  it("IPv6 literal metadata reddi", async () => {
    await expect(assertPublicUrl("http://[::ffff:a9fe:a9fe]/latest/meta-data")).rejects.toThrow();
  });
});

describe("crypto", () => {
  it("AES-GCM sır kutusu tur atar ve kurcalamayı reddeder", () => {
    const box = createSecretBox("k1", Buffer.alloc(32, 7).toString("base64"));
    const sealed = box.encrypt("s3cret");
    expect(box.decrypt(sealed)).toBe("s3cret");
    expect(() => box.decrypt(sealed.slice(0, -2) + "AA")).toThrow();
    expect(() => createSecretBox("k2", Buffer.alloc(32, 7).toString("base64")).decrypt(sealed)).toThrow();
  });
  it("token tahmin edilemez uzunlukta", () => {
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
    expect(randomToken()).not.toBe(randomToken());
  });
  it("stableStringify anahtar sırasından bağımsız", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(hmacSha256("k", "x")).toHaveLength(64);
  });
});

describe("log redaksiyonu", () => {
  it("sır/PII ve query string", () => {
    const r = redact({ apiKey: "x", email: "a@b.c", nested: { authorization: "Bearer y" }, url: "https://x/y?token=z" }) as Record<string, unknown>;
    expect(r.apiKey).toBe("[redacted]");
    expect(r.email).toBe("[redacted]");
    expect((r.nested as Record<string, unknown>).authorization).toBe("[redacted]");
    expect(r.url).toBe("https://x/y?[redacted]");
    expect(stripQuery("/a")).toBe("/a");
  });
});

describe("config", () => {
  it("prod'da demo + canlı anahtar birlikte fail", () => {
    expect(() => parseConfig({ NODE_ENV: "production", DATABASE_URL: "x", AUTH_SECRET: "s", SECRETS_ENCRYPTION_KEY: "ab".repeat(32), DEMO_MODE: "true", OPENAI_API_KEY: "sk" })).toThrow();
    expect(() => parseConfig({ NODE_ENV: "production", DATABASE_URL: "x", AUTH_SECRET: "s", SECRETS_ENCRYPTION_KEY: "ab".repeat(32), DEMO_MODE: "true" })).not.toThrow();
  });
  it("boş string tanımsız sayılır", () => {
    expect(parseConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "" }).OPENAI_API_KEY).toBeUndefined();
  });
});

describe("RBAC", () => {
  it("editor publish için ayrıca approver grant ister", () => {
    expect(can({ role: "editor", isApprover: false }, "actions.publish")).toBe(false);
    expect(can({ role: "editor", isApprover: true }, "actions.publish")).toBe(true);
  });
  it("admin workspace silemez; analyst içerik yazamaz; billing marka okuyamaz", () => {
    expect(can({ role: "admin", isApprover: false }, "workspace.delete")).toBe(false);
    expect(can({ role: "analyst", isApprover: false }, "actions.draft")).toBe(false);
    expect(can({ role: "billing", isApprover: false }, "brand.read")).toBe(false);
    expect(can({ role: "client", isApprover: true }, "actions.approve")).toBe(false);
  });
});

describe("anahtar formatı", () => {
  it("base64 ve hex 32 bayt kabul, diğerleri red", async () => {
    const { decodeKey } = await import("@/lib/crypto");
    expect(decodeKey(Buffer.alloc(32, 1).toString("base64")).length).toBe(32);
    expect(decodeKey("ab".repeat(32)).length).toBe(32);
    expect(() => decodeKey("kisa")).toThrow();
  });
});
