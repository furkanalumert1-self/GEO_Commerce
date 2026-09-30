import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser, userWorkspaces } from "@/lib/page-access";
import { Card } from "@/components/ui";

export default async function WorkspaceIndex() {
  const u = await requireUser("/w");
  const ws = await userWorkspaces(u.id);
  if (ws.length > 0) redirect(`/w/${ws[0]!.id}/overview`);
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-10">
      <Card className="p-5">
        <h1 className="text-xl font-semibold">Henüz bir çalışma alanınız yok</h1>
        <p className="mt-2 text-sm text-muted">Ücretsiz GEO Audit ile başlayın; raporu kaydettiğinizde çalışma alanınız ve 7 günlük Starter denemeniz oluşturulur.</p>
        <Link href="/audit" className="mt-4 inline-flex min-h-11 items-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-white">Audit başlat</Link>
      </Card>
    </main>
  );
}
