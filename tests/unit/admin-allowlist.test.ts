import { describe, expect, it } from "vitest";
import { parseConfig } from "@/lib/config";

describe("PLATFORM_ADMIN_ALLOWLIST ayrıştırma", () => {
  it("tırnak, büyük harf, noktalı virgül ve boşlukları tolere eder", () => {
    const cfg = parseConfig({ DATABASE_URL: "x", PLATFORM_ADMIN_ALLOWLIST: '"Furkan@Example.com"; ops@example.com ,  <a@b.co>' });
    expect(cfg.platformAdmins).toEqual(["furkan@example.com", "ops@example.com", "a@b.co"]);
  });
  it("boşsa liste boştur", () => {
    expect(parseConfig({ DATABASE_URL: "x" }).platformAdmins).toEqual([]);
  });
});
