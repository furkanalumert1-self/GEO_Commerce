import { z } from "zod";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import { json, readJson, workspaceRoute } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { getBillingAdapter, BillingNotConfiguredError } from "@/adapters/billing";

const body = z.object({ planKey: z.enum(["starter", "growth", "commerce", "agency"]) });

/** Checkout URL üretir; entitlement YALNIZ imzalı webhook ile açılır. */
export const POST = workspaceRoute(async ({ req, access, requestId }) => {
  assertCan(access, "billing.manage");
  const { planKey } = await readJson(req, body);
  const user = access.principal.userId ? await db.user.findUnique({ where: { id: access.principal.userId } }) : null;
  const app = config().APP_URL;
  try {
    const url = await getBillingAdapter().createCheckout({ workspaceId: access.workspaceId, planKey, customerEmail: user?.email ?? "", successUrl: `${app}/w/${access.workspaceId}/billing?checkout=return`, cancelUrl: `${app}/w/${access.workspaceId}/billing` });
    return json({ url }, { requestId });
  } catch (e) {
    if (e instanceof BillingNotConfiguredError) throw new AppError("not_configured", "Ödeme sağlayıcısı yapılandırılmamış; ödeme alınamaz");
    throw e;
  }
});
