/**
 * Ads bounded automation guard (§7.3). Ürün varsayılanları: max günlük ±%10 bütçe değişimi,
 * 24 saat cooldown, rolling spend cap, minimum örneklem, kill switch. Her şey fail-closed.
 * Ülke/bütçe/karakter/policy sınırları SABİT DEĞİL; sağlayıcı validasyonundan gelir.
 */
export type AdsCapability = "read" | "conversion_send" | "campaign_write" | "budget_write";
export type AutomationLevel = "off" | "recommendations" | "approval_required" | "bounded_rules";

export interface AdsRuleConfig {
  maxDailyChangePct: number; // varsayılan 10
  cooldownHours: number; // varsayılan 24
  rollingSpendCapMinor: bigint; // 7 günlük
  minConversions: number;
  attributionDelayHours: number;
  targetRoas?: number;
}

export const DEFAULT_RULE: AdsRuleConfig = {
  maxDailyChangePct: 10,
  cooldownHours: 24,
  rollingSpendCapMinor: 0n,
  minConversions: 30,
  attributionDelayHours: 72,
};

export interface BudgetChangeInput {
  level: AutomationLevel;
  killSwitch: boolean;
  capabilities: AdsCapability[];
  accessStatus: "access_required" | "active" | "revoked";
  currentDailyMinor: bigint;
  proposedDailyMinor: bigint;
  rolling7dSpendMinor: bigint;
  lastChangeAt: Date | null;
  conversionsInWindow: number;
  approved: boolean;
  approvalRevoked: boolean;
  now: Date;
  rule: AdsRuleConfig;
}

export type Decision =
  | { allowed: true; mode: "execute" | "recommend_only" }
  | { allowed: false; reason: string };

export function evaluateBudgetChange(i: BudgetChangeInput): Decision {
  if (i.killSwitch) return { allowed: false, reason: "kill_switch_active" };
  if (i.accessStatus !== "active") return { allowed: false, reason: "access_required" };
  if (!i.capabilities.includes("budget_write")) return { allowed: false, reason: "capability_missing:budget_write" };
  if (i.level === "off") return { allowed: false, reason: "automation_off" };
  if (i.approvalRevoked) return { allowed: false, reason: "approval_revoked" };
  if (i.currentDailyMinor <= 0n) return { allowed: false, reason: "invalid_current_budget" };

  const deltaPct = (Number(i.proposedDailyMinor - i.currentDailyMinor) / Number(i.currentDailyMinor)) * 100;
  if (Math.abs(deltaPct) > i.rule.maxDailyChangePct + 1e-9) return { allowed: false, reason: "exceeds_max_daily_change" };
  if (i.lastChangeAt && i.now.getTime() - i.lastChangeAt.getTime() < i.rule.cooldownHours * 3_600_000) {
    return { allowed: false, reason: "cooldown_active" };
  }
  const increasing = i.proposedDailyMinor > i.currentDailyMinor;
  if (increasing && i.rule.rollingSpendCapMinor > 0n) {
    const projected = i.rolling7dSpendMinor + i.proposedDailyMinor;
    if (projected > i.rule.rollingSpendCapMinor) return { allowed: false, reason: "rolling_spend_cap" };
  }
  if (i.level === "recommendations") return { allowed: true, mode: "recommend_only" };
  // Düşük örneklemde hedef ROAS kuralı yalnız öneri.
  const lowSample = i.conversionsInWindow < i.rule.minConversions;
  if (i.level === "approval_required") {
    if (!i.approved) return { allowed: false, reason: "approval_required" };
    return { allowed: true, mode: "execute" };
  }
  // bounded_rules
  if (lowSample) return { allowed: true, mode: "recommend_only" };
  if (increasing && !i.approved) return { allowed: false, reason: "increase_requires_approval" };
  return { allowed: true, mode: "execute" };
}

/** Kampanya oluşturma: her zaman paused, onay + capability zorunlu. */
export function evaluateCreateCampaign(i: {
  accessStatus: "access_required" | "active" | "revoked";
  capabilities: AdsCapability[];
  killSwitch: boolean;
  approved: boolean;
  approvalRevoked: boolean;
  existingOperation: { status: string } | null;
}): Decision {
  if (i.killSwitch) return { allowed: false, reason: "kill_switch_active" };
  if (i.accessStatus !== "active") return { allowed: false, reason: "access_required" };
  if (!i.capabilities.includes("campaign_write")) return { allowed: false, reason: "capability_missing:campaign_write" };
  if (!i.approved || i.approvalRevoked) return { allowed: false, reason: "approval_required" };
  if (i.existingOperation && ["executing", "succeeded"].includes(i.existingOperation.status)) {
    return { allowed: false, reason: "duplicate_operation" };
  }
  return { allowed: true, mode: "execute" };
}
