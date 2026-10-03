import type { PrismaClient } from "@/generated/prisma/client";
import { AppError, notFound } from "@/lib/http/errors";
import { hasFeature } from "@/modules/billing/plans";
import { commit, ensureBucket, periodKey, release, reserve } from "@/modules/billing/quota";
import type { BrandAccess } from "@/modules/tenancy/access";
import { assertCan, assertCanRunPaidJob } from "@/modules/tenancy/access";
import { generateDraft, generationStatus, type GenerationInput } from "./generator";
import { executionMode } from "@/lib/queue";
import { blockingIssues, canTransitionAction, checkApprovalHash, versionHash, type ActionContent, type ActionStatus, type ActionType } from "./workflow";
import { minimumPlanFor } from "@/modules/billing/plans";
import { fixturesAllowed } from "@/lib/demo";

/**
 * Action servisleri: server-side plan kapısı (Starter'da Fix with AI kapalı), fix unit kotası,
 * immutable sürümler, hash'li onay, onay sonrası düzenleme onayı düşürür.
 */
export function assertFixEnabled(access: BrandAccess) {
  if (!hasFeature(access.entitlements, "fix_with_ai")) {
    throw new AppError("plan_required", "Fix with AI bu pakette yok", { requiredPlan: minimumPlanFor("fix_with_ai") });
  }
}

async function currentPeriod(db: PrismaClient, workspaceId: string) {
  const sub = await db.subscription.findUnique({ where: { workspaceId } });
  return periodKey(sub?.currentPeriodStart ?? new Date(new Date().toISOString().slice(0, 7) + "-01T00:00:00Z"));
}

export async function createActionDraft(db: PrismaClient, access: BrandAccess, input: { opportunityId: string; type: ActionType; targetUrl?: string | null; operationId: string; userId: string | null }) {
  assertCan(access, "actions.draft");
  assertFixEnabled(access);
  assertCanRunPaidJob(access);
  const opp = await db.opportunity.findFirst({ where: { id: input.opportunityId, brandId: access.brandId, workspaceId: access.workspaceId }, include: { cluster: true, evidence: true } });
  if (!opp) throw notFound("Fırsat");
  // Üretim yapılandırılmamışsa kota ayırmadan önce açık hata (gerçek workspace'te şablon/mock yok).
  if (generationStatus({ demo: fixturesAllowed(access) }) === "not_configured") {
    throw new AppError("not_configured", "İçerik üretimi için OPENAI_API_KEY ve GENERATION_MODEL gerekli");
  }
  // Ürün verisi yoksa taslak yalnız yer tutuculardan oluşur; kota harcamadan önce açıkça söylenir.
  const productCount = await db.product.count({ where: { brandId: access.brandId, active: true } });
  if (productCount === 0 && !fixturesAllowed(access)) {
    throw new AppError("conflict", "Katalogda ürün yok: önce Kurulum › Keşfi onayla adımında siteyi tarayın veya mağazanızı bağlayın; ürün verisi olmadan taslak yer tutuculardan oluşur");
  }
  const period = await currentPeriod(db, access.workspaceId);
  await ensureBucket(db, access.workspaceId, "fix_units", period, access.entitlements.fixUnits);
  await reserve(db, { workspaceId: access.workspaceId, metric: "fix_units", period, limit: access.entitlements.fixUnits, amount: 1, operationId: input.operationId });
  try {
    // Önce kümenin kategorisine bağlı ürünler; yoksa adında kategori kelimesi geçenler; o da yoksa markanın ürünleri.
    const productQuery = (where: object) => db.product.findMany({ where: { brandId: access.brandId, active: true, ...where }, include: { variants: { take: 1 } }, take: 8 });
    const cat = opp.cluster.category;
    const word = cat?.split(/\s+/).filter((w) => w.length > 3).pop();
    let catalog = cat ? await productQuery({ categories: { some: { category: { name: { contains: cat, mode: "insensitive" } } } } }) : [];
    if (!catalog.length && word) catalog = await productQuery({ name: { contains: word.slice(0, Math.max(4, word.length - 2)), mode: "insensitive" } });
    if (!catalog.length) catalog = await productQuery({});
    const genInput: GenerationInput = {
      type: input.type,
      language: access.brand.language,
      brand: { name: access.brand.name, domain: access.brand.domain },
      opportunity: { title: opp.title, recommendedAction: opp.recommendedAction, clusterLabel: opp.cluster.label, gapType: opp.gapType },
      evidence: opp.evidence.map((e) => ({ quote: e.quote, url: e.pageUrl })),
      targetUrl: input.targetUrl ?? opp.targetUrl,
      catalog: catalog.map((p) => ({ name: p.name, url: p.url, priceMinor: p.variants[0]?.priceMinor ?? null, currency: p.variants[0]?.currency ?? null, available: p.variants[0]?.available ?? null })),
      allowedClaims: [],
    };
    // Redis'siz (inline) dağıtımda istek süresi sınırına (60 sn) sığmak için daha kısa zaman aşımı.
    const content = await generateDraft(genInput, { demo: fixturesAllowed(access), timeoutMs: executionMode() === "inline" ? 50_000 : undefined });
    const action = await db.$transaction(async (tx) => {
      const a = await tx.action.create({
        data: { workspaceId: access.workspaceId, brandId: access.brandId, opportunityId: opp.id, type: input.type, title: content.title ?? opp.title, targetUrl: genInput.targetUrl, status: "draft", version: 1 },
      });
      const v = await tx.actionVersion.create({
        data: { workspaceId: access.workspaceId, actionId: a.id, number: 1, content: content as object, contentHash: versionHash(content), createdById: input.userId, generated: true, sourceHashes: { opportunityUpdatedAt: opp.updatedAt.toISOString() } },
      });
      if (opp.status === "new" || opp.status === "triaged") await tx.opportunity.update({ where: { id: opp.id }, data: { status: "in_progress" } });
      return tx.action.update({ where: { id: a.id }, data: { currentVersionId: v.id } });
    });
    await commit(db, input.operationId, 1); // başarılı yeni draft sürümü = 1 fix unit
    return action;
  } catch (e) {
    await release(db, input.operationId);
    throw e;
  }
}

/** Kullanıcı düzenlemesi: yeni immutable sürüm; optimistic concurrency (version) ve onayı düşürme. */
export async function saveActionVersion(db: PrismaClient, access: BrandAccess, input: { actionId: string; expectedVersion: number; content: ActionContent; userId: string | null }) {
  assertCan(access, "actions.draft");
  return db.$transaction(async (tx) => {
    const a = await tx.action.findFirst({ where: { id: input.actionId, brandId: access.brandId, workspaceId: access.workspaceId } });
    if (!a) throw notFound("Aksiyon");
    if (a.version !== input.expectedVersion) throw new AppError("conflict", "Aksiyon başka biri tarafından güncellendi; yeniden yükleyin", { currentVersion: a.version });
    if (["publishing", "published", "measuring", "completed"].includes(a.status)) throw new AppError("conflict", "Yayımlanmış aksiyon düzenlenemez; yeni taslak oluşturun");
    const updated = await tx.action.updateMany({ where: { id: a.id, version: input.expectedVersion }, data: { version: { increment: 1 }, status: "draft" } });
    if (updated.count === 0) throw new AppError("conflict", "Eşzamanlı güncelleme");
    const v = await tx.actionVersion.create({
      data: { workspaceId: access.workspaceId, actionId: a.id, number: a.version + 1, content: input.content as object, contentHash: versionHash(input.content), createdById: input.userId },
    });
    await tx.approval.updateMany({ where: { actionId: a.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return tx.action.update({ where: { id: a.id }, data: { currentVersionId: v.id } });
  });
}

export async function transitionAction(db: PrismaClient, access: BrandAccess, actionId: string, to: ActionStatus, userId: string | null) {
  const a = await db.action.findFirst({ where: { id: actionId, brandId: access.brandId, workspaceId: access.workspaceId } });
  if (!a) throw notFound("Aksiyon");
  if (!canTransitionAction(a.status as ActionStatus, to)) throw new AppError("conflict", `${a.status} → ${to} geçişi geçersiz`);
  // Manuel uygulama bildirimi de yayın sayılır: zorunlu eksikli onaylı içerik uygulanmış gibi kaydedilmez.
  if (to === "measuring" && a.status === "approved") await assertCurrentVersionComplete(db, a.currentVersionId);
  const data: Record<string, unknown> = { status: to, version: { increment: 1 } };
  if (to === "measuring") {
    const publishAt = new Date();
    data.publishedAt = a.publishedAt ?? publishAt;
    data.measurement = { publishAt: publishAt.toISOString(), baselineDays: 14, followUps: [14, 28], note: "Aynı soru kümesiyle karşılaştırılır; nedensellik iddia edilmez", manualPublish: a.status === "approved", by: userId };
  }
  return db.action.update({ where: { id: a.id }, data });
}

function assertNoBlockingIssues(content: ActionContent) {
  const issues = blockingIssues(content);
  if (issues.length) {
    throw new AppError("validation_error", `Düzeltme gerekli: ${issues.length} doldurulmamış zorunlu alan (${[...new Set(issues.map((i) => i.token))].join(", ")})`, { issues });
  }
}

async function assertCurrentVersionComplete(db: PrismaClient, versionId: string | null) {
  if (!versionId) throw new AppError("conflict", "Aksiyonun güncel sürümü yok");
  const v = await db.actionVersion.findUniqueOrThrow({ where: { id: versionId } });
  assertNoBlockingIssues(v.content as unknown as ActionContent);
}

/** Onay: yalnız approver; versionId + expectedHash güncel sürümle eşleşmeli (hash race → 409). */
export async function approveAction(db: PrismaClient, access: BrandAccess, input: { actionId: string; versionId: string; expectedHash: string; userId: string }) {
  assertCan(access, "actions.approve");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Action" WHERE "id" = ${input.actionId}::uuid AND "brandId" = ${access.brandId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound("Aksiyon");
    const a = await tx.action.findUniqueOrThrow({ where: { id: input.actionId } });
    if (a.currentVersionId !== input.versionId) throw new AppError("conflict", "Onaylanan sürüm güncel değil");
    const v = await tx.actionVersion.findUniqueOrThrow({ where: { id: input.versionId } });
    const check = checkApprovalHash(input.expectedHash, v.contentHash);
    if (!check.ok) throw new AppError("conflict", "İçerik onaydan önce değişti; yeni diff'i inceleyin");
    if (!["draft", "review"].includes(a.status)) throw new AppError("conflict", `${a.status} durumundaki aksiyon onaylanamaz`);
    assertNoBlockingIssues(v.content as unknown as ActionContent);
    await tx.approval.create({ data: { workspaceId: access.workspaceId, actionId: a.id, versionId: v.id, versionHash: v.contentHash, approverId: input.userId } });
    await tx.auditLog.create({ data: { workspaceId: access.workspaceId, actorId: input.userId, actorType: "user", scope: `brand:${access.brandId}`, action: "action.approved", target: a.id } });
    return tx.action.update({ where: { id: a.id }, data: { status: "approved", version: { increment: 1 } } });
  });
}

/**
 * Publish: yazma destekli connector + write scope + geçerli onay gerekir. Bu sürümde hiçbir connector
 * canlı contentWrite doğrulamasına sahip değil → 422 unsupported ve export alternatifi.
 */
export async function publishAction(db: PrismaClient, access: BrandAccess, actionId: string) {
  assertCan(access, "actions.publish");
  const a = await db.action.findFirst({ where: { id: actionId, brandId: access.brandId, workspaceId: access.workspaceId }, include: { approvals: { where: { revokedAt: null } } } });
  if (!a) throw notFound("Aksiyon");
  if (a.status !== "approved" || a.approvals.length === 0) throw new AppError("conflict", "Yayın için geçerli onay gerekli");
  await assertCurrentVersionComplete(db, a.currentVersionId);
  const writable = await db.integration.findFirst({ where: { brandId: access.brandId, status: "healthy", capabilities: { path: ["contentWrite"], equals: true } } });
  if (!writable) {
    throw new AppError("unsupported", "Yazma destekli ve doğrulanmış bir mağaza bağlantısı yok. İçeriği HTML/Markdown/JSON olarak dışa aktarıp manuel yayımlayabilirsiniz.", { alternative: "export" });
  }
  throw new AppError("unsupported", "Connector publish canlı acceptance testinden geçmedi", { alternative: "export" });
}
