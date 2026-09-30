import { createPrismaClient } from "@/lib/db";
import { randomToken } from "@/lib/crypto";

export const db = createPrismaClient(process.env.TEST_DATABASE_URL);

export async function makeTenant(planKey: "starter" | "growth" | "commerce" | "agency" = "commerce") {
  const suffix = randomToken(6).toLowerCase();
  const user = await db.user.create({ data: { email: `u-${suffix}@test.example`, emailVerified: new Date() } });
  const now = new Date();
  const ws = await db.workspace.create({
    data: {
      name: `WS ${suffix}`, slug: `ws-${suffix}`, ownerId: user.id,
      memberships: { create: { userId: user.id, role: "owner", isApprover: true } },
      subscription: { create: { planKey, status: "active", currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) } },
    },
  });
  const brand = await db.brand.create({ data: { workspaceId: ws.id, domain: `b-${suffix}.example`, name: `Brand ${suffix}`, aliases: [] } });
  return { user, ws, brand };
}
