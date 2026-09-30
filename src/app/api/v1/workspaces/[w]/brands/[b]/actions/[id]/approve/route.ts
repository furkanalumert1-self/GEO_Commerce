import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { approveAction } from "@/modules/actions/service";

const body = z.object({ versionId: z.string().uuid(), expectedHash: z.string().min(16).max(128) });

export const POST = brandRoute<{ w: string; b: string; id: string }>(async ({ req, params, access, requestId }) => {
  if (!access.principal.userId) throw new AppError("forbidden", "Onay yalnız kullanıcı tarafından verilebilir");
  const input = await readJson(req, body);
  const a = await approveAction(db, access, { actionId: params.id, versionId: input.versionId, expectedHash: input.expectedHash, userId: access.principal.userId });
  return json({ id: a.id, status: a.status }, { requestId });
});
