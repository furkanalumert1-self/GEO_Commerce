import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAuthUrl, missingScopes, normalizeShopDomain, verifyOAuthQuery } from "@/adapters/commerce/shopify";

describe("Shopify OAuth yardımcıları", () => {
  it("yalnız myshopify.com hostlarını kabul eder", () => {
    expect(normalizeShopDomain("https://Magaza-1.myshopify.com/admin")).toBe("magaza-1.myshopify.com");
    expect(normalizeShopDomain("magaza")).toBe("magaza.myshopify.com");
    expect(normalizeShopDomain("evil.com")).toBeNull();
    expect(normalizeShopDomain("x.myshopify.com.evil.com")).toBeNull();
    expect(normalizeShopDomain("127.0.0.1")).toBeNull();
  });

  it("callback HMAC doğrulaması", () => {
    const secret = "shh";
    const base = new URLSearchParams({ code: "abc", shop: "m.myshopify.com", state: "id.nonce", timestamp: "1700000000" });
    const msg = [...base.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    const ok = new URLSearchParams(base);
    ok.set("hmac", createHmac("sha256", secret).update(msg).digest("hex"));
    expect(verifyOAuthQuery(ok, secret)).toBe(true);
    const tampered = new URLSearchParams(ok);
    tampered.set("shop", "other.myshopify.com");
    expect(verifyOAuthQuery(tampered, secret)).toBe(false);
    expect(verifyOAuthQuery(base, secret)).toBe(false);
  });

  it("yetkilendirme adresi yalnız okuma kapsamı ister ve state taşır", () => {
    const u = new URL(buildAuthUrl({ shop: "m.myshopify.com", clientId: "cid", redirectUri: "https://app.example/cb", state: "s1" }));
    expect(u.host).toBe("m.myshopify.com");
    expect(u.searchParams.get("scope")).toBe("read_products,read_inventory,read_orders");
    expect(u.searchParams.get("state")).toBe("s1");
  });

  it("eksik kapsam tespiti (write_* read'i kapsar)", () => {
    expect(missingScopes(["read_products", "write_inventory", "read_orders"])).toEqual([]);
    expect(missingScopes(["read_products"])).toEqual(["read_inventory", "read_orders"]);
  });
});
