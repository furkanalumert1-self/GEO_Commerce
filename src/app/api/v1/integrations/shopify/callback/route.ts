import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import { log } from "@/lib/observability/log";
import { completeShopifyConnect } from "@/modules/commerce/connect";
import { isUuid } from "@/modules/tenancy/access";

/**
 * Shopify OAuth dönüşü (GET, tarayıcı yönlendirmesi). Oturum zorunlu; imza/state/kullanıcı doğrulaması
 * serviste. Sonuç entegrasyon sayfasına sorgu parametresiyle yansıtılır; token hiçbir zaman URL'de/logda yer almaz.
 */
export async function GET(req: NextRequest) {
  const app = config().APP_URL;
  const params = req.nextUrl.searchParams;
  const integrationId = (params.get("state") ?? "").split(".")[0] ?? "";
  const back = async (q: string) => {
    const i = isUuid(integrationId) ? await db.integration.findUnique({ where: { id: integrationId }, select: { workspaceId: true, brandId: true } }) : null;
    return NextResponse.redirect(i ? `${app}/w/${i.workspaceId}/b/${i.brandId}/integrations?${q}` : `${app}/w`);
  };
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${app}/login?next=${encodeURIComponent(`/api/v1/integrations/shopify/callback?${params.toString()}`)}`);
  }
  try {
    const r = await completeShopifyConnect(db, { kind: "user", userId: session.user.id }, params);
    return NextResponse.redirect(`${app}/w/${r.workspaceId}/b/${r.brandId}/integrations?${r.ok ? "connected=shopify" : `error=${r.reason}`}`);
  } catch (e) {
    const code = e instanceof AppError ? e.code : "internal";
    log.warn("shopify.callback_rejected", { code });
    return back(`error=${code}`);
  }
}
