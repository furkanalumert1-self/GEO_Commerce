import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { hashToken, randomToken } from "@/lib/crypto";
import { json, readJson, workspaceRoute } from "@/lib/http/api";
import { assertCan } from "@/modules/tenancy/access";
import { hasFeature } from "@/modules/billing/plans";

export const GET = workspaceRoute(async ({ access, requestId }) => {
  assertCan(access, "apikeys.manage");
  const keys = await db.apiKey.findMany({ where: { workspaceId: access.workspaceId }, select: { id: true, name: true, last4: true, scopes: true, brandScope: true, createdAt: true, expiresAt: true, revokedAt: true, lastUsedAt: true }, orderBy: { createdAt: "desc" } });
  return json(keys, { requestId });
});

const body = z.object({ name: z.string().trim().min(2).max(60), scopes: z.array(z.enum(["brand:read", "export:read", "runs:write", "prompts:write"])).min(1), brandIds: z.array(z.string().uuid()).max(50).default([]), expiresInDays: z.number().int().min(1).max(365).optional() });

/** Anahtar yalnız bir kez döner; DB'de hash + son 4 karakter. */
export const POST = workspaceRoute(async ({ req, access, requestId }) => {
  assertCan(access, "apikeys.manage");
  if (!hasFeature(access.entitlements, "public_api")) throw new AppError("plan_required", "Public API Commerce ve üzeri paketlerde", { requiredPlan: "commerce" });
  const input = await readJson(req, body);
  if (input.brandIds.length) {
    const n = await db.brand.count({ where: { id: { in: input.brandIds }, workspaceId: access.workspaceId } });
    if (n !== input.brandIds.length) throw new AppError("validation_error", "Geçersiz marka kapsamı");
  }
  const key = `gc_${randomToken(28)}`;
  const k = await db.apiKey.create({ data: { workspaceId: access.workspaceId, name: input.name, keyHash: hashToken(key), last4: key.slice(-4), scopes: input.scopes, brandScope: input.brandIds, expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null } });
  await db.auditLog.create({ data: { workspaceId: access.workspaceId, actorId: access.principal.userId, actorType: "user", scope: "apikeys", action: "apikey.created", target: k.id } });
  return json({ id: k.id, key, last4: k.last4, note: "Bu anahtar yalnız şimdi gösterilir." }, { status: 201, requestId });
});
