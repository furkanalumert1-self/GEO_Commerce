import { describe, expect, it } from "vitest";
import { singleBrandTarget } from "@/modules/tenancy/landing";

describe("giriş sonrası varış", () => {
  it("tek yetkili marka → doğrudan Genel Bakış", () => {
    expect(singleBrandTarget([{ id: "w1", brands: [{ id: "b1" }] }])).toBe("/w/w1/b/b1/dashboard");
  });
  it("çok marka veya çok workspace → liste", () => {
    expect(singleBrandTarget([{ id: "w1", brands: [{ id: "b1" }, { id: "b2" }] }])).toBeNull();
    expect(singleBrandTarget([{ id: "w1", brands: [{ id: "b1" }] }, { id: "w2", brands: [{ id: "b2" }] }])).toBeNull();
    expect(singleBrandTarget([{ id: "w1", brands: [] }])).toBeNull();
  });
});
