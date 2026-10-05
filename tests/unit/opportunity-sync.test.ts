import { describe, expect, it } from "vitest";
import { syncOpportunityStatus } from "@/modules/actions/service";

function fakeTx(status: string, activeActions = 0) {
  const state = { status };
  const tx = {
    opportunity: {
      findUnique: async () => ({ status: state.status }),
      update: async ({ data }: { data: { status: string } }) => ((state.status = data.status), state),
    },
    action: { count: async () => activeActions },
  };
  return { tx: tx as never, state };
}

describe("fırsat durumu aksiyonu izler", () => {
  it("uygulandı (measuring) → fırsat ölçülüyor", async () => {
    const { tx, state } = fakeTx("new");
    await syncOpportunityStatus(tx, "o1", "measuring");
    expect(state.status).toBe("measuring");
  });
  it("kazanıldı/kapatıldı kararları ezilmez", async () => {
    for (const s of ["won", "dismissed"]) {
      const { tx, state } = fakeTx(s);
      await syncOpportunityStatus(tx, "o1", "measuring");
      expect(state.status).toBe(s);
    }
  });
  it("reddedilen tek aksiyondan sonra fırsat değerlendirildi'ye döner; başka etkin aksiyon varsa kalır", async () => {
    const a = fakeTx("in_progress", 0);
    await syncOpportunityStatus(a.tx, "o1", "rejected");
    expect(a.state.status).toBe("triaged");
    const b = fakeTx("in_progress", 1);
    await syncOpportunityStatus(b.tx, "o1", "rejected");
    expect(b.state.status).toBe("in_progress");
  });
});
