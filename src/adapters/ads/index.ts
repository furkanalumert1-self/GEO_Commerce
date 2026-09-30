import type { AdsCapability } from "@/modules/ads/rules";

/**
 * AdsAdapter sözleşmesi (§7.3). Sağlayıcı erişimi yoksa intelligence/draft/export çalışır,
 * automation "access_required" döner; hata demo başarıya dönüştürülmez.
 * Karakter/bütçe/ülke limitleri sabitlenmez: validateDraft sağlayıcıdan gelir.
 */
export interface AccountCapabilities {
  capabilities: AdsCapability[];
  country: string | null;
  currency: string | null;
  policyVersion: string | null;
  lastVerifiedAt: Date | null;
  accessStatus: "access_required" | "active" | "revoked";
}

export interface CampaignDraft {
  name: string;
  objective: string;
  creatives: Array<{ headline: string; body: string; landingUrl: string }>;
  dailyBudgetMinor: bigint;
  totalBudgetMinor: bigint | null;
  currency: string;
  startAt: string;
  targeting: Record<string, unknown>;
}

export interface AdsAdapter {
  provider: string;
  getCapabilities(accountRef: string): Promise<AccountCapabilities>;
  validateAccount(accountRef: string): Promise<{ ok: boolean; reason?: string }>;
  listCampaigns(accountRef: string): Promise<Array<{ externalId: string; name: string; status: string }>>;
  getInsights(accountRef: string, from: Date, to: Date): Promise<Array<{ campaignExternalId: string; date: string; spendMinor: bigint; impressions: number; clicks: number; conversions: number; valueMinor: bigint; window: string }>>;
  validateDraft(accountRef: string, draft: CampaignDraft): Promise<{ valid: boolean; issues: string[]; validatedBy: "provider" | "unavailable" }>;
  createPausedCampaign(accountRef: string, draft: CampaignDraft, operationId: string): Promise<{ externalId: string }>;
  updateBudget(accountRef: string, campaignExternalId: string, dailyBudgetMinor: bigint, operationId: string): Promise<void>;
  pause(accountRef: string, campaignExternalId: string): Promise<void>;
  sendConversion(accountRef: string, event: { eventId: string; name: string; occurredAt: string; valueMinor?: bigint; currency?: string }): Promise<void>;
}

export class AdsAccessRequiredError extends Error {
  readonly code = "access_required";
}

/**
 * OpenAI Ads adapter: advertiser API anahtarı tenant account secret'ıdır (genel OPENAI_API_KEY değil).
 * Canlı hesap/capability testi yapılmadan tüm yazma çağrıları access_required döner.
 */
export function openAiAdsAdapter(): AdsAdapter {
  const denied = async (): Promise<never> => {
    throw new AdsAccessRequiredError("OpenAI Ads hesabı bağlı değil veya erişim doğrulanmadı");
  };
  return {
    provider: "openai_ads",
    getCapabilities: async () => ({ capabilities: [], country: null, currency: null, policyVersion: null, lastVerifiedAt: null, accessStatus: "access_required" }),
    validateAccount: async () => ({ ok: false, reason: "access_required" }),
    listCampaigns: denied,
    getInsights: denied,
    validateDraft: async () => ({ valid: false, issues: ["Sağlayıcı validasyonu için bağlı ve doğrulanmış hesap gerekli; draft'ı CSV olarak dışa aktarabilirsiniz"], validatedBy: "unavailable" }),
    createPausedCampaign: denied,
    updateBudget: denied,
    pause: denied,
    sendConversion: denied,
  };
}
