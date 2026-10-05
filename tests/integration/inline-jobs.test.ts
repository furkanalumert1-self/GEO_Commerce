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
import { claimAudit, confirmAudit, previewAuditQuestions, runAudit, startAudit, type AuditWork } from "@/modules/audit/service";
import { seedPrompts } from "@/modules/prompts/seed";
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

/** Çok markalı mağaza: menü bölümleri + farklı markalı ürün sayfaları (Product JSON-LD). */
const storeFetcher: Fetcher = async (url) => {
  const u = new URL(url);
  const ok = (body: string) => ({ status: 200, body, headers: { "content-type": "text/html" } as Record<string, string>, url, truncated: false });
  if (u.pathname === "/robots.txt" || u.pathname.endsWith(".xml")) return { status: 404, body: "", headers: {} as Record<string, string>, url, truncated: false };
  const product = (name: string, brand: string) => ok(`<!doctype html><html lang="tr"><head><title>${name}</title><script type="application/ld+json">${JSON.stringify({ "@type": "Product", name, brand: { "@type": "Brand", name: brand }, offers: { price: "100", priceCurrency: "TRY", availability: "InStock" } })}</script></head><body><h1>${name}</h1></body></html>`);
  const products: Record<string, [string, string]> = {
    "/ev-tekstili/battaniye-a": ["Pamuk Battaniye", "Linen Co"],
    "/ev-tekstili/nevresim-b": ["Saten Nevresim", "Uyku Tekstil"],
    "/mutfak/tencere-c": ["Çelik Tencere", "Mutfakçı"],
    "/mutfak/tava-d": ["Döküm Tava", "Ocak Usta"],
    "/sofra/tabak-e": ["Porselen Tabak", "Seramikçi"],
  };
  if (products[u.pathname]) return product(...products[u.pathname]!);
  const links = Object.keys(products).map((p) => `<a href="${p}">${products[p]![0]}</a>`).join("");
  return ok(`<!doctype html><html lang="tr"><head><title>Evim</title><meta property="og:site_name" content="Evim"></head><body><h1>Evim</h1><nav><a href="/ev-tekstili/">Ev Tekstili</a><a href="/ev-tekstili/x">Nevresim</a><a href="/ev-tekstili/y">Yorgan</a><a href="/mutfak/">Mutfak</a><a href="/sofra/">Sofra</a></nav>${links}</body></html>`);
};

describe("ücretsiz ölçüm kapsamı", () => {
  it("ürün grubu/hizmet doğrulanamayan sitede genel soru uydurulmaz; kullanıcı kategorisini yazınca ölçüm sürer", async () => {
    const audit = await makeAudit(`kapsam-${randomToken(4).toLowerCase()}.com`);
    const gpt = countingAdapter("chatgpt");
    const adapters = { chatgpt: gpt.adapter, gemini: countingAdapter("gemini").adapter } as unknown as Record<EngineKey, AiMonitorAdapter>;
    expect(await runAudit(db, audit.id, { fetcher: siteFetcher, adapters })).toBe("done");
    expect(gpt.calls()).toBe(0);
    // Uydurma soru yok: kategori girişi beklenir (onay aşaması, boş soru listesi).
    const waiting = await db.audit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(waiting.stage).toBe("confirm");
    const sum = waiting.resultSummary as { proposal: { questions: unknown[] } };
    expect(sum.proposal.questions).toHaveLength(0);
    const preview = previewAuditQuestions(waiting, { businessType: "retailer", topics: ["Kadın giyim"] });
    expect(preview.questions.length).toBeGreaterThan(0);
    await confirmAudit(db, audit.id, { questions: preview.questions.map((q) => q.text), businessType: "retailer", topics: ["Kadın giyim"] });
    expect(await runAudit(db, audit.id, { fetcher: async () => { throw new Error("tarama tekrarlanmamalı"); }, adapters })).toBe("done");
    expect(gpt.calls()).toBe(preview.questions.length);
    const done = await db.audit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(["succeeded", "partial"]).toContain(done.status);
  });
});

describe("ücretsiz ölçüm soru onayı", () => {
  it("tarama sonrası onay bekler; onaydan önce AI çağrısı yok; onay idempotent; markalı soru reddedilir", async () => {
    const audit = await makeAudit(`onay-${randomToken(4).toLowerCase()}.com`);
    const gpt = countingAdapter("chatgpt");
    const gem = countingAdapter("gemini");
    const adapters = { chatgpt: gpt.adapter, gemini: gem.adapter } as unknown as Record<EngineKey, AiMonitorAdapter>;
    expect(await runAudit(db, audit.id, { fetcher: storeFetcher, adapters }, { requireConfirmation: true })).toBe("done");
    expect(gpt.calls() + gem.calls()).toBe(0);
    const waiting = await db.audit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(waiting.stage).toBe("confirm");
    const sum = waiting.resultSummary as { proposal: { business: { type: string }; topics: string[]; questions: Array<{ text: string; kind: string }> } };
    expect(sum.proposal.business.type).toBe("retailer");
    expect(sum.proposal.topics[0]).toBe("Ev Tekstili");
    expect(sum.proposal.questions).toHaveLength(5);
    expect(sum.proposal.questions.map((q) => q.kind)).toEqual(["discovery", "discovery", "need", "need", "info"]);
    expect(sum.proposal.questions.every((q) => !/evim/i.test(q.text))).toBe(true);
    // Tür değişince soru seti yeniden üretilir (ücretli çağrı yok).
    const preview = previewAuditQuestions(waiting, { businessType: "manufacturer", topics: ["Nevresim"] });
    expect(preview.questions[0]!.text).toMatch(/nevresim markaları/i);
    await expect(confirmAudit(db, audit.id, { questions: ["Evim güvenilir bir mağaza mı?"] })).rejects.toThrow(/Marka adınızı/);
    const chosen = sum.proposal.questions.slice(0, 3).map((q) => q.text);
    const first = await confirmAudit(db, audit.id, { questions: chosen });
    const again = await confirmAudit(db, audit.id, { questions: chosen });
    expect(again.jobId).toBe(first.jobId);
    expect(again.alreadyConfirmed).toBe(true);
    // Yanıt işi taramayı tekrarlamaz; yalnız onaylanan 3 soru × 2 platform sorulur.
    expect(await runAudit(db, audit.id, { fetcher: async () => { throw new Error("tarama tekrarlanmamalı"); }, adapters }, { requireConfirmation: false })).toBe("done");
    expect(gpt.calls()).toBe(3);
    expect(gem.calls()).toBe(3);
    const done = await db.audit.findUniqueOrThrow({ where: { id: audit.id } });
    const res = done.resultSummary as { questions: Array<{ kind: string }>; kindStats: Record<string, { answers: number }>; business: { type: string } };
    expect(res.questions.map((q) => q.kind)).toEqual(["discovery", "discovery", "need"]);
    expect(res.kindStats.info!.answers).toBe(0);
    expect(res.business.type).toBe("retailer");
  });
});

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
    // Bütçeli ilk adım: tarama biter ve ara durum saklanır; aynı adımda AI çağrısı başlatılmaz.
    expect(await runAudit(db, audit.id, { fetcher: storeFetcher, adapters }, { ...store, deadline: Date.now() + 2500 })).toBe("continue");
    expect(gpt.calls() + gem.calls()).toBe(0);
    expect(saved!.crawl?.pages).toBeGreaterThan(0);
    // Sonraki adımlar: kaldığı yerden devam, sonunda gerçek rapor.
    let steps = 0;
    let r: "done" | "continue" = "continue";
    while (r === "continue" && steps < 20) {
      r = await runAudit(db, audit.id, { fetcher: storeFetcher, adapters }, { ...store, deadline: Date.now() + 5 });
      steps++;
    }
    expect(r).toBe("done");
    expect(gpt.calls()).toBe(5);
    expect(gem.calls()).toBe(5);
    const done = await db.audit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(["succeeded", "partial"]).toContain(done.status);
    expect((done.resultSummary as { visibility: { sampleCount: number } }).visibility.sampleCount).toBe(10);
    // Tamamlanmış audit yeniden çalıştırılınca çağrı yapılmaz.
    await runAudit(db, audit.id, { fetcher: storeFetcher, adapters }, store);
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
    expect(await runAudit(db, audit.id, { fetcher: storeFetcher, adapters })).toBe("done");
    expect(gem.calls()).toBe(1); // kalıcı hata: platform bu audit'te tekrar çağrılmaz
    expect(gpt.calls()).toBe(7); // 5 soru + 2 geçici hata için birer yeniden deneme
    const done = await db.audit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(done.status).toBe("partial");
    const summary = done.resultSummary as { visibility: { sampleCount: number }; failedCalls: string[] };
    expect(summary.visibility.sampleCount).toBe(5);
    expect(summary.failedCalls).toEqual(["gemini:auth"]);
  });

  it("Claude yapılandırılmışsa ücretsiz ölçüm kapsamına girer; kredi hatası diğer platformları durdurmaz ve tekrar çağrılmaz", async () => {
    const audit = await makeAudit(`c-${randomToken(4).toLowerCase()}.com`);
    const gpt = countingAdapter("chatgpt");
    const gem = countingAdapter("gemini");
    const cl = countingAdapter("claude", async () => {
      throw new ProviderError("Hesapta kullanılabilir kredi yok", false, undefined, "insufficient_quota");
    });
    const adapters = { chatgpt: gpt.adapter, gemini: gem.adapter, claude: cl.adapter } as unknown as Record<EngineKey, AiMonitorAdapter>;
    expect(await runAudit(db, audit.id, { fetcher: storeFetcher, adapters })).toBe("done");
    expect(cl.calls()).toBe(1);
    expect(gpt.calls()).toBe(5);
    expect(gem.calls()).toBe(5);
    const done = await db.audit.findUniqueOrThrow({ where: { id: audit.id } });
    expect(done.status).toBe("partial");
    const summary = done.resultSummary as { scopeEngines: string[]; visibility: { sampleCount: number; scheduled: number; missingEngines: string[] }; failedCalls: string[] };
    expect(summary.scopeEngines).toEqual(["chatgpt", "gemini", "claude"]);
    expect(summary.visibility.sampleCount).toBe(10);
    expect(summary.visibility.scheduled).toBe(15);
    expect(summary.visibility.missingEngines).toContain("claude"); // başarısız platform ortak skora girmez
    expect(summary.failedCalls).toEqual(["claude:insufficient_quota"]);
    // Yeniden çalıştırma çağrıyı tekrarlamaz.
    await runAudit(db, audit.id, { fetcher: storeFetcher, adapters });
    expect(cl.calls() + gpt.calls() + gem.calls()).toBe(11);
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

  it("30 gün kuralı: sonuç üretmiş audit tekrarı engeller; yalnız platform admin testi atlayabilir", async () => {
    const domain = "example.com";
    await db.audit.create({ data: { domain, locale: "tr-TR", tokenHash: hashToken(randomToken(24)), fingerprintHash: randomToken(8), expiresAt: new Date(Date.now() + 86_400_000), status: "succeeded", resultSummary: { visibility: { sampleCount: 5 } } } });
    await expect(startAudit(db, { domain, locale: "tr-TR", fingerprint: randomToken(12) })).rejects.toMatchObject({ code: "rate_limited" });
    const out = await startAudit(db, { domain, locale: "tr-TR", fingerprint: randomToken(12), adminBypass: true });
    expect(out.token).toBeTruthy();
  });

  it("rapor kaydedilince analiz soruları + kategori soruları aktif prompt olur; tekrar üretim limiti aşmaz", async () => {
    const user = await db.user.create({ data: { email: `claim-${randomToken(4).toLowerCase()}@example.com` } });
    const token = randomToken(24);
    await db.audit.create({ data: { domain: `c-${randomToken(4).toLowerCase()}.com`, locale: "tr-TR", tokenHash: hashToken(token), fingerprintHash: randomToken(8), expiresAt: new Date(Date.now() + 86_400_000), status: "partial", resultSummary: { brandName: "Homedius", prompts: ["Türkiye'de en iyi katlanır koltuk markaları hangileri?"], crawl: { categories: ["Katlanır Koltuk", "Puf Seti"] }, competitorCandidates: [], visibility: { sampleCount: 5 } } } });
    const out = await claimAudit(db, token, user.id);
    const prompts = await db.prompt.findMany({ where: { brandId: out.brandId, active: true }, include: { versions: true, cluster: true } });
    expect(prompts.length).toBe(10); // deneme paketi limiti
    const texts = prompts.map((p) => p.versions[0]!.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).toContain("Türkiye'de en iyi katlanır koltuk markaları hangileri?");
    expect(texts.some((t) => t.includes("puf seti"))).toBe(true);
    expect(prompts.every((p) => p.currentVersionId)).toBe(true);
    // Limit dolu: yeniden üretim ekleme yapmaz.
    const added = await seedPrompts(db, { workspaceId: out.workspaceId, brandId: out.brandId, brandName: "Homedius", locale: "tr-TR", source: "generated", activeLimit: 10, texts: [{ text: "Yeni bir soru metni burada mı?" }] });
    expect(added).toBe(0);
  });

  it("ChatGPT Ads planı: ölçüm yokken kategorilerden reklam grubu, TR uygunluğu ve bütçe kademeleri üretir", async () => {
    const { buildChatgptAdsPlan } = await import("@/modules/ads/chatgpt-plan");
    const { ws, brand } = await makeTenant("commerce");
    await db.brand.update({ where: { id: brand.id }, data: { country: "TR", categories: ["Yataklı Koltuk", "Puf Seti"] } });
    const plan = await buildChatgptAdsPlan(db, { workspaceId: ws.id, brandId: brand.id });
    expect(plan.adGroups.map((g) => g.label)).toEqual(["Yataklı Koltuk", "Puf Seti"]);
    expect(plan.adGroups[0]!.hints.length).toBeGreaterThan(0);
    expect(plan.steps.find((s) => s.key === "eligibility")!.status).toBe("done");
    expect(plan.steps.find((s) => s.key === "account")!.status).toBe("todo");
    expect(plan.budget).toHaveLength(3);
  });
});
