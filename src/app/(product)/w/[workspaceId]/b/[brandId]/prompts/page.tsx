import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap, Td, Th, cn } from "@/components/ui";
import { ApiButton } from "@/components/forms/api-button";
import { QuestionPicker } from "@/components/forms/question-picker";
import { PromptEdit } from "@/components/forms/prompt-edit";
import { RunPlanner } from "@/components/forms/run-planner";
import { Pager, pageParams } from "@/components/data/pager";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { engineAvailability } from "@/modules/monitoring/start";
import { fmtNumber } from "@/lib/format";
import { executionMode } from "@/lib/queue";
import { loadPickerData } from "@/modules/prompts/picker";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Takip ettiğim sorular" };

const PURPOSE_LABEL: Record<string, string> = { informational: "Bilgi alma", category_discovery: "Ürün keşfi", transactional: "Satın alma", comparison: "Karşılaştırma", alternative: "Alternatif arama", local: "Yakında arama" };
const SOURCE_LABEL: Record<string, string> = { user: "Siz eklediniz", generated: "Öneriden", audit: "Ücretsiz ölçümden" };

export default async function PromptsPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const { page, pageSize, skip } = pageParams(sp);
  const show = sp.show === "archived" ? "archived" : "active";
  const where = { workspaceId, brandId, ...(show === "archived" ? { archivedAt: { not: null } } : { archivedAt: null }) };
  const [prompts, total, brand] = await Promise.all([
    db.prompt.findMany({ where, include: { cluster: true, versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: [{ cluster: { label: "asc" } }, { createdAt: "asc" }], skip, take: pageSize }),
    db.prompt.count({ where }),
    db.brand.findUniqueOrThrow({ where: { id: brandId }, select: { categories: true, country: true, language: true } }),
  ]);
  const picker = await loadPickerData(db, { workspaceId, brandId }, brand, access.entitlements.activePrompts);
  const engines = engineAvailability(access);
  const api = `/api/v1/workspaces/${workspaceId}/brands/${brandId}`;
  const base = `/w/${workspaceId}/b/${brandId}/prompts`;
  const canWrite = can({ role: access.brandRole, isApprover: access.isApprover }, "prompts.write");
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={cn("inline-flex min-h-11 items-center border-b-2 px-3 text-sm sm:min-h-10", on ? "border-primary font-medium text-primary" : "border-transparent text-text-secondary hover:text-text")}>{label}</Link>
  );

  return (
    <>
      <PageHeader
        title="Takip ettiğim sorular"
        description="Müşterilerinizin AI asistanlarına sorabileceği sorular. Bu sorulara verilen yanıtlarda markanızın anılıp anılmadığını ölçeriz; arama hacmi değildir."
        badges={<Badge tone={picker.used >= picker.limit ? "warning" : "neutral"}>{picker.used}/{picker.limit} soru</Badge>}
      />
      <div className="mb-5 flex flex-wrap gap-1 border-b border-border" role="navigation" aria-label="Sorular">
        {tab(base, "Takip ettiğim sorular", show === "active")}
        {tab(`/w/${workspaceId}/b/${brandId}/visibility`, "Sonuçlar", false)}
        {tab(`${base}?show=archived`, "Arşiv", show === "archived")}
      </div>
      {canWrite && show === "active" ? (
        <Card className="mb-6">
          <CardHeader title="Soru ekle" description="Ürün grubunu seçin, ilgili soruları işaretleyin. Kopyala-yapıştır gerekmez." />
          <div className="px-5 pb-5 sm:px-6"><QuestionPicker data={picker} api={api} nextHint="Ölçümü aşağıdaki “Ölçüm başlat” bölümünden başlatabilirsiniz." /></div>
        </Card>
      ) : null}
      <Card id="takip">
        <CardHeader title={show === "archived" ? "Arşivdeki sorular" : "Takip edilen sorular"} description={show === "archived" ? "Arşiv geçmiş ölçümleri silmez. Geri aldığınız soru, etkinleştirilene kadar ölçülmez." : undefined} />
        {prompts.length === 0 ? (
          <EmptyState title={show === "archived" ? "Arşivde soru yok" : "Henüz soru yok"} description={show === "archived" ? "Arşivlediğiniz sorular burada görünür." : "Yukarıdan ürün grubu seçip soruları işaretleyin."} />
        ) : (
          <TableWrap label="Sorular">
            <thead>
              <tr>
                <Th>Soru</Th>
                <Th>Ürün grubu</Th>
                <Th>Durum</Th>
                <Th>İşlem</Th>
              </tr>
            </thead>
            <tbody>
              {prompts.map((p) => {
                const v = p.versions[0];
                return (
                  <tr key={p.id}>
                    <Td className="min-w-[14rem] max-w-[30rem] py-3"><p className="[overflow-wrap:anywhere]">{v?.text}</p></Td>
                    <Td className="py-3">{p.cluster.label}</Td>
                    <Td className="py-3">{p.archivedAt ? <Badge>Arşivde</Badge> : p.active ? <Badge tone="success">Takip ediliyor</Badge> : <Badge tone="warning">Duraklatıldı</Badge>}</Td>
                    <Td className="py-3">
                      {!canWrite ? null : p.archivedAt ? (
                        <ApiButton url={`${api}/prompts/${p.id}`} method="PATCH" body={{ archived: false }} label="Arşivden çıkar" />
                      ) : !p.active ? (
                        <ApiButton url={`${api}/prompts/${p.id}`} method="PATCH" body={{ active: true }} label="Takibe al" />
                      ) : (
                        <div className="flex flex-wrap items-start gap-1">
                          <PromptEdit url={`${api}/prompts/${p.id}`} text={v?.text ?? ""} />
                          <ApiButton url={`${api}/prompts/${p.id}`} method="PATCH" body={{ archived: true }} variant="ghost" label="İlgisiz" confirm="Bu soru ürünlerinizle ilgili değil mi? Soru arşivlenir; geçmiş ölçümler korunur ve kotada yer açılır." />
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        <Pager basePath={base} sp={sp} page={page} pageSize={pageSize} total={total} />
        {prompts.length ? (
          <details className="border-t border-border px-5 py-3 text-sm sm:px-6">
            <summary className="min-h-9 cursor-pointer py-1 font-medium text-primary">Gelişmiş ayarlar</summary>
            <p className="mt-2 text-xs text-text-secondary">Satın almaya yakınlık puanı, ağırlık ve sürüm bilgisi. Varsayılanlar değişmez; soru metni değişirse yeni sürüm oluşur ve eski ölçümler silinmez.</p>
            <TableWrap label="Soru ayrıntıları">
              <thead><tr><Th>Soru</Th><Th>Sorunun amacı</Th><Th numeric>Satın almaya yakınlık</Th><Th numeric>Ağırlık</Th><Th>Sürüm</Th><Th>Nereden</Th></tr></thead>
              <tbody>
                {prompts.map((p) => {
                  const v = p.versions[0];
                  return (
                    <tr key={p.id}>
                      <Td className="max-w-[22rem] truncate" title={v?.text}>{v?.text}</Td>
                      <Td>{PURPOSE_LABEL[p.cluster.type] ?? p.cluster.type}</Td>
                      <Td numeric>{v?.commercialScore ?? "—"}/100</Td>
                      <Td numeric>{fmtNumber(p.weight, "tr-TR", 1)}</Td>
                      <Td>v{v?.version}{v?.scoreOverridden ? " · puan elle düzeltildi" : ""}</Td>
                      <Td>{SOURCE_LABEL[p.source] ?? p.source}{p.branded ? " · marka adı geçiyor" : ""}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </details>
        ) : null}
      </Card>
      {canWrite ? (
        <Card className="mt-6" id="olcum">
          <CardHeader title="Ölçüm başlat" description="Başlatmadan önce soru, platform ve kota kullanımı gösterilir; onayınız olmadan ölçüm başlamaz." />
          <div className="px-5 pb-5 sm:px-6">
            <RunPlanner url={`${api}/runs`} engines={engines.all} locale={`${access.brand.language}-${access.brand.country}`} inline={executionMode() === "inline"} runPagePrefix={`/w/${workspaceId}/b/${brandId}/runs`} />
          </div>
        </Card>
      ) : null}
    </>
  );
}
