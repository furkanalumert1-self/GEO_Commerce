import type { PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import { AppError } from "@/lib/http/errors";
import type { NormalizedOrder } from "@/adapters/commerce/types";
import { attributeFirstTouch, attributeLastNonDirect, classifyChannel, isAiChannel, isNewSession, netRevenueMinor, FIRST_TOUCH, LAST_NON_DIRECT, type Touch } from "@/modules/attribution/engine";

/**
 * Commerce Conversion Hub: sipariş upsert (tek canonical row), out-of-order koruması, iade restate,
 * tracker event ingest ve attribution. Browser purchase tutarı kaynak gerçekliği değildir.
 */

export async function upsertOrder(db: PrismaClient, ids: { workspaceId: string; brandId: string; connectorId: string }, o: NormalizedOrder) {
  const items = o.items.reduce((s, i) => s + i.unitPriceMinor * BigInt(i.quantity), 0n);
  const itemDiscount = o.items.reduce((s, i) => s + i.discountMinor, 0n);
  const refunded = o.refunds.reduce((s, r) => s + r.amountMinor, 0n);
  const net = netRevenueMinor({ itemsMinor: items, discountMinor: itemDiscount + o.discountMinor, refundedItemsMinor: refunded, status: o.status });
  const key = { workspaceId_connectorId_externalOrderId: { workspaceId: ids.workspaceId, connectorId: ids.connectorId, externalOrderId: o.externalOrderId } };
  return db.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: key });
    // Out-of-order webhook: daha eski sürüm mevcut kaydı ezmez.
    if (existing?.sourceVersion && existing.sourceVersion > o.updatedAt) return { order: existing, applied: false };
    const data = {
      status: o.status,
      paidAt: o.paidAt,
      currency: o.currency,
      grossMinor: items,
      discountMinor: itemDiscount + o.discountMinor,
      taxMinor: o.taxMinor,
      shippingMinor: o.shippingMinor,
      refundedMinor: refunded,
      netMinor: net,
      anonymousId: o.anonymousId,
      sessionRef: o.sessionRef,
      sourceVersion: o.updatedAt,
    };
    const order = existing
      ? await tx.order.update({ where: { id: existing.id }, data })
      : await tx.order.create({ data: { ...data, workspaceId: ids.workspaceId, brandId: ids.brandId, connectorId: ids.connectorId, externalOrderId: o.externalOrderId } });
    if (!existing) {
      await tx.orderItem.createMany({
        data: o.items.map((i) => ({ workspaceId: ids.workspaceId, orderId: order.id, productExternalId: i.productExternalId, variantExternalId: i.variantExternalId, name: i.name, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, discountMinor: i.discountMinor })),
      });
    }
    for (const r of o.refunds) {
      await tx.refund.upsert({
        where: { orderId_externalId: { orderId: order.id, externalId: r.externalId } },
        update: { amountMinor: r.amountMinor, refundedAt: r.refundedAt },
        create: { workspaceId: ids.workspaceId, orderId: order.id, externalId: r.externalId, amountMinor: r.amountMinor, refundedAt: r.refundedAt },
      });
    }
    // Net değişirse mevcut attribution satırları restate edilir.
    await tx.attribution.updateMany({ where: { orderId: order.id }, data: { netMinor: net, computedAt: new Date() } });
    return { order, applied: true };
  });
}

export const trackerEventSchema = z.object({
  eventId: z.string().min(8).max(64),
  type: z.enum(["page_view", "product_view", "add_to_cart", "checkout_started", "purchase"]),
  occurredAt: z.string().datetime({ offset: true }),
  anonymousId: z.string().max(64).optional(),
  sessionId: z.string().max(64).optional(),
  orderId: z.string().max(64).optional(),
  productIds: z.array(z.string().max(64)).max(50).default([]),
  valueMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  referrer: z.string().max(500).optional(),
  landingPath: z.string().max(300).optional(),
  utm: z.object({ source: z.string().max(80).optional(), medium: z.string().max(80).optional(), campaign: z.string().max(120).optional() }).optional(),
  clickIds: z.array(z.string().max(20)).max(5).optional(),
  consent: z.object({ analytics: z.boolean(), ads: z.boolean() }),
});

export const eventsBatchSchema = z.object({ siteKey: z.string().min(8).max(64), events: z.array(trackerEventSchema).min(1).max(50), schemaVersion: z.literal(1) });

/** URL query allowlist: yalnız utm ve bilinen click-id adları; path'ten query atılır. */
export function sanitizeLandingPath(p: string | undefined): string | null {
  if (!p) return null;
  return p.split("?")[0]!.split("#")[0]!.slice(0, 300);
}

export async function ingestEvents(db: PrismaClient, input: z.infer<typeof eventsBatchSchema>, origin: string | null) {
  const brand = await db.brand.findUnique({ where: { trackerSiteKey: input.siteKey } });
  if (!brand) throw new AppError("not_found", "Geçersiz site anahtarı");
  if (origin) {
    const host = (() => {
      try {
        return new URL(origin).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    })();
    if (host !== brand.domain && !host.endsWith(`.${brand.domain}`)) throw new AppError("forbidden", "Origin izinli değil");
  }
  let accepted = 0;
  const now = new Date();
  for (const e of input.events) {
    let refHost: string | null = null;
    try {
      refHost = e.referrer ? new URL(e.referrer).hostname.toLowerCase() : null;
    } catch {
      refHost = null;
    }
    try {
      await db.event.create({
        data: {
          workspaceId: brand.workspaceId,
          brandId: brand.id,
          externalEventId: e.eventId,
          source: "browser",
          type: e.type,
          occurredAt: new Date(e.occurredAt),
          receivedAt: now,
          anonymousId: e.consent.analytics ? (e.anonymousId ?? null) : null,
          sessionId: e.consent.analytics ? (e.sessionId ?? null) : null,
          orderRef: e.orderId ?? null,
          productIds: e.productIds,
          valueMinor: e.valueMinor !== undefined ? BigInt(e.valueMinor) : null,
          currency: e.currency ?? null,
          referrerHost: refHost,
          landingPath: sanitizeLandingPath(e.landingPath),
          utm: e.utm ?? undefined,
          consent: e.consent,
          schemaVersion: input.schemaVersion,
        },
      });
      accepted++;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") continue; // aynı eventId → dedupe
      throw err;
    }
    // Consent varsa pseudonymous session/touchpoint kaydı (30 dk inactivity).
    if (e.consent.analytics && e.sessionId && (e.type === "page_view" || e.type === "product_view")) {
      const occurred = new Date(e.occurredAt);
      const existing = await db.visitorSession.findUnique({ where: { brandId_externalSessionId: { brandId: brand.id, externalSessionId: e.sessionId } } });
      const channel = classifyChannel({ referrerHost: refHost, utm: e.utm, clickIds: e.clickIds, ownHost: brand.domain });
      if (!existing) {
        const s = await db.visitorSession.create({ data: { workspaceId: brand.workspaceId, brandId: brand.id, anonymousId: e.anonymousId ?? null, externalSessionId: e.sessionId, startedAt: occurred, lastSeenAt: occurred, consent: e.consent } });
        await db.touchpoint.create({ data: { workspaceId: brand.workspaceId, brandId: brand.id, sessionId: s.id, anonymousId: e.anonymousId ?? null, occurredAt: occurred, channel, referrerHost: refHost, landingPath: sanitizeLandingPath(e.landingPath), utm: e.utm ?? undefined } });
      } else {
        if (isNewSession(existing.lastSeenAt, occurred) && channel !== "direct") {
          await db.touchpoint.create({ data: { workspaceId: brand.workspaceId, brandId: brand.id, sessionId: existing.id, anonymousId: e.anonymousId ?? null, occurredAt: occurred, channel, referrerHost: refHost, landingPath: sanitizeLandingPath(e.landingPath), utm: e.utm ?? undefined } });
        }
        await db.visitorSession.update({ where: { id: existing.id }, data: { lastSeenAt: occurred } });
      }
    }
  }
  return { accepted, received: input.events.length };
}

/** Sipariş attribution (her iki model). Order başına model başına tek satır. */
export async function attributeOrders(db: PrismaClient, workspaceId: string, brandId: string) {
  const orders = await db.order.findMany({ where: { workspaceId, brandId, paidAt: { not: null } } });
  let n = 0;
  for (const o of orders) {
    const touches: Touch[] = o.anonymousId
      ? (
          await db.touchpoint.findMany({ where: { workspaceId, brandId, anonymousId: o.anonymousId }, include: { session: { select: { consent: true } } } })
        ).map((t) => ({ id: t.id, occurredAt: t.occurredAt, channel: t.channel, consent: Boolean((t.session.consent as { analytics?: boolean }).analytics) }))
      : [];
    const input = { id: o.id, paidAt: o.paidAt!, netMinor: o.netMinor, currency: o.currency, touches };
    for (const r of [attributeLastNonDirect(input), attributeFirstTouch(input)]) {
      await db.attribution.upsert({
        where: { orderId_modelVersion: { orderId: o.id, modelVersion: r.modelVersion } },
        update: { touchpointId: r.touchpointId, channel: r.channel, netMinor: r.netMinor, currency: r.currency, computedAt: new Date() },
        create: { workspaceId, orderId: o.id, modelVersion: r.modelVersion, touchpointId: r.touchpointId, channel: r.channel, windowDays: r.windowDays, netMinor: r.netMinor, currency: r.currency, computedAt: new Date() },
      });
      n++;
    }
  }
  return n;
}

export async function revenueSummary(db: PrismaClient, workspaceId: string, brandId: string, f: { from: Date; to: Date; model?: string }) {
  const model = f.model === FIRST_TOUCH ? FIRST_TOUCH : LAST_NON_DIRECT;
  const rows = await db.attribution.findMany({
    where: { workspaceId, modelVersion: model, order: { brandId, paidAt: { gte: f.from, lte: f.to } } },
    include: { order: { select: { id: true, externalOrderId: true, paidAt: true, status: true, grossMinor: true, refundedMinor: true, netMinor: true, currency: true, anonymousId: true } } },
    orderBy: { order: { paidAt: "desc" } },
  });
  const byChannel = new Map<string, { orders: number; net: Record<string, bigint> }>();
  for (const r of rows) {
    const c = byChannel.get(r.channel) ?? { orders: 0, net: {} };
    c.orders++;
    c.net[r.currency] = (c.net[r.currency] ?? 0n) + r.order.netMinor;
    byChannel.set(r.channel, c);
  }
  const ai = rows.filter((r) => isAiChannel(r.channel));
  const aiNet: Record<string, bigint> = {};
  for (const r of ai) aiNet[r.currency] = (aiNet[r.currency] ?? 0n) + r.order.netMinor;
  const aiSessions = await db.touchpoint.count({ where: { workspaceId, brandId, occurredAt: { gte: f.from, lte: f.to }, channel: { startsWith: "ai_organic:" } } });
  const totalOrders = rows.length;
  const withConsentMatch = rows.filter((r) => r.channel !== "unattributed").length;
  return {
    model,
    asOf: new Date().toISOString(),
    aiOrders: ai.length,
    aiNetByCurrency: aiNet,
    aiSessions,
    aiCvr: aiSessions > 0 ? ai.length / aiSessions : null,
    attributionCoverage: totalOrders > 0 ? withConsentMatch / totalOrders : null,
    unattributed: rows.filter((r) => r.channel === "unattributed").length,
    channels: [...byChannel.entries()].map(([channel, v]) => ({ channel, orders: v.orders, netByCurrency: v.net, ai: isAiChannel(channel) })),
    orders: rows.slice(0, 50).map((r) => ({ ...r.order, channel: r.channel })),
  };
}
