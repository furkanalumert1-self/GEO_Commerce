import Stripe from "stripe";
import { config, type AppConfig } from "@/lib/config";
import type { PlanKey } from "@/modules/billing/plans";

/**
 * Billing adapter. İmzalı webhook + event dedupe kaynak gerçekliğidir; ödeme dönüş URL'si entitlement açmaz.
 * Stripe yapılandırılmamışsa not_configured — ödeme başarısı simüle edilmez.
 */
export interface BillingEvent {
  id: string;
  type: string;
  createdAt: Date;
  subscription?: {
    id: string;
    customerId: string;
    workspaceId: string | null;
    planKey: PlanKey | null;
    status: string;
    periodStart: Date;
    periodEnd: Date;
    cancelAtPeriodEnd: boolean;
    trialEnd: Date | null;
  };
}

export interface BillingAdapter {
  status(): "ready" | "not_configured";
  createCheckout(input: { workspaceId: string; planKey: PlanKey; customerEmail: string; successUrl: string; cancelUrl: string }): Promise<string>;
  createPortal(input: { customerId: string; returnUrl: string }): Promise<string>;
  parseWebhook(raw: string, signature: string | null): BillingEvent;
}

export class BillingNotConfiguredError extends Error {
  readonly code = "not_configured";
}

function priceFor(cfg: AppConfig, plan: PlanKey): string | undefined {
  return {
    starter: cfg.STRIPE_PRICE_STARTER,
    growth: cfg.STRIPE_PRICE_GROWTH,
    commerce: cfg.STRIPE_PRICE_COMMERCE,
    agency: cfg.STRIPE_PRICE_AGENCY,
  }[plan as "starter"];
}

function planForPrice(cfg: AppConfig, priceId: string | undefined): PlanKey | null {
  if (!priceId) return null;
  const map: Array<[string | undefined, PlanKey]> = [
    [cfg.STRIPE_PRICE_STARTER, "starter"],
    [cfg.STRIPE_PRICE_GROWTH, "growth"],
    [cfg.STRIPE_PRICE_COMMERCE, "commerce"],
    [cfg.STRIPE_PRICE_AGENCY, "agency"],
  ];
  return map.find(([p]) => p === priceId)?.[1] ?? null;
}

export function getBillingAdapter(cfg: AppConfig = config()): BillingAdapter {
  if (!cfg.STRIPE_SECRET_KEY || !cfg.STRIPE_WEBHOOK_SECRET) {
    const nc = async (): Promise<never> => {
      throw new BillingNotConfiguredError("Ödeme sağlayıcısı yapılandırılmamış");
    };
    return {
      status: () => "not_configured",
      createCheckout: nc,
      createPortal: nc,
      parseWebhook: () => {
        throw new BillingNotConfiguredError("Ödeme sağlayıcısı yapılandırılmamış");
      },
    };
  }
  const stripe = new Stripe(cfg.STRIPE_SECRET_KEY);
  return {
    status: () => "ready",
    async createCheckout({ workspaceId, planKey, customerEmail, successUrl, cancelUrl }) {
      const price = priceFor(cfg, planKey);
      if (!price) throw new BillingNotConfiguredError(`${planKey} için fiyat ID tanımlı değil`);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price, quantity: 1 }],
        customer_email: customerEmail,
        client_reference_id: workspaceId,
        subscription_data: { metadata: { workspaceId, planKey } },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      if (!session.url) throw new Error("Checkout URL alınamadı");
      return session.url;
    },
    async createPortal({ customerId, returnUrl }) {
      const s = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return s.url;
    },
    parseWebhook(raw, signature) {
      if (!signature) throw new Error("İmza yok");
      const evt = stripe.webhooks.constructEvent(raw, signature, cfg.STRIPE_WEBHOOK_SECRET!);
      const out: BillingEvent = { id: evt.id, type: evt.type, createdAt: new Date(evt.created * 1000) };
      if (evt.type.startsWith("customer.subscription.")) {
        const s = evt.data.object as Stripe.Subscription;
        const item = s.items.data[0];
        const periodStart = (item as unknown as { current_period_start?: number })?.current_period_start ?? s.start_date;
        const periodEnd = (item as unknown as { current_period_end?: number })?.current_period_end ?? s.start_date;
        out.subscription = {
          id: s.id,
          customerId: typeof s.customer === "string" ? s.customer : s.customer.id,
          workspaceId: (s.metadata?.workspaceId as string | undefined) ?? null,
          planKey: planForPrice(cfg, item?.price.id),
          status: s.status,
          periodStart: new Date(periodStart * 1000),
          periodEnd: new Date(periodEnd * 1000),
          cancelAtPeriodEnd: s.cancel_at_period_end,
          trialEnd: s.trial_end ? new Date(s.trial_end * 1000) : null,
        };
      }
      return out;
    },
  };
}
