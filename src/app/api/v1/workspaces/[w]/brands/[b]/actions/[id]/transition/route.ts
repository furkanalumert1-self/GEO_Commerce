import { z } from "zod";
import { db } from "@/lib/db";
import { brandRoute, json, readJson } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { transitionAction } from "@/modules/actions/service";

/** Durum geçişleri: incelemeye gönder, reddet, taslağa dön, manuel yayın sonrası ölçüme al, tamamla. */
const body = z.object({ to: z.enum(["review", "draft", "rejected", "measuring", "completed"]) });

export const POST = brandRoute<{ w: string; b: string; id: string }>(async ({ req, params, access, requestId }) => {
  const { to } = await readJson(req, body);
  assertCan(access, to === "rejected" || to === "measuring" || to === "completed" ? "actions.approve" : "actions.draft");
  const a = await transitionAction(db, access, params.id, to, access.principal.userId);
  return json({ id: a.id, status: a.status }, { requestId });
});
