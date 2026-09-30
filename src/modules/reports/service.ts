import type { PrismaClient } from "@/generated/prisma/client";
import { hashToken, randomToken } from "@/lib/crypto";
import { AppError, notFound } from "@/lib/http/errors";
import { brandMetrics } from "@/modules/monitoring/queries";
import { revenueSummary } from "@/modules/commerce/service";
import { hasFeature } from "@/modules/billing/plans";
import type { BrandAccess } from "@/modules/tenancy/access";
import { toCsv } from "./csv";

/**
 * Rapor: immutable snapshot (sonradan değişen pano rapora sızmaz). İçerik: yönetici özeti, dönem/cohort/kapsam,
 * motor trendleri, rakip/citation, top fırsatlar, aksiyonlar, gözlemlenen gelir (paket izinliyse), sonraki adımlar.
 */
export async function createReportSnapshot(db: PrismaClient, access: BrandAccess, input: { from: Date; to: Date; template: string; userId: string | null }) {
  const [metrics, opps, actions] = await Promise.all([
    brandMetrics(db, access.workspaceId, access.brandId, { from: input.from, to: input.to }),
    db.opportunity.findMany({ where: { brandId: access.brandId, status: { in: ["new", "triaged", "in_progress"] } }, orderBy: [{ score: { sort: "desc", nulls: "last" } }], take: 10, select: { title: true, score: true, gapType: true, status: true, recommendedAction: true } }),
    db.action.findMany({ where: { brandId: access.brandId }, orderBy: { updatedAt: "desc" }, take: 10, select: { title: true, status: true, type: true, publishedAt: true } }),
  ]);
  const revenue = hasFeature(access.entitlements, "revenue") ? await revenueSummary(db, access.workspaceId, access.brandId, { from: input.from, to: input.to }) : null;
  const snapshot = {
    generatedAt: new Date().toISOString(),
    asOf: input.to.toISOString(),
    period: { from: input.from.toISOString(), to: input.to.toISOString() },
    brand: { name: access.brand.name, domain: access.brand.domain },
    visibility: { score: metrics.aggregate.score, partial: metrics.aggregate.partial, smallSample: metrics.aggregate.smallSample, coverage: metrics.coverage, sampleCount: metrics.sampleCount, formulaVersion: metrics.formulaVersion, cohortHash: metrics.cohortHash, perEngine: metrics.perEngine.map((e) => ({ engine: e.engine, score: e.score, coverage: e.coverage })) },
    sov: metrics.sov,
    provenance: metrics.provenance,
    opportunities: opps,
    actions,
    revenue: revenue ? { model: revenue.model, aiOrders: revenue.aiOrders, aiNetByCurrency: Object.fromEntries(Object.entries(revenue.aiNetByCurrency).map(([k, v]) => [k, v.toString()])), attributionCoverage: revenue.attributionCoverage, unattributed: revenue.unattributed } : null,
    notes: ["API yanıtları tüketici uygulamasındaki sonuçla aynı değildir.", "Değişimler aynı cohort dışında performans iyileşmesi olarak yorumlanmamalıdır.", "Gelir gözlemlenen ve ilişkilendirilen siparişlerdir; muhasebe kaydı değildir."],
  };
  return db.report.create({ data: { workspaceId: access.workspaceId, brandId: access.brandId, template: input.template, filters: { from: input.from.toISOString(), to: input.to.toISOString() }, snapshot: JSON.parse(JSON.stringify(snapshot)), snapshotAt: new Date(), format: "html", status: "succeeded", createdById: input.userId } });
}

export function reportCsv(snapshot: Record<string, unknown>): string {
  const s = snapshot as { opportunities: Array<{ title: string; score: number | null; gapType: string; status: string; recommendedAction: string | null }> };
  return toCsv(["title", "score", "gap_type", "status", "recommended_action"], s.opportunities.map((o) => [o.title, o.score, o.gapType, o.status, o.recommendedAction]));
}

export async function createShareLink(db: PrismaClient, access: BrandAccess, reportId: string, days: number) {
  const r = await db.report.findFirst({ where: { id: reportId, brandId: access.brandId, workspaceId: access.workspaceId } });
  if (!r) throw notFound("Rapor");
  if (days < 1 || days > 30) throw new AppError("validation_error", "Süre 1–30 gün olmalı");
  const token = randomToken();
  await db.shareLink.create({ data: { workspaceId: access.workspaceId, reportId: r.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + days * 86_400_000) } });
  return token;
}

export async function getSharedReport(db: PrismaClient, token: string) {
  const link = await db.shareLink.findUnique({ where: { tokenHash: hashToken(token) }, include: { report: true } });
  if (!link || link.revokedAt || link.expiresAt < new Date()) return null;
  return link.report;
}
