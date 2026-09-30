import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/shell";
import { pageWorkspace, requireUser, userWorkspaces } from "@/lib/page-access";

export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const user = await requireUser(`/w/${workspaceId}/overview`);
  await pageWorkspace(workspaceId);
  const workspaces = await userWorkspaces(user.id);
  const current = workspaces.find((w) => w.id === workspaceId);
  if (!current) notFound();
  return (
    <AppShell workspaces={workspaces} current={current} brandId={null} user={user}>
      {children}
    </AppShell>
  );
}
