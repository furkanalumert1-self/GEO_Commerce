import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { ApiButton } from "@/components/forms/api-button";
import { PromptForm } from "@/components/forms/prompt-form";
import { RunPlanner } from "@/components/forms/run-planner";
import { Pager, pageParams } from "@/components/data/pager";
import { db } from "@/lib/db";
import { pageBrand } from "@/lib/page-access";
import { engineAvailability } from "@/modules/monitoring/start";
import { fmtNumber } from "@/lib/format";
import { executionMode } from "@/lib/queue";

export const metadata: Metadata = { title: "Promptlar" };

const INTENT_LABEL: Record<string, string> = { informational: "Bilgi", category_discovery: "Kategori keşfi", transactional: "Satın alma", comparison: "Karşılaştırma", alternative: "Alternatif", local: "Yerel" };

export default async function PromptsPage({ params, searchParams }: { params: Promise<{ workspaceId: string; brandId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspaceId, brandId } = await params;
  const sp = await searchParams;
  const access = await pageBrand(workspaceId, brandId);
  const { page, pageSize, skip } = pageParams(sp);
  const show = sp.show === "archived" ? "archived" : "active";
  const where = { workspaceId, brandId, ...(show === "archived" ? { archivedAt: { not: null } } : { archivedAt: null }) };
  const [prompts, total, activeCount, clusters] = await Promise.all([
    db.prompt.findMany({ where, include: { cluster: true, versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: [{ cluster: { label: "asc" } }, { createdAt: "asc" }], skip, take: pageSize }),
    db.prompt.count({ where }),
    db.prompt.count({ where: { workspaceId, active: true } }),
    db.intentCluster.findMany({ where: { brandId }, select: { id: true, label: true }, orderBy: { label: "asc" } }),
  ]);
  const engines = engineAvailability(access);
  const api = `/api/v1/workspaces/${workspaceId}/brands/${brandId}`;
  const base = `/w/${workspaceId}/b/${brandId}/prompts`;

  return (
    <>
      <PageHeader
        title="Promptlar ve niyetler"
        description="Niyet kümeleri, ticari niyet puanı ve ölçüm planı. Prompt gözlemleri gerçek arama hacmi değildir. Metin değişikliği yeni sürüm (yeni karşılaştırma kümesi) oluşturur; arşiv tarihsel ölçümü silmez."
        badges={<Badge tone={activeCount >= access.entitlements.activePrompts ? "danger" : "neutral"}>Aktif {activeCount} / {access.entitlements.activePrompts}</Badge>}
      />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader
            title={show === "archived" ? "Arşivlenen promptlar" : "Aktif promptlar"}
            action={<a className="text-sm text-primary underline" href={`${base}?show=${show === "archived" ? "active" : "archived"}`}>{show === "archived" ? "Aktifleri göster" : "Arşivi göster"}</a>}
          />
          {prompts.length === 0 ? (
            <EmptyState title="Prompt yok" description="Sağdaki formla ilk niyet sorusunu ekleyin." />
          ) : (
            <TableWrap label="Promptlar">
              <thead>
                <tr>
                  <Th>Soru</Th>
                  <Th>Küme / niyet</Th>
                  <Th numeric>Ticari niyet</Th>
                  <Th numeric>Ağırlık</Th>
                  <Th>İşlem</Th>
                </tr>
              </thead>
              <tbody>
                {prompts.map((p) => {
                  const v = p.versions[0];
                  const rubric = v?.commercialRubric as { purchase: number; specificity: number; constraints: number; comparison: number } | undefined;
                  return (
                    <tr key={p.id}>
                      <Td className="max-w-[26rem]">
                        <p>{v?.text}</p>
                        <p className="text-xs text-muted">
                          v{v?.version} · {p.source}{p.branded ? " · markalı" : ""}{v?.scoreOverridden ? " · puan elle düzeltildi" : ""}
                        </p>
                      </Td>
                      <Td>
                        <p>{p.cluster.label}</p>
                        <p className="text-xs text-muted">{INTENT_LABEL[p.cluster.type]} · {p.cluster.locale}</p>
                      </Td>
                      <Td numeric>
                        <span title={rubric ? `Satın alma ${rubric.purchase}/40 · Özgüllük ${rubric.specificity}/25 · Kısıt ${rubric.constraints}/20 · Karşılaştırma ${rubric.comparison}/15` : undefined}>{v?.commercialScore ?? "—"}</span>
                      </Td>
                      <Td numeric>{fmtNumber(p.weight, "tr-TR", 1)}</Td>
                      <Td>
                        {p.archivedAt ? (
                          <ApiButton url={`${api}/prompts/${p.id}`} method="PATCH" body={{ archived: false }} label="Geri al" />
                        ) : (
                          <ApiButton url={`${api}/prompts/${p.id}`} method="PATCH" body={{ archived: true }} label="Arşivle" confirm="Prompt arşivlensin mi? Tarihsel ölçümler korunur." />
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
          <Pager basePath={base} sp={sp} page={page} pageSize={pageSize} total={total} />
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Prompt ekle" description="Türkçe yazım normalize edilir; aynı veya çok benzer sorular reddedilir." />
            <div className="p-4">
              <PromptForm url={`${api}/prompts`} clusters={clusters} locale={`${access.brand.language}-${access.brand.country}`} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Ölçüm planı" description="soru × platform × ülke/dil × tekrar. Kota yetmezse öncelikli sorular sırayla örneklenir." />
            <div className="p-4">
              <RunPlanner url={`${api}/runs`} engines={engines.all} locale={`${access.brand.language}-${access.brand.country}`} inline={executionMode() === "inline"} runPagePrefix={`/w/${workspaceId}/b/${brandId}/runs`} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
