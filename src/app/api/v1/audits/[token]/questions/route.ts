import { z } from "zod";
import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { json, rateLimit, readJson, route } from "@/lib/http/api";
import { getAuditByToken, previewAuditQuestions, questionIssues } from "@/modules/audit/service";

const TYPES = ["manufacturer", "retailer", "brand_store", "marketplace", "service", "saas", "service_saas", "unknown"] as const;
const body = z.union([
  z.object({ action: z.literal("preview"), businessType: z.enum(TYPES).optional(), topics: z.array(z.string().trim().min(2).max(40)).max(2).optional() }),
  z.object({ action: z.literal("check"), questions: z.array(z.string().max(300)).min(1).max(5) }),
]);

/**
 * Soru onay ekranı (ücretli çağrı yok): tür/konu değişince yeni soru seti, düzenlenen sorular için kalite kontrolü.
 * Yetki: audit bağlantısındaki gizli token.
 */
export const POST = route<{ token: string }>(async ({ req, params, requestId }) => {
  const a = await getAuditByToken(db, params.token);
  if (!a) throw notFound("Audit");
  rateLimit(`audit-questions:${a.id}`, 60, 60_000);
  const input = await readJson(req, body);
  if (input.action === "preview") return json(previewAuditQuestions(a, input), { requestId });
  const brand = ((a.resultSummary as { proposal?: { brandName?: string } } | null)?.proposal?.brandName) ?? "";
  return json({ questions: input.questions.map((text) => ({ text, issues: questionIssues(text, brand) })) }, { requestId });
});
