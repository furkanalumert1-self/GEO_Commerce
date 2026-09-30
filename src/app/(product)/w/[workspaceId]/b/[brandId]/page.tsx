import { redirect } from "next/navigation";

export default async function BrandIndex({ params }: { params: Promise<{ workspaceId: string; brandId: string }> }) {
  const { workspaceId, brandId } = await params;
  redirect(`/w/${workspaceId}/b/${brandId}/dashboard`);
}
