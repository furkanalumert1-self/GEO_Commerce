import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/http/errors";
import { listUserWorkspaces, resolveBrandAccess, resolveWorkspaceAccess } from "@/modules/tenancy/access";

/** Server Component erişim yardımcıları. Başka tenant'ın varlığı 404 ile gizlenir. */
export const currentUser = cache(async () => {
  const s = await auth();
  if (!s?.user?.id) return null;
  return { id: s.user.id, email: s.user.email ?? "", name: s.user.name ?? null };
});

export async function requireUser(next?: string) {
  const u = await currentUser();
  if (!u) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return u;
}

export const pageWorkspace = cache(async (workspaceId: string) => {
  const u = await requireUser(`/w/${workspaceId}/overview`);
  try {
    return await resolveWorkspaceAccess(db, { kind: "user", userId: u.id }, workspaceId);
  } catch (e) {
    if (isAppError(e) && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
});

export const pageBrand = cache(async (workspaceId: string, brandId: string) => {
  const u = await requireUser(`/w/${workspaceId}/b/${brandId}/dashboard`);
  try {
    return await resolveBrandAccess(db, { kind: "user", userId: u.id }, workspaceId, brandId);
  } catch (e) {
    if (isAppError(e) && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  }
});

export const userWorkspaces = cache(async (userId: string) => listUserWorkspaces(db, userId));
