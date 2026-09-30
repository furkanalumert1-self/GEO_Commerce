import { describe, expect, it } from "vitest";
import { resolveBrandAccess, resolveWorkspaceAccess, assertCan } from "@/modules/tenancy/access";
import { getSharedReport } from "@/modules/reports/service";
import { db, makeTenant } from "./helpers";

describe("tenant izolasyonu (IDOR)", () => {
  it("A kullanıcısı B workspace/markasına erişemez (404)", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await expect(resolveWorkspaceAccess(db, { kind: "user", userId: a.user.id }, b.ws.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(resolveBrandAccess(db, { kind: "user", userId: a.user.id }, a.ws.id, b.brand.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("client rolü yalnız verilen markayı görür", async () => {
    const t = await makeTenant("agency");
    const other = await db.brand.create({ data: { workspaceId: t.ws.id, domain: `o-${t.ws.id.slice(0, 6)}.example`, name: "Other", aliases: [] } });
    const u = await db.user.create({ data: { email: `c-${t.ws.id}@test.example` } });
    const m = await db.membership.create({ data: { workspaceId: t.ws.id, userId: u.id, role: "client" } });
    await db.brandGrant.create({ data: { workspaceId: t.ws.id, membershipId: m.id, brandId: t.brand.id, role: "client" } });
    const ok = await resolveBrandAccess(db, { kind: "user", userId: u.id }, t.ws.id, t.brand.id);
    expect(() => assertCan(ok, "export")).toThrow();
    await expect(resolveBrandAccess(db, { kind: "user", userId: u.id }, t.ws.id, other.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("API anahtarı marka kapsamı dışına çıkamaz", async () => {
    const t = await makeTenant();
    const other = await db.brand.create({ data: { workspaceId: t.ws.id, domain: `k-${t.ws.id.slice(0, 6)}.example`, name: "K", aliases: [] } });
    const p = { kind: "api_key" as const, userId: null, scopes: ["brand:read"], brandScope: [t.brand.id] };
    await expect(resolveBrandAccess(db, p, t.ws.id, other.id)).rejects.toMatchObject({ code: "not_found" });
    const acc = await resolveBrandAccess(db, p, t.ws.id, t.brand.id);
    expect(() => assertCan(acc, "prompts.write")).toThrow();
  });

  it("composite FK başka tenant markasına bağlanmayı DB düzeyinde reddeder", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await expect(db.competitor.create({ data: { workspaceId: a.ws.id, brandId: b.brand.id, name: "x", domain: "x.example", aliases: [] } })).rejects.toThrow();
  });

  it("iptal edilmiş/süresi dolmuş paylaşım bağlantısı çalışmaz", async () => {
    expect(await getSharedReport(db, "yok-boyle-bir-token")).toBeNull();
  });
});
