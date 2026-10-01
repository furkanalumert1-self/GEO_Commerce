import { describe, expect, it } from "vitest";
import { approveAction, publishAction, saveActionVersion, transitionAction } from "@/modules/actions/service";
import { templateDraft } from "@/modules/actions/generator";
import { versionHash } from "@/modules/actions/workflow";
import { resolveBrandAccess } from "@/modules/tenancy/access";
import { upsertOrder, attributeOrders } from "@/modules/commerce/service";
import { applyBillingEvent, recordInbox } from "@/modules/billing/service";
import { createRun, executeRun } from "@/modules/monitoring/service";
import { createFixtureAdapter } from "@/adapters/ai/fixture";
import { ProviderError, type AiMonitorAdapter, type EngineKey } from "@/adapters/ai/types";
import { enqueue } from "@/lib/queue";
import { runJob } from "@/workers/runner";
import { handlers, NonRetryableError } from "@/workers/handlers";
import { db, makeTenant } from "./helpers";

const draftInput = { type: "faq" as const, language: "tr", brand: { name: "B", domain: "b.example" }, opportunity: { title: "t", recommendedAction: null, clusterLabel: "c", gapType: "intent_content" }, evidence: [], targetUrl: null, allowedClaims: [] };
const content = templateDraft({ ...draftInput, catalog: [{ name: "Serum", url: null, priceMinor: 19900n, currency: "TRY", available: true }] });
// Katalog boş/fiyatsız → görünür içerikte doldurulmamış yer tutucu (zorunlu eksik).
const incomplete = templateDraft({ ...draftInput, catalog: [{ name: "Serum", url: null, priceMinor: null, currency: null, available: true }] });

describe("aksiyon onayı", () => {
  it("onaydan önce içerik değişirse 409; düzenleme onayı düşürür", async () => {
    const t = await makeTenant("growth");
    const access = await resolveBrandAccess(db, { kind: "user", userId: t.user.id }, t.ws.id, t.brand.id);
    const a = await db.action.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, type: "faq", title: "x", version: 1 } });
    const v1 = await db.actionVersion.create({ data: { workspaceId: t.ws.id, actionId: a.id, number: 1, content: content as object, contentHash: versionHash(content) } });
    await db.action.update({ where: { id: a.id }, data: { currentVersionId: v1.id } });
    await saveActionVersion(db, access, { actionId: a.id, expectedVersion: 1, content: { ...content, title: "yeni" }, userId: t.user.id });
    await expect(approveAction(db, access, { actionId: a.id, versionId: v1.id, expectedHash: v1.contentHash, userId: t.user.id })).rejects.toMatchObject({ code: "conflict" });
    await expect(saveActionVersion(db, access, { actionId: a.id, expectedVersion: 1, content, userId: t.user.id })).rejects.toMatchObject({ code: "conflict" });
    const cur = await db.action.findUniqueOrThrow({ where: { id: a.id }, include: { versions: { orderBy: { number: "desc" }, take: 1 } } });
    const ok = await approveAction(db, access, { actionId: a.id, versionId: cur.currentVersionId!, expectedHash: cur.versions[0]!.contentHash, userId: t.user.id });
    expect(ok.status).toBe("approved");
    await saveActionVersion(db, access, { actionId: a.id, expectedVersion: ok.version, content: { ...content, title: "sonra" }, userId: t.user.id });
    expect(await db.approval.count({ where: { actionId: a.id, revokedAt: null } })).toBe(0);
  });
});

describe("zorunlu eksik", () => {
  it("yer tutuculu sürüm onaylanamaz; eski onaylı eksikli kayıt uygulanamaz ve sessizce değiştirilmez", async () => {
    const t = await makeTenant("commerce");
    const access = await resolveBrandAccess(db, { kind: "user", userId: t.user.id }, t.ws.id, t.brand.id);
    const a = await db.action.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, type: "faq", title: "x", version: 1 } });
    const v = await db.actionVersion.create({ data: { workspaceId: t.ws.id, actionId: a.id, number: 1, content: incomplete as object, contentHash: versionHash(incomplete) } });
    await db.action.update({ where: { id: a.id }, data: { currentVersionId: v.id } });
    await expect(approveAction(db, access, { actionId: a.id, versionId: v.id, expectedHash: v.contentHash, userId: t.user.id })).rejects.toMatchObject({ code: "validation_error" });
    // Eski veri: eksikli içerik onaylanmış halde.
    await db.action.update({ where: { id: a.id }, data: { status: "approved" } });
    await db.approval.create({ data: { workspaceId: t.ws.id, actionId: a.id, versionId: v.id, versionHash: v.contentHash, approverId: t.user.id } });
    await expect(transitionAction(db, access, a.id, "measuring", t.user.id)).rejects.toMatchObject({ code: "validation_error" });
    await expect(publishAction(db, access, a.id)).rejects.toMatchObject({ code: "validation_error" });
    const after = await db.action.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.status).toBe("approved");
    expect(await db.approval.count({ where: { actionId: a.id, revokedAt: null } })).toBe(1);
  });
});

describe("commerce", () => {
  it("replay tekrar sipariş oluşturmaz; eski sürüm yeniyi ezmez; iade net'i restate eder", async () => {
    const t = await makeTenant();
    const integ = await db.integration.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, provider: "csv_feed", storeId: "m", capabilities: {}, scopes: [] } });
    const ids = { workspaceId: t.ws.id, brandId: t.brand.id, connectorId: integ.id };
    const base = { externalOrderId: "O1", status: "paid" as const, paidAt: new Date("2026-09-10T10:00:00Z"), currency: "TRY", items: [{ productExternalId: "p", variantExternalId: "p", name: "p", quantity: 2, unitPriceMinor: 5000n, discountMinor: 0n }], discountMinor: 0n, taxMinor: 1800n, shippingMinor: 3000n, refunds: [], anonymousId: "anon1", sessionRef: null, updatedAt: new Date("2026-09-10T10:00:00Z") };
    await upsertOrder(db, ids, base);
    await upsertOrder(db, ids, base);
    expect(await db.order.count({ where: { brandId: t.brand.id } })).toBe(1);
    expect((await db.order.findFirstOrThrow({ where: { brandId: t.brand.id } })).netMinor).toBe(10000n);
    const refunded = { ...base, status: "partially_refunded" as const, refunds: [{ externalId: "R1", amountMinor: 5000n, refundedAt: new Date("2026-09-12T00:00:00Z") }], updatedAt: new Date("2026-09-12T00:00:00Z") };
    await upsertOrder(db, ids, refunded);
    const stale = await upsertOrder(db, ids, { ...base, updatedAt: new Date("2026-09-11T00:00:00Z") });
    expect(stale.applied).toBe(false);
    expect((await db.order.findFirstOrThrow({ where: { brandId: t.brand.id } })).netMinor).toBe(5000n);
    const sess = await db.visitorSession.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, anonymousId: "anon1", externalSessionId: "s1", startedAt: new Date("2026-09-09T00:00:00Z"), lastSeenAt: new Date("2026-09-09T00:00:00Z"), consent: { analytics: true, ads: false } } });
    await db.touchpoint.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, sessionId: sess.id, anonymousId: "anon1", occurredAt: new Date("2026-09-09T00:00:00Z"), channel: "ai_organic:chatgpt" } });
    await attributeOrders(db, t.ws.id, t.brand.id);
    await attributeOrders(db, t.ws.id, t.brand.id);
    const attr = await db.attribution.findMany({ where: { order: { brandId: t.brand.id } } });
    expect(attr).toHaveLength(2); // model başına tek satır
    expect(attr.every((a) => a.channel === "ai_organic:chatgpt" && a.netMinor === 5000n)).toBe(true);
  });
});

describe("billing webhook", () => {
  it("replay dedupe ve out-of-order koruması", async () => {
    const t = await makeTenant("starter");
    const sub = (status: string, planKey: "growth" | "starter", at: string) => ({ id: `evt-${at}-${t.ws.id}`, type: "customer.subscription.updated", createdAt: new Date(at), subscription: { id: `sub-${t.ws.id}`, customerId: "cus", workspaceId: t.ws.id, planKey, status, periodStart: new Date(at), periodEnd: new Date("2026-12-01"), cancelAtPeriodEnd: false, trialEnd: null } });
    const e1 = sub("active", "growth", "2026-09-20T00:00:00Z");
    expect((await recordInbox(db, "stripe", e1.id, "raw", {})).duplicate).toBe(false);
    expect(await applyBillingEvent(db, e1)).toBe("applied");
    await db.inboxEvent.updateMany({ where: { providerEventId: e1.id }, data: { processedAt: new Date() } });
    expect((await recordInbox(db, "stripe", e1.id, "raw", {})).duplicate).toBe(true);
    expect(await applyBillingEvent(db, sub("past_due", "starter", "2026-09-10T00:00:00Z"))).toBe("stale");
    const s = await db.subscription.findUniqueOrThrow({ where: { workspaceId: t.ws.id } });
    expect([s.planKey, s.status]).toEqual(["growth", "active"]);
    expect(await applyBillingEvent(db, sub("past_due", "growth", "2026-09-25T00:00:00Z"))).toBe("applied");
    expect((await db.subscription.findUniqueOrThrow({ where: { workspaceId: t.ws.id } })).pastDueSince).not.toBeNull();
  });
});

describe("ölçüm ve job'lar", () => {
  it("aynı fixture aynı skoru üretir; başarısızlar coverage'ı düşürür ama kota tüketmez", async () => {
    const t = await makeTenant();
    const cluster = await db.intentCluster.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, type: "category_discovery", label: "c", locale: "tr-TR" } });
    const p = await db.prompt.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, clusterId: cluster.id } });
    const v = await db.promptVersion.create({ data: { workspaceId: t.ws.id, promptId: p.id, version: 1, text: "Hassas cilt için en iyi nemlendirici?", normalizedHash: "h", commercialScore: 50, commercialRubric: {} } });
    const failing: AiMonitorAdapter = { ...createFixtureAdapter("gemini"), ask: async () => { throw new ProviderError("down", false, undefined, "http_401"); } };
    const adapters = { chatgpt: createFixtureAdapter("chatgpt"), gemini: failing } as unknown as Record<EngineKey, AiMonitorAdapter>;
    const plan = { promptVersionIds: [v.id], engines: ["chatgpt", "gemini"] as EngineKey[], locales: ["tr-TR"], repetitions: 2 };
    const scores: unknown[] = [];
    for (const i of [1, 2]) {
      const run = await createRun(db, { workspaceId: t.ws.id, brandId: t.brand.id, plan, trigger: "test", operationId: `run-${t.ws.id}-${i}` });
      const res = await executeRun(db, run.id, plan, adapters, { maxAttempts: 1 });
      expect(res.status).toBe("partial");
      expect(res.coverage).toBe(0.5);
      scores.push((await db.metricSnapshot.findFirstOrThrow({ where: { brandId: t.brand.id, engine: "chatgpt", numerator: { path: ["runId"], equals: run.id } } })).values);
    }
    expect(scores[0]).toEqual(scores[1]);
    expect(await db.costLedger.count({ where: { workspaceId: t.ws.id, succeeded: false } })).toBe(4);
  });

  it("non-retryable hata DLQ'ya düşer; geçici hata yeniden denenir", async () => {
    handlers.test_fail_hard = async () => { throw new NonRetryableError("auth"); };
    let n = 0;
    handlers.test_flaky = async () => { if (++n < 2) throw new Error("temp"); };
    const hard = await enqueue(db, { type: "test_fail_hard" as never, operationId: `hard-${Date.now()}`, payload: {} });
    expect(await runJob(db, hard.id)).toBe("dead");
    expect((await db.jobRecord.findUniqueOrThrow({ where: { id: hard.id } })).deadReason).toBe("non_retryable");
    const flaky = await enqueue(db, { type: "test_flaky" as never, operationId: `flaky-${Date.now()}`, payload: {} });
    expect(await runJob(db, flaky.id)).toBe("retry");
    expect(await runJob(db, flaky.id)).toBe("succeeded");
  });
});
