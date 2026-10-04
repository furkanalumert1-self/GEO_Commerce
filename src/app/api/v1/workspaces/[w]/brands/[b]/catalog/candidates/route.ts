import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { importCandidates, listCandidates, previewProductUrl } from "@/modules/catalog/candidates";

/** GET: taramada bulunan ürün adayları ve durumları (katalog değişmez). */
export const GET = brandRoute(async ({ access, requestId }) => {
  assertCan(access, "brand.manage");
  const summary = await listCandidates(db, { workspaceId: access.workspaceId, brandId: access.brandId });
  return json(summary, { requestId });
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), url: z.string().trim().min(8).max(2000) }),
  z.object({ action: z.literal("import"), urls: z.array(z.string().trim().min(8).max(2000)).min(1).max(500) }),
]);

/**
 * POST preview: tek ürün bağlantısını doğrular ve çıkarır (yazma yok).
 * POST import: seçilen adayları kataloğa aktarır (mevcut veriyi boş alanla ezmez, mükerrer oluşturmaz).
 */
export const POST = brandRoute(async ({ req, access, requestId }) => {
  assertCan(access, "brand.manage");
  const input = await readJson(req, body);
  if (input.action === "preview") {
    const r = await previewProductUrl(input.url, access.brand.domain);
    return json({ candidate: r.candidate ? { ...r.candidate, priceMinor: r.candidate.priceMinor?.toString() ?? null } : null, reason: r.reason }, { requestId });
  }
  const r = await importCandidates(db, { workspaceId: access.workspaceId, brandId: access.brandId }, input.urls, { brandDomain: access.brand.domain, catalogLimit: access.entitlements.catalogProducts });
  return json(r, { status: 201, requestId });
});
