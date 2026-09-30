import { z } from "zod";
import { db } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { saveActionVersion } from "@/modules/actions/service";
import { actionContentSchema } from "@/modules/actions/generator";

type P = { w: string; b: string; id: string };

export const GET = brandRoute<P>(async ({ params, access, requestId }) => {
  const a = await db.action.findFirst({ where: { id: params.id, workspaceId: access.workspaceId, brandId: access.brandId }, include: { versions: { orderBy: { number: "desc" } }, approvals: true } });
  if (!a) throw notFound("Aksiyon");
  return json(a, { requestId });
});

const body = z.object({ version: z.number().int().min(0), content: actionContentSchema });

/** If-Match benzeri: `version` alanı eşleşmezse 409. */
export const PATCH = brandRoute<P>(async ({ req, params, access, requestId }) => {
  const input = await readJson(req, body);
  const a = await saveActionVersion(db, access, { actionId: params.id, expectedVersion: input.version, content: input.content as never, userId: access.principal.userId });
  return json({ id: a.id, version: a.version, currentVersionId: a.currentVersionId, status: a.status }, { requestId });
});
