import type { PrismaClient } from "@/generated/prisma/client";
import { sha256 } from "@/lib/crypto";
import { log } from "@/lib/observability/log";
import type { BillingEvent } from "@/adapters/billing";
import { PLANS, type PlanKey } from "./plans";

/**
 * Billing webhook reconciliation (§3). İmzalı event + InboxEvent dedupe kaynak gerçekliğidir.
 * - Replay: aynı providerEventId ikinci kez işlenmez.
 * - Out-of-order: daha eski event, daha yeni durumu ezmez (lastProviderEventAt).
 * - Downgrade/cancel dönem sonunda; past_due 7 gün grace (entitlement tarafında).
 * - Fazla markalar silinmez: seçilene kadar read-only.
 */
export async function recordInbox(db: PrismaClient, provider: string, providerEventId: string, raw: string, payload: unknown): Promise<{ duplicate: boolean; id: string }> {
  try {
    const row = await db.inboxEvent.create({ data: { provider, providerEventId, rawHash: sha256(raw), payload: payload as object } });
    return { duplicate: false, id: row.id };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      const row = await db.inboxEvent.findUniqueOrThrow({ where: { provider_providerEventId: { provider, providerEventId } } });
      return { duplicate: row.processedAt !== null, id: row.id };
    }
    throw e;
  }
}

const STATUS_MAP: Record<string, "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "read_only"> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "read_only",
  incomplete: "incomplete",
  incomplete_expired: "read_only",
  paused: "read_only",
};

export async function applyBillingEvent(db: PrismaClient, evt: BillingEvent): Promise<"applied" | "ignored" | "stale"> {
  const s = evt.subscription;
  if (!s) return "ignored";
  const existing = await db.subscription.findFirst({ where: { OR: [{ subscriptionId: s.id }, ...(s.workspaceId ? [{ workspaceId: s.workspaceId }] : [])] } });
  const workspaceId = existing?.workspaceId ?? s.workspaceId;
  if (!workspaceId) {
    log.warn("billing.unmapped_subscription", { subscriptionId: s.id });
    return "ignored";
  }
  if (existing?.lastProviderEventAt && existing.lastProviderEventAt > evt.createdAt) return "stale";
  const status = STATUS_MAP[s.status] ?? "incomplete";
  const planKey: PlanKey = s.planKey ?? (existing?.planKey as PlanKey | undefined) ?? "starter";
  const pastDueSince = status === "past_due" ? (existing?.pastDueSince ?? evt.createdAt) : null;
  const data = {
    planKey,
    status,
    billingCustomerId: s.customerId,
    subscriptionId: s.id,
    currentPeriodStart: s.periodStart,
    currentPeriodEnd: s.periodEnd,
    trialEnd: s.trialEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    pastDueSince,
    lastProviderEventAt: evt.createdAt,
  };
  await db.$transaction(async (tx) => {
    if (existing) await tx.subscription.update({ where: { id: existing.id }, data });
    else await tx.subscription.create({ data: { ...data, workspaceId } });
    await enforceBrandLimit(tx as unknown as PrismaClient, workspaceId, PLANS[planKey].limits.brands);
    await tx.auditLog.create({ data: { workspaceId, actorType: "system", scope: "billing", action: `subscription.${evt.type}`, target: s.id, beforeAfter: { from: existing ? { planKey: existing.planKey, status: existing.status } : null, to: { planKey, status } } } });
  });
  return "applied";
}

/** Limit aşan markalar silinmez; en eskiler dışında kalanlar read-only olur, yükseltmede açılır. */
export async function enforceBrandLimit(db: PrismaClient, workspaceId: string, limit: number) {
  const brands = await db.brand.findMany({ where: { workspaceId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, readOnly: true } });
  const keep = new Set(brands.slice(0, limit).map((b) => b.id));
  for (const b of brands) {
    const ro = !keep.has(b.id);
    if (b.readOnly !== ro) await db.brand.update({ where: { id: b.id }, data: { readOnly: ro } });
  }
}
