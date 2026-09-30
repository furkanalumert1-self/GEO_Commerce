import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/shell";
import { pageBrand, requireUser, userWorkspaces } from "@/lib/page-access";

export default async function BrandLayout({ children, params }: { children: ReactNode; params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params;
  const user = await requireUser(`/w/${workspaceId}/b/${brandId}/dashboard`);
  await pageBrand(workspaceId, brandId);
  const workspaces = await userWorkspaces(user.id);
  const current = workspaces.find((w) => w.id === workspaceId);
  if (!current) notFound();
  return (
    <AppShell workspaces={workspaces} current={current} brandId={brandId} user={user}>
      {children}
    </AppShell>
  );
}
