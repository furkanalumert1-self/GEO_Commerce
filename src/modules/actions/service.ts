import type { PrismaClient } from "@/generated/prisma/client";
import { AppError, notFound } from "@/lib/http/errors";
import { hasFeature } from "@/modules/billing/plans";
import { commit, ensureBucket, periodKey, release, reserve } from "@/modules/billing/quota";
import type { BrandAccess } from "@/modules/tenancy/access";
import { assertCan, assertCanRunPaidJob } from "@/modules/tenancy/access";
import { generateDraft, type GenerationInput } from "./generator";
import { canTransitionAction, checkApprovalHash, versionHash, type ActionContent, type ActionStatus, type ActionType } from "./workflow";
import { minimumPlanFor } from "@/modules/billing/plans";

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
  const period = await currentPeriod(db, access.workspaceId);
  await ensureBucket(db, access.workspaceId, "fix_units", period, access.entitlements.fixUnits);
  await reserve(db, { workspaceId: access.workspaceId, metric: "fix_units", period, limit: access.entitlements.fixUnits, amount: 1, operationId: input.operationId });
  try {
    const catalog = await db.product.findMany({
      where: { brandId: access.brandId, active: true, ...(opp.cluster.category ? { categories: { some: { category: { name: { equals: opp.cluster.category, mode: "insensitive" } } } } } : {}) },
      include: { variants: { take: 1 } },
      take: 8,
    });
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
    const content = await generateDraft(genInput);
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
  const data: Record<string, unknown> = { status: to, version: { increment: 1 } };
  if (to === "measuring") {
    const publishAt = new Date();
    data.publishedAt = a.publishedAt ?? publishAt;
    data.measurement = { publishAt: publishAt.toISOString(), baselineDays: 14, followUps: [14, 28], note: "Aynı cohort ile karşılaştırılır; nedensellik iddia edilmez", manualPublish: a.status === "approved", by: userId };
  }
  return db.action.update({ where: { id: a.id }, data });
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
  const writable = await db.integration.findFirst({ where: { brandId: access.brandId, status: "healthy", capabilities: { path: ["contentWrite"], equals: true } } });
  if (!writable) {
    throw new AppError("unsupported", "Yazma destekli ve doğrulanmış bir mağaza bağlantısı yok. İçeriği HTML/Markdown/JSON olarak dışa aktarıp manuel yayımlayabilirsiniz.", { alternative: "export" });
  }
  throw new AppError("unsupported", "Connector publish canlı acceptance testinden geçmedi", { alternative: "export" });
}
