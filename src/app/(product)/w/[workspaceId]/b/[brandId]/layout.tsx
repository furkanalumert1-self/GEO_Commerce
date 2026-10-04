import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/shell";
import { db } from "@/lib/db";
import { pageBrand, requireUser, userWorkspaces } from "@/lib/page-access";
import { revenueAvailability, revenueVisible } from "@/modules/commerce/availability";

export default async function BrandLayout({ children, params }: { children: ReactNode; params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params;
  const user = await requireUser(`/w/${workspaceId}/b/${brandId}/dashboard`);
  const access = await pageBrand(workspaceId, brandId);
  const [workspaces, revenue] = await Promise.all([userWorkspaces(user.id), revenueAvailability(db, { workspaceId, brandId }, access.entitlements)]);
  const current = workspaces.find((w) => w.id === workspaceId);
  if (!current) notFound();
  return (
    <AppShell workspaces={workspaces} current={current} brandId={brandId} user={user} revenue={revenueVisible(revenue)}>
      {children}
    </AppShell>
  );
}
