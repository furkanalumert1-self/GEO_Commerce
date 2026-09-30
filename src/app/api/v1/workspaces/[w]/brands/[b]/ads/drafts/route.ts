import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { hasFeature } from "@/modules/billing/plans";
import { csvRow } from "@/modules/reports/csv";

/**
 * Kampanya brief/creative taslağı + CSV export. Sağlayıcı validasyonu yoksa "validatedBy: unavailable";
 * karakter/bütçe limitleri sabitlenmez. GEO intent cluster sağlayıcıda keyword targeting değildir.
 */
const body = z.object({ opportunityId: z.string().uuid(), headline: z.string().trim().min(3).max(200), body: z.string().trim().min(3).max(1000), landingUrl: z.string().url().max(500), dailyBudget: z.number().positive().max(1_000_000).optional(), currency: z.string().length(3).default("USD") });

export const POST = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "ads.draft");
  if (!hasFeature(access.entitlements, "ads")) throw new AppError("plan_required", "Ads modülü Commerce ve üzeri paketlerde");
  const input = await readJson(req, body);
  const opp = await db.opportunity.findFirst({ where: { id: input.opportunityId, brandId: access.brandId }, include: { cluster: true } });
  if (!opp) throw notFound("Fırsat");
  const landingHost = new URL(input.landingUrl).hostname.replace(/^www\./, "");
  if (landingHost !== access.brand.domain && !landingHost.endsWith(`.${access.brand.domain}`)) throw new AppError("validation_error", "Landing URL marka alan adında olmalı");
  const csv = [
    csvRow(["intent_cluster", "headline", "body", "landing_url", "daily_budget", "currency", "validated_by", "note"]),
    csvRow([opp.cluster.label, input.headline, input.body, input.landingUrl, input.dailyBudget ?? "", input.currency, "unavailable", "Sağlayıcı kuralları ile doğrulanmadı; intent cluster keyword targeting değildir"]),
  ].join("\n");
  return json({ draft: { ...input, intentCluster: opp.cluster.label }, validation: { valid: null, validatedBy: "unavailable", issues: ["Bağlı ve doğrulanmış reklam hesabı yok"] }, csv }, { status: 201, requestId });
});
