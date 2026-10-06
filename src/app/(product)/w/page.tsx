import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser, userWorkspaces } from "@/lib/page-access";
import { Card } from "@/components/ui";
import { singleBrandTarget } from "@/modules/tenancy/landing";

export default async function WorkspaceIndex() {
  const u = await requireUser("/w");
  const ws = await userWorkspaces(u.id);
  // Yetkili tek marka varsa doğrudan Genel Bakış; aksi halde marka listesi. "Tüm markalar" overview'a gider (döngü yok).
  const target = singleBrandTarget(ws);
  if (target) redirect(target);
  // Birden çok çalışma alanında en yeni açılır (ör. az önce kaydedilen rapordan oluşan alan).
  if (ws.length > 0) redirect(`/w/${ws[ws.length - 1]!.id}/overview`);
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-10">
      <Card className="p-5">
        <h1 className="text-xl font-semibold">Henüz bir çalışma alanınız yok</h1>
        <p className="mt-2 text-sm text-text-secondary">Hesabınız boş başlar; örnek veri eklenmez. Kurulum adımları:</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-text-secondary">
          <li>Alan adınızla ücretsiz ölçüm başlatın ve raporu hesabınıza kaydedin (marka ve 7 günlük Starter denemesi oluşur).</li>
          <li>Alan adı doğrulaması ve mağaza/katalog bağlantısı.</li>
          <li>Soruları onaylayıp ilk ölçümü başlatın.</li>
        </ol>
        <Link href="/audit" className="mt-4 inline-flex min-h-11 items-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-white">Audit başlat</Link>
      </Card>
    </main>
  );
}
