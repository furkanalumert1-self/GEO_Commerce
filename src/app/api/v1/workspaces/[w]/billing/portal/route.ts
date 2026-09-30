import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import { json, workspaceRoute } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { getBillingAdapter, BillingNotConfiguredError } from "@/adapters/billing";

export const POST = workspaceRoute(async ({ access, requestId }) => {
  assertCan(access, "billing.manage");
  const sub = await db.subscription.findUnique({ where: { workspaceId: access.workspaceId } });
  if (!sub?.billingCustomerId) throw new AppError("conflict", "Henüz ödeme müşterisi oluşturulmadı");
  try {
    const url = await getBillingAdapter().createPortal({ customerId: sub.billingCustomerId, returnUrl: `${config().APP_URL}/w/${access.workspaceId}/billing` });
    return json({ url }, { requestId });
  } catch (e) {
    if (e instanceof BillingNotConfiguredError) throw new AppError("not_configured", "Ödeme sağlayıcısı yapılandırılmamış");
    throw e;
  }
});
