import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/http/errors";
import { json, readJson, route } from "@/lib/http/api";
import { isUuid } from "@/modules/tenancy/access";
import { requirePlatformAdmin } from "../../../guard";

const body = z.object({ days: z.number().int().min(1).max(30).default(7), reason: z.string().trim().min(5).max(200) });

/**
 * Platform admin: gerçek (demo olmayan) workspace'e süreli test erişimi — teşhis ve Fix with AI (sınırlı
 * üretim kotası). Ödeme sağlayıcısı devreye alınmadan önce uçtan uca doğrulama içindir; mevcut sözleşme
 * override alanını kullanır (aboneliği yoksa süreli Starter denemesi açar), süresi dolunca kendiliğinden kalkar, audit log'a gerekçeyle yazılır.
 */
export const POST = route<{ id: string }>(async ({ req, params, requestId }) => {
  const admin = await requirePlatformAdmin(req);
  if (!isUuid(params.id)) throw notFound("Workspace");
  const input = await readJson(req, body);
  const ws = await db.workspace.findUnique({ where: { id: params.id }, include: { subscription: true } });
  if (!ws) throw notFound("Workspace");
  if (ws.isDemo) throw new AppError("conflict", "Demo çalışma alanına test erişimi verilmez");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.days * 86_400_000);
  // Aynı kullanıcının ikinci çalışma alanı deneme almaz; test için süreli Starter denemesi açılır (audit log'a yazılır).
  const createdTrial = !ws.subscription;
  if (createdTrial) {
    await db.subscription.create({ data: { workspaceId: ws.id, planKey: "starter", status: "trialing", currentPeriodStart: now, currentPeriodEnd: expiresAt, trialEnd: expiresAt } });
  }
  await db.subscription.update({
    where: { workspaceId: ws.id },
    data: { overrideLimits: { features: ["diagnosis", "fix_with_ai"], fixUnits: 20, opportunityDetail: 50 }, overrideExpiresAt: expiresAt, overrideReason: input.reason },
  });
  await db.auditLog.create({ data: { workspaceId: ws.id, actorId: admin.id, actorType: "platform_admin", scope: "billing", action: "subscription.test_override", target: ws.id, reason: input.reason, requestId, beforeAfter: { days: input.days, expiresAt: expiresAt.toISOString(), createdTrial } } });
  return json({ workspaceId: ws.id, expiresAt: expiresAt.toISOString() }, { requestId });
});
