import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { hasFeature } from "@/modules/billing/plans";
import { csvRow } from "@/modules/reports/csv";
import { buildChatgptAdsPlan } from "@/modules/ads/chatgpt-plan";

/** GET ?format=json|csv&usp1=&usp2= — ChatGPT Ads kampanya planı (rakip analizi, reklam grupları, bütçe). */
export const GET = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "ads.draft");
  if (!hasFeature(access.entitlements, "ads")) throw new AppError("plan_required", "Ads modülü Commerce ve üzeri paketlerde");
  const u = new URL(req.url);
  const usps = [u.searchParams.get("usp1"), u.searchParams.get("usp2")].filter((x): x is string => Boolean(x)).map((x) => x.slice(0, 40));
  const plan = await buildChatgptAdsPlan(db, { workspaceId: access.workspaceId, brandId: access.brandId }, { usps });
  if (u.searchParams.get("format") === "csv") {
    const rows = [csvRow(["ad_group", "priority", "lost_to", "context_hints", "competitor_context", "title_1", "body_1", "title_2", "body_2", "title_3", "body_3"])];
    // Bütçe/TBM sütunları yok: doğrulanmış hesap verisi olmadan tahmin, veri gibi dışa aktarılmaz.
    for (const g of plan.adGroups) {
      rows.push(csvRow([g.label, g.priority, g.lostTo.map((c) => `${c.name}:${c.count}`).join(" "), g.hints.join(" | "), g.competitorHints.join(" | "), ...g.copies.flatMap((c) => [c.title, c.body])]));
    }
    return new NextResponse(rows.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="chatgpt-ads-plan.csv"`, "x-request-id": requestId } });
  }
  return json(plan, { requestId });
});
