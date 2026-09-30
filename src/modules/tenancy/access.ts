import type { PrismaClient } from "@/generated/prisma/client";
import { AppError, notFound } from "@/lib/http/errors";
import { can, hasWorkspaceWideBrandAccess, type Permission, type Role } from "@/lib/permissions";
import { resolveEntitlements, type Entitlements, type PlanKey } from "@/modules/billing/plans";

/**
 * Tenant erişim çözümü — her query/mutation/job/export/share bununla başlar.
 * Başka tenant'ın varlığı açığa çıkmasın diye erişim yoksa 404 döner.
 */
export interface Principal {
  kind: "user" | "api_key";
  userId: string | null;
  apiKeyId?: string;
  scopes?: string[];
  brandScope?: string[];
}

export interface WorkspaceAccess {
  principal: Principal;
  workspaceId: string;
  role: Role;
  isApprover: boolean;
  membershipId: string | null;
  entitlements: Entitlements;
  isDemo: boolean;
  brandIds: string[] | "all";
}

export interface BrandAccess extends WorkspaceAccess {
  brandId: string;
  brandRole: Role;
  brand: { id: string; name: string; domain: string; timezone: string; currency: string; country: string; language: string; readOnly: boolean };
}

const API_KEY_ROLE: Role = "analyst";

export async function resolveWorkspaceAccess(db: PrismaClient, principal: Principal, workspaceId: string): Promise<WorkspaceAccess> {
  if (!isUuid(workspaceId)) throw notFound("Workspace");
  const ws = await db.workspace.findFirst({
    where: { id: workspaceId, status: { not: "deleting" } },
    include: { subscription: true },
  });
  if (!ws) throw notFound("Workspace");

  let role: Role;
  let isApprover = false;
  let membershipId: string | null = null;
  let brandIds: string[] | "all" = "all";

  if (principal.kind === "user") {
    if (!principal.userId) throw new AppError("unauthenticated", "Oturum gerekli");
    const m = await db.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: principal.userId } },
      include: { grants: true },
    });
    if (!m) throw notFound("Workspace");
    role = m.role;
    isApprover = m.isApprover;
    membershipId = m.id;
    if (!hasWorkspaceWideBrandAccess(role)) brandIds = m.grants.map((g) => g.brandId);
  } else {
    role = API_KEY_ROLE;
    brandIds = principal.brandScope && principal.brandScope.length > 0 ? principal.brandScope : "all";
  }

  const sub = ws.subscription;
  const entitlements = resolveEntitlements(
    sub
      ? {
          planKey: sub.planKey as PlanKey,
          status: sub.status,
          pastDueSince: sub.pastDueSince,
          overrideLimits: sub.overrideLimits as never,
          overrideExpiresAt: sub.overrideExpiresAt,
        }
      : null,
  );
  return { principal, workspaceId, role, isApprover, membershipId, entitlements, isDemo: ws.isDemo, brandIds };
}

export async function resolveBrandAccess(db: PrismaClient, principal: Principal, workspaceId: string, brandId: string): Promise<BrandAccess> {
  const wa = await resolveWorkspaceAccess(db, principal, workspaceId);
  if (!isUuid(brandId)) throw notFound("Marka");
  if (wa.brandIds !== "all" && !wa.brandIds.includes(brandId)) throw notFound("Marka");
  const brand = await db.brand.findFirst({
    where: { id: brandId, workspaceId, archivedAt: null },
    select: { id: true, name: true, domain: true, timezone: true, currency: true, country: true, language: true, readOnly: true },
  });
  if (!brand) throw notFound("Marka");
  let brandRole = wa.role;
  if (wa.membershipId && !hasWorkspaceWideBrandAccess(wa.role)) {
    const g = await db.brandGrant.findUnique({ where: { membershipId_brandId: { membershipId: wa.membershipId, brandId } } });
    if (!g) throw notFound("Marka");
    brandRole = g.role;
  }
  return { ...wa, brandId, brandRole, brand };
}

export function assertCan(access: WorkspaceAccess | BrandAccess, permission: Permission): void {
  const role = "brandRole" in access ? access.brandRole : access.role;
  if (access.principal.kind === "api_key") {
    const scope = permission.split(".")[0]!;
    const scopes = access.principal.scopes ?? [];
    const readOnly = permission.endsWith(".read");
    if (!scopes.includes(`${scope}:write`) && !(readOnly && scopes.includes(`${scope}:read`)) && !scopes.includes("*")) {
      throw new AppError("forbidden", "API anahtarı bu kapsamı içermiyor");
    }
    return;
  }
  if (!can({ role, isApprover: access.isApprover }, permission)) {
    throw new AppError("forbidden", "Bu işlem için yetkiniz yok");
  }
}

/** Yeni ücretli iş (ölçüm, üretim, crawl) öncesi: abonelik durumu ve read-only marka. */
export function assertCanRunPaidJob(access: WorkspaceAccess | BrandAccess): void {
  if (!access.entitlements.canRunPaidJobs) {
    throw new AppError("plan_required", "Aboneliğiniz yeni ücretli işlere izin vermiyor", { reason: access.entitlements.readOnlyReason });
  }
  if ("brand" in access && access.brand.readOnly) {
    throw new AppError("plan_required", "Bu marka mevcut pakette salt okunur");
  }
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Kullanıcının erişebildiği workspace'ler ve markalar (switcher için). */
export async function listUserWorkspaces(db: PrismaClient, userId: string) {
  const ms = await db.membership.findMany({
    where: { userId, workspace: { status: { not: "deleting" } } },
    include: {
      grants: true,
      workspace: { include: { brands: { where: { archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, domain: true } }, subscription: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return ms.map((m) => {
    const all = hasWorkspaceWideBrandAccess(m.role);
    const granted = new Set(m.grants.map((g) => g.brandId));
    return {
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
      isDemo: m.workspace.isDemo,
      planKey: (m.workspace.subscription?.planKey ?? "free_audit") as PlanKey,
      brands: m.workspace.brands.filter((b) => all || granted.has(b.id)),
    };
  });
}
