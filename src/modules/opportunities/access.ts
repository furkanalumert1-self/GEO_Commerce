import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/lib/http/errors";
import type { BrandAccess } from "@/modules/tenancy/access";

/**
 * Paket kapısı: Starter ilk 10 fırsatın detayını görür (skora göre); kilitli fırsatların payload'ı
 * tarayıcıya gönderilmez. Sıralama sunucuda sabit: score desc, createdAt asc.
 */
export async function unlockedOpportunityIds(db: PrismaClient, access: BrandAccess): Promise<Set<string> | "all"> {
  const d = access.entitlements.opportunityDetail;
  if (d === "all") return "all";
  if (d === 0) return new Set();
  const rows = await db.opportunity.findMany({
    where: { workspaceId: access.workspaceId, brandId: access.brandId },
    orderBy: [{ score: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
    take: d,
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export async function assertOpportunityUnlocked(db: PrismaClient, access: BrandAccess, id: string) {
  const u = await unlockedOpportunityIds(db, access);
  if (u !== "all" && !u.has(id)) throw new AppError("plan_required", "Bu fırsatın detayı paketinizde kilitli", { requiredPlan: "growth" });
}
