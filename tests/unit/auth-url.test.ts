import { describe, expect, it } from "vitest";
import { canonicalLoginUrl } from "@/lib/auth-url";

describe("giriş bağlantısı canlı alan adına yönlenir", () => {
  const app = "https://geocommerce-two.vercel.app";
  it("deploy'a özel Vercel adresini APP_URL ile değiştirir (callbackUrl dahil)", () => {
    const raw = "https://geocommerce-abc123-team.vercel.app/api/auth/callback/email?callbackUrl=https%3A%2F%2Fgeocommerce-abc123-team.vercel.app%2Fadmin&token=t&email=a%40b.com";
    const u = new URL(canonicalLoginUrl(raw, app));
    expect(u.origin).toBe(app);
    expect(u.pathname).toBe("/api/auth/callback/email");
    expect(u.searchParams.get("token")).toBe("t");
    expect(u.searchParams.get("callbackUrl")).toBe(`${app}/admin`);
  });
  it("APP_URL localhost ise dokunmaz", () => {
    const raw = "https://x.vercel.app/api/auth/callback/email?token=t";
    expect(canonicalLoginUrl(raw, "http://localhost:3000")).toBe(raw);
  });
});
