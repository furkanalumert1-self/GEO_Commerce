import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { hasFeature } from "@/modules/billing/plans";
import { csvRow } from "@/modules/reports/csv";
import { apiPayload, CHATGPT_ADS_SPEC, contextHints, validateChatgptAd } from "@/modules/ads/chatgpt";

/**
 * Kampanya brief/creative taslağı + CSV export. Sağlayıcı validasyonu yoksa "validatedBy: unavailable";
 * karakter/bütçe limitleri sabitlenmez. GEO intent cluster sağlayıcıda keyword targeting değildir.
 */
const body = z.object({ platform: z.enum(["chatgpt", "generic"]).default("chatgpt"), opportunityId: z.string().uuid(), headline: z.string().trim().min(3).max(200), body: z.string().trim().min(3).max(1000), landingUrl: z.string().url().max(500), dailyBudget: z.number().positive().max(1_000_000).optional(), maxCpc: z.number().positive().max(10_000).optional(), currency: z.string().length(3).default("USD") });

export const POST = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "ads.draft");
  if (!hasFeature(access.entitlements, "ads")) throw new AppError("plan_required", "Ads modülü Commerce ve üzeri paketlerde");
  const input = await readJson(req, body);
  const opp = await db.opportunity.findFirst({ where: { id: input.opportunityId, brandId: access.brandId }, include: { cluster: true } });
  if (!opp) throw notFound("Fırsat");
  const landingHost = new URL(input.landingUrl).hostname.replace(/^www\./, "");
  if (landingHost !== access.brand.domain && !landingHost.endsWith(`.${access.brand.domain}`)) throw new AppError("validation_error", "Landing URL marka alan adında olmalı");
  if (input.platform === "chatgpt") {
    const prompts = await db.promptVersion.findMany({ where: { workspaceId: access.workspaceId, prompt: { clusterId: opp.clusterId, active: true } }, select: { text: true }, take: 20 });
    const products = await db.product.findMany({ where: { brandId: access.brandId, active: true }, select: { name: true }, take: 10 });
    const hints = contextHints({ prompts: prompts.map((p) => p.text), category: opp.cluster.category ?? opp.cluster.label, products: products.map((p) => p.name) });
    const brandRow = await db.brand.findUniqueOrThrow({ where: { id: access.brandId }, select: { categories: true } });
    const issues = validateChatgptAd({ title: input.headline, body: input.body, targetUrl: input.landingUrl, brandDomain: access.brand.domain, country: access.brand.country, categories: brandRow.categories });
    const payload = apiPayload({ name: `${access.brand.name} · ${opp.cluster.label}`, country: access.brand.country, dailyBudget: input.dailyBudget, maxCpc: input.maxCpc, title: input.headline, body: input.body, targetUrl: input.landingUrl, hints });
    const csvOut = [
      csvRow(["platform", "campaign_name", "status", "country", "daily_budget", "max_cpc", "currency", "ad_title", "ad_body", "target_url", "context_hints", "spec_version", "validated_by"]),
      csvRow(["chatgpt_ads", payload.campaign.name, "paused", access.brand.country, input.dailyBudget ?? "", input.maxCpc ?? "", input.currency, payload.ad.title, payload.ad.body, input.landingUrl, hints.join(" | "), CHATGPT_ADS_SPEC.version, "local_spec"]),
    ].join("\n");
    return json({ draft: { ...input, intentCluster: opp.cluster.label, contextHints: hints }, validation: { valid: !issues.some((x) => x.level === "error"), validatedBy: "local_spec", specVersion: CHATGPT_ADS_SPEC.version, issues }, payload, csv: csvOut }, { status: 201, requestId });
  }
  const csv = [
    csvRow(["intent_cluster", "headline", "body", "landing_url", "daily_budget", "currency", "validated_by", "note"]),
    csvRow([opp.cluster.label, input.headline, input.body, input.landingUrl, input.dailyBudget ?? "", input.currency, "unavailable", "Sağlayıcı kuralları ile doğrulanmadı; intent cluster keyword targeting değildir"]),
  ].join("\n");
  return json({ draft: { ...input, intentCluster: opp.cluster.label }, validation: { valid: null, validatedBy: "unavailable", issues: ["Bağlı ve doğrulanmış reklam hesabı yok"] }, csv }, { status: 201, requestId });
});
