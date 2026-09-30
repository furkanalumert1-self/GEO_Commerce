import { z } from "zod";
import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { brandRoute, parseQuery } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { toHtml, toMarkdown, type ActionContent } from "@/modules/actions/workflow";

const q = z.object({ format: z.enum(["html", "md", "json"]).default("md"), versionId: z.string().uuid().optional() });

export const GET = brandRoute<{ w: string; b: string; id: string }>(async ({ req, params, access }) => {
  assertCan(access, "export");
  const { format, versionId } = parseQuery(req, q);
  const a = await db.action.findFirst({ where: { id: params.id, workspaceId: access.workspaceId, brandId: access.brandId } });
  if (!a) throw notFound("Aksiyon");
  const v = await db.actionVersion.findFirst({ where: { actionId: a.id, id: versionId ?? a.currentVersionId ?? undefined } });
  if (!v) throw notFound("Sürüm");
  const c = v.content as unknown as ActionContent;
  const body = format === "html" ? toHtml(c) : format === "json" ? JSON.stringify(c, null, 2) : toMarkdown(c);
  const type = format === "html" ? "text/html" : format === "json" ? "application/json" : "text/markdown";
  return new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "content-disposition": `attachment; filename="action-${a.id.slice(0, 8)}-v${v.number}.${format}"`, "x-content-type-options": "nosniff" } });
});
