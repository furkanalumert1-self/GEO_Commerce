import { describe, expect, it, vi } from "vitest";

// Bu dosya Redis'siz geçici yürütme modunu doğrular (config modül yüklenirken okunur).
vi.hoisted(() => {
  process.env.JOB_EXECUTION_MODE = "inline";
  process.env.APP_URL = "http://localhost:3000";
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/auth", () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));

import { NextRequest } from "next/server";
import { assertJobsRunnable, enqueue, executionMode } from "@/lib/queue";
import { advanceJob } from "@/lib/queue/advance";
import { runJob } from "@/workers/runner";
import { handlers } from "@/workers/handlers";
import { runAudit, type AuditWork } from "@/modules/audit/service";
import { createRun, executeRun } from "@/modules/monitoring/service";
import { createFixtureAdapter } from "@/adapters/ai/fixture";
import { ProviderError, type AiMonitorAdapter, type EngineKey } from "@/adapters/ai/types";
import type { Fetcher } from "@/modules/audit/crawler";
import { hashToken, randomToken } from "@/lib/crypto";
import { POST as advanceRoute } from "@/app/api/v1/jobs/[id]/advance/route";
import { db, makeTenant } from "./helpers";

const html = (body: string) => `<!doctype html><html><head><title>Mağaza</title><meta property="og:site_name" content="Mağaza"></head><body>${body}</body></html>`;
const siteFetcher: Fetcher = async (url) => {
  const u = new URL(url);
  if (u.pathname === "/robots.txt" || u.pathname.endsWith(".xml")) return { status: 404, body: "", headers: {} as Record<string, string>, url, truncated: false };
  return { status: 200, body: html(`<h1>Mağaza</h1><a href="/kategori/serum">Serum</a>`), headers: { "content-type": "text/html" }, url, truncated: false };
};

function countingAdapter(engine: EngineKey, impl?: (n: number) => Promise<void> | void) {
  const base = createFixtureAdapter(engine);
  let calls = 0;
  const adapter: AiMonitorAdapter = {
    ...base,
    status: () => "ready",
    ask: async (input) => {
      calls++;
      await impl?.(calls);
      // Fixture soru metnine bağlı %4 simüle geçici hata üretir; sayım testleri için bu rastgelelik
      // devre dışı bırakılır (hatalar yalnız `impl` ile açıkça verilir).
      const answer = await base.ask(input).catch(() => base.ask({ ...input, prompt: `${input.prompt} ` }));
      return { ...answer, provider: engine, model: `stub-${engine}` };
    },
  };
  return { adapter, calls: () => calls };
}

async function makeAudit(domain: string) {
  const token = randomToken(24);
  return db.audit.create({ data: { domain, locale: "tr-TR", tokenHash: hashToken(token), fingerprintHash: randomToken(8), expiresAt: new Date(Date.now() + 86_400_000), progressTotal: 5 } });
}

describe("Redis'siz (inline) yürütme", () => {
  it("mod açıkça inline; Redis olmadan iş başlatılabilir ve outbox'a yazılmaz", async () => {
    expect(executionMode()).toBe("inline");
    expect(() => assertJobsRunnable()).not.toThrow();
    const job = await enqueue(db, { type: "audit", operationId: `inline-ob-${Date.now()}`, payload: { auditId: "x" } });
    expect((job.cursor as { execution: string }).execution).toBe("inline");
    expect(await db.outboxEvent.count({ where: { payload: { path: ["jobId"], equals: job.id } } })).toBe(0);
  });

  it("audit adımlarla ilerler; tamamlanan çağrılar tekrarlanmaz, sonuç kalıcıdır", async () => {
    const audit = await makeAudit(`s-${randomToken(4).toLowerCase()}.com`);
    const gpt = countingAdapter("chatgpt");
    const gem = countingAdapter("gemini");
    const adapters = { chatgpt: gpt.adapter, gemini: gem.adapter } as unknown as Record<EngineKey, AiMonitorAdapter>;
    let saved: AuditWork | null = null;
    const store = { load: () => (saved ? (JSON.parse(JSON.stringify(saved)) as AuditWork) : null), save: async (w: AuditWork) => void (saved = JSON.parse(JSON.stringify(w))) };
    // Kısa bütçeli ilk adım: tarama süre sınırında kesilir (kısmi), AI çağrısı başlatılmaz.
    expect(await runAudit(db, audit.id, { fetcher: siteFetcher, adapters }, { ...store, deadline: Date.now() + 100 })).toBe("continue");
    expect(gpt.calls() + gem.calls()).toBe(0);
    expect(saved!.crawl?.pages).toBeGreaterThan(0);
    expect(saved!.crawl?.truncated).toBe(true);
    // Sonraki adımlar: kaldığı yerden devam, sonunda gerçek rapor.
    let steps = 0;
    let r: "done" | "continue" = "continue";
    while (r === "continue" && steps < 20) {
      r = await runAudit(db, audit.id, { fetcher: siteFetcher, adapters }, { ...store, deadline: Date.now() + 5 });
      steps++;
    }
    expect(r).toBe("done");
    expect(gpt.calls()).toBe(5);
    expect(gem.calls()).toBe(5);
    const done = await db.audit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(["succeeded", "partial"]).toContain(done.status);
    expect((done.resultSummary as { visibility: { sampleCount: number } }).visibility.sampleCount).toBe(10);
    // Tamamlanmış audit yeniden çalıştırılınca çağrı yapılmaz.
    await runAudit(db, audit.id, { fetcher: siteFetcher, adapters }, store);
    expect(gpt.calls()).toBe(5);
  });

  it("zaman aşımı/429 bir kez yeniden denenir; kalıcı anahtar hatası tekrar çağrılmaz; kısmi sonuç açıkça ayrılır", async () => {
    const audit = await makeAudit(`p-${randomToken(4).toLowerCase()}.com`);
    const gpt = countingAdapter("chatgpt", async (n) => {
      if (n === 1) throw new ProviderError("Sağlayıcı zaman aşımı", true, undefined, "timeout");
      if (n === 3) throw new ProviderError("Sağlayıcı geçici hata 429", true, undefined, "http_429");
    });
    const gem = countingAdapter("gemini", async () => {
      throw new ProviderError("Sağlayıcı kimlik doğrulama hatası", false, undefined, "auth");
    });
    const adapters = { chatgpt: gpt.adapter, gemini: gem.adapter } as unknown as Record<EngineKey, AiMonitorAdapter>;
    expect(await runAudit(db, audit.id, { fetcher: siteFetcher, adapters })).toBe("done");
    expect(gem.calls()).toBe(1); // kalıcı hata: platform bu audit'te tekrar çağrılmaz
    expect(gpt.calls()).toBe(7); // 5 soru + 2 geçici hata için birer yeniden deneme
    const done = await db.audit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(done.status).toBe("partial");
    const summary = done.resultSummary as { visibility: { sampleCount: number }; failedCalls: string[] };
    expect(summary.visibility.sampleCount).toBe(5);
    expect(summary.failedCalls).toEqual(["gemini:auth"]);
  });

  it("ölçüm adımlarla ilerler; kota bir kez commit edilir; kalıcı hata alan platform tekrar çağrılmaz", async () => {
    const t = await makeTenant();
    const cluster = await db.intentCluster.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, type: "category_discovery", label: "c", locale: "tr-TR" } });
    const versions = [];
    for (const i of [1, 2, 3]) {
      const p = await db.prompt.create({ data: { workspaceId: t.ws.id, brandId: t.brand.id, clusterId: cluster.id } });
      versions.push(await db.promptVersion.create({ data: { workspaceId: t.ws.id, promptId: p.id, version: 1, text: `Soru ${i} için en iyi serum?`, normalizedHash: `h${i}-${t.ws.id}`, commercialScore: 50, commercialRubric: {} } }));
    }
    const gpt = countingAdapter("chatgpt");
    const gem = countingAdapter("gemini", async () => {
      throw new ProviderError("Sağlayıcı kimlik doğrulama hatası", false, undefined, "auth");
    });
    const adapters = { chatgpt: gpt.adapter, gemini: gem.adapter } as unknown as Record<EngineKey, AiMonitorAdapter>;
    const plan = { promptVersionIds: versions.map((v) => v.id), engines: ["chatgpt", "gemini"] as EngineKey[], locales: ["tr-TR"], repetitions: 1 };
    const run = await createRun(db, { workspaceId: t.ws.id, brandId: t.brand.id, plan, trigger: "test", operationId: `inl-run-${t.ws.id}` });
    const first = await executeRun(db, run.id, plan, adapters, { deadline: Date.now() - 1 });
    expect(first.incomplete).toBe(true);
    expect(gpt.calls() + gem.calls()).toBe(0);
    expect((await db.monitoringRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("running");
    const done = await executeRun(db, run.id, plan, adapters, {});
    expect(done.incomplete).toBe(false);
    expect(done.status).toBe("partial");
    expect(done.ok).toBe(3);
    expect(gem.calls()).toBe(1);
    const failed = await db.observation.findMany({ where: { runId: run.id, engine: "gemini" } });
    expect(failed.every((o) => o.status === "failed" && o.errorCode === "auth")).toBe(true);
  });

  it("aynı işe paralel adım isteği ikinci kez çalıştırmaz; 'devam bekliyor' deneme sayılmaz", async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    handlers.test_steps = async (ctx) => {
      active++;
      maxActive = Math.max(maxActive, active);
      runs++;
      await new Promise((r) => setTimeout(r, 150));
      active--;
      const n = ((ctx.step as { n?: number } | undefined)?.n ?? 0) + 1;
      await ctx.saveStep?.({ n });
      return n < 3 ? "continue" : "done";
    };
    const job = await enqueue(db, { type: "test_steps" as never, operationId: `steps-${Date.now()}`, payload: {}, maxAttempts: 2 });
    const [a, b] = await Promise.all([runJob(db, job.id, "t1", { deadline: Date.now() + 1000 }), runJob(db, job.id, "t2", { deadline: Date.now() + 1000 })]);
    expect([a, b].sort()).toEqual(["continue", "skipped"]);
    expect(maxActive).toBe(1);
    expect(await runJob(db, job.id, "t", { deadline: Date.now() + 1000 })).toBe("continue");
    expect(await runJob(db, job.id, "t", { deadline: Date.now() + 1000 })).toBe("succeeded");
    expect(runs).toBe(3);
    const rec = await db.jobRecord.findUniqueOrThrow({ where: { id: job.id } });
    expect(rec.attempts).toBe(1); // yalnız tamamlanan adım sayıldı (maxAttempts=2 aşılmadı)
    // Bitmiş işe yeni adım isteği çalıştırmaz.
    expect((await advanceJob(db, job.id, null)).outcome).toBe("terminal");
    expect(runs).toBe(3);
  });

  it("süresi dolmuş kilit (yarıda kalan adım) devralınır", async () => {
    let runs = 0;
    handlers.test_stale = async () => {
      runs++;
    };
    const job = await enqueue(db, { type: "test_stale" as never, operationId: `stale-${Date.now()}`, payload: {} });
    await db.jobRecord.update({ where: { id: job.id }, data: { status: "running", lockedUntil: new Date(Date.now() + 60_000) } });
    expect(await runJob(db, job.id, "t", { deadline: Date.now() + 1000 })).toBe("skipped");
    await db.jobRecord.update({ where: { id: job.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect(await runJob(db, job.id, "t", { deadline: Date.now() + 1000 })).toBe("succeeded");
    expect(runs).toBe(1);
  });

  it("adım uç noktası: başka workspace'in işine erişim yok; yetkili kullanıcı ilerletebilir", async () => {
    const owner = await makeTenant();
    const stranger = await makeTenant();
    let runs = 0;
    handlers.crawl = async () => {
      runs++;
    };
    const job = await enqueue(db, { type: "crawl", operationId: `auth-${Date.now()}`, workspaceId: owner.ws.id, brandId: owner.brand.id, payload: {} });
    const call = () => advanceRoute(new NextRequest(`http://localhost:3000/api/v1/jobs/${job.id}/advance`, { method: "POST", headers: { origin: "http://localhost:3000" } }), { params: Promise.resolve({ id: job.id }) });
    session.userId = null;
    expect((await call()).status).toBe(401);
    session.userId = stranger.user.id;
    expect([403, 404]).toContain((await call()).status);
    expect(runs).toBe(0);
    session.userId = owner.user.id;
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { data: { job: { status: string } } }).data.job.status).toBe("succeeded");
    expect(runs).toBe(1);
  });
});
