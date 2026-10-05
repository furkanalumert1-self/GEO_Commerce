import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/http/errors";
import { jobStatus } from "@/lib/queue";
import { runJob } from "@/workers/runner";
import { pendingDraftJob, startActionDraft } from "@/modules/actions/service";
import { resolveBrandAccess } from "@/modules/tenancy/access";
import { db, makeTenant } from "./helpers";

const gen = vi.hoisted(() => ({ fail: false }));
vi.mock("@/modules/actions/generator", async (orig) => {
  const m = await orig<typeof import("@/modules/actions/generator")>();
  return {
    ...m,
    generationStatus: () => "ready",
    generateDraft: async (input: Parameters<typeof m.templateDraft>[0]) => {
      if (gen.fail) throw new AppError("dependency_unavailable", "İçerik üretimi zaman aşımına uğradı; tekrar deneyin", { retryable: true });
      return m.templateDraft(input);
    },
  };
});

async function setup() {
  const t = await makeTenant("growth");
  const access = await resolveBrandAccess(db, { kind: "user", userId: t.user.id }, t.ws.id, t.brand.id);
  const cluster = await db.intentCluster.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, type: "category_discovery", label: "Nevresim", locale: "tr-TR" } });
  const opp = await db.opportunity.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, clusterId: cluster.id, gapType: "intent_content", locale: "tr-TR", title: "Nevresim", components: {}, confidence: 0.5, dedupeKey: `d-${cluster.id}`, targetUrl: "https://b.example/nevresim/" } });
  await db.product.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, externalId: "p1", name: "Pamuk Nevresim", url: "https://b.example/p/1", active: true } });
  return { t, access, opp };
}

describe("Fix with AI arka planda", () => {
  it("istek işi başlatır; iş taslağı oluşturur, sonucu iş durumunda verir, kotayı işler", async () => {
    const { t, access, opp } = await setup();
    const job = await startActionDraft(db, access, { opportunityId: opp.id, type: "content", operationId: `fix:${t.ws.id}:k1` });
    expect(job.status).toBe("queued");
    expect(await db.action.count({ where: { brandId: t.brand.id } })).toBe(0);
    expect((await pendingDraftJob(db, t.brand.id, opp.id))?.id).toBe(job.id);
    // Aynı istek anahtarı ikinci iş açmaz.
    expect((await startActionDraft(db, access, { opportunityId: opp.id, type: "content", operationId: `fix:${t.ws.id}:k1` })).id).toBe(job.id);

    expect(await runJob(db, job.id, "test")).toBe("succeeded");
    const status = await jobStatus(db, job.id, t.ws.id);
    const action = await db.action.findFirstOrThrow({ where: { brandId: t.brand.id } });
    expect(status).toMatchObject({ status: "succeeded", resultId: action.id, error: null });
    expect(action).toMatchObject({ opportunityId: opp.id, status: "draft", targetUrl: "https://b.example/nevresim/" });
    expect(action.currentVersionId).not.toBeNull();
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).status).toBe("in_progress");
    expect(await db.usageReservation.findUniqueOrThrow({ where: { operationId: `fix:${t.ws.id}:k1` } })).toMatchObject({ state: "committed", committed: 1 });
    expect(await pendingDraftJob(db, t.brand.id, opp.id)).toBeNull();
  });

  it("üretim başarısızsa iş tek denemede biter, hata kullanıcıya iletilir ve kota serbest kalır", async () => {
    const { t, access, opp } = await setup();
    gen.fail = true;
    try {
      const job = await startActionDraft(db, access, { opportunityId: opp.id, type: "content", operationId: `fix:${t.ws.id}:k2` });
      expect(await runJob(db, job.id, "test")).toBe("dead");
      expect(await jobStatus(db, job.id, t.ws.id)).toMatchObject({ status: "dead", resultId: null, error: expect.stringContaining("zaman aşımı") });
      expect(await db.action.count({ where: { brandId: t.brand.id } })).toBe(0);
      expect(await db.usageReservation.findUniqueOrThrow({ where: { operationId: `fix:${t.ws.id}:k2` } })).toMatchObject({ state: "released" });
    } finally {
      gen.fail = false;
    }
  });

  it("hedefsiz fırsatta önerilen hedef sayfa fırsata da yazılır", async () => {
    const { t, access, opp } = await setup();
    await db.opportunity.update({ where: { id: opp.id }, data: { targetUrl: null } });
    await db.category.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, externalId: "c1", name: "Nevresim", url: "https://b.example/kategori/nevresim/" } });
    const job = await startActionDraft(db, access, { opportunityId: opp.id, type: "content", operationId: `fix:${t.ws.id}:k4` });
    expect(await runJob(db, job.id, "test")).toBe("succeeded");
    expect((await db.action.findFirstOrThrow({ where: { brandId: t.brand.id } })).targetUrl).toBe("https://b.example/kategori/nevresim/");
    expect((await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).targetUrl).toBe("https://b.example/kategori/nevresim/");
  });

  it("ürün verisi yoksa iş hiç başlatılmaz (hata istek içinde)", async () => {
    const { t, access, opp } = await setup();
    await db.product.updateMany({ where: { brandId: t.brand.id }, data: { active: false } });
    await expect(startActionDraft(db, access, { opportunityId: opp.id, type: "content", operationId: `fix:${t.ws.id}:k3` })).rejects.toMatchObject({ code: "conflict" });
    expect(await db.jobRecord.count({ where: { brandId: t.brand.id, type: "generate_action" } })).toBe(0);
  });
});
