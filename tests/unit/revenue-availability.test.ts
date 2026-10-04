import { describe, expect, it } from "vitest";
import { revenueStateFrom } from "@/modules/commerce/availability";

const csv = { provider: "csv_feed", status: "healthy", lastSyncAt: new Date("2026-10-01T00:00:00Z"), ordersRead: true };
const shop = (status: string) => ({ provider: "shopify", status, lastSyncAt: new Date("2026-10-02T14:10:00Z"), ordersRead: true });

describe("gelir ölçümü kullanılabilirliği", () => {
  it("paket içermiyorsa gösterilmez", () => {
    expect(revenueStateFrom({ inPlan: false, orderCount: 5, integrations: [shop("healthy")] }).state).toBe("not_in_plan");
  });
  it("yalnız ürün dosyası yüklemek gelir ölçümünü etkinleştirmez", () => {
    expect(revenueStateFrom({ inPlan: true, orderCount: 0, integrations: [csv] }).state).toBe("inactive");
    expect(revenueStateFrom({ inPlan: true, orderCount: 0, integrations: [] }).state).toBe("inactive");
  });
  it("bağlı mağaza, dönemde satış olmasa da etkindir (gerçek 0)", () => {
    expect(revenueStateFrom({ inPlan: true, orderCount: 0, integrations: [shop("healthy")] }).state).toBe("active");
    expect(revenueStateFrom({ inPlan: true, orderCount: 3, integrations: [csv] }).state).toBe("active");
  });
  it("geçici hata ayrı durumdur ve son eşitleme korunur", () => {
    const r = revenueStateFrom({ inPlan: true, orderCount: 3, integrations: [shop("degraded")] });
    expect(r.state).toBe("error");
    expect(r.lastSyncAt?.toISOString()).toBe("2026-10-02T14:10:00.000Z");
  });
});
