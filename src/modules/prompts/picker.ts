import type { PrismaClient } from "@/generated/prisma/client";
import { auditPrompts } from "@/modules/audit/service";
import { dedupePrompts } from "./intent";

/** Ürün grubu → soru seçimi için sayfa verisi. Kayıt/ölçüm yapmaz; öneriler yalnız hesaplanır. */
export interface PickerQuestion {
  id: string | null; // kayıtlı sorunun kimliği; öneride null
  text: string;
}

export interface PickerGroup {
  key: string; // clusterId veya "cat:<kategori>"
  clusterId: string | null;
  label: string;
  category: string | null;
  tracked: PickerQuestion[];
  archived: PickerQuestion[];
  suggested: PickerQuestion[];
}

export interface PickerData {
  groups: PickerGroup[];
  used: number;
  limit: number;
  locale: string;
}

type ClusterRow = {
  id: string;
  label: string;
  category: string | null;
  prompts: Array<{ id: string; active: boolean; archivedAt: Date | null; versions: Array<{ text: string }> }>;
};

/**
 * Saf birleştirme: soru grupları + markanın ürün kategorileri. Öneriler grubun ürün kategorisinden
 * (yoksa grup adından) şablonla üretilir; mevcut (aktif/arşiv) sorulara aynı veya çok benzer olanlar çıkarılır.
 */
export function buildPickerGroups(clusters: ClusterRow[], brandCategories: string[], country: string): PickerGroup[] {
  const norm = (s: string) => s.trim().toLocaleLowerCase("tr-TR");
  const groups: PickerGroup[] = clusters.map((c) => {
    const tracked: PickerQuestion[] = [];
    const archived: PickerQuestion[] = [];
    for (const p of c.prompts) {
      const text = p.versions[0]?.text;
      if (!text) continue;
      if (p.archivedAt || !p.active) archived.push({ id: p.id, text });
      else tracked.push({ id: p.id, text });
    }
    return { key: c.id, clusterId: c.id, label: c.label, category: c.category, tracked, archived, suggested: [] };
  });
  // Henüz soru grubu olmayan ürün kategorileri de seçilebilir grup olarak gösterilir (kayıtta grup oluşur).
  for (const cat of brandCategories.map((x) => x.trim()).filter(Boolean)) {
    if (groups.some((g) => norm(g.label) === norm(cat) || (g.category && norm(g.category) === norm(cat)))) continue;
    groups.push({ key: `cat:${cat}`, clusterId: null, label: cat, category: cat, tracked: [], archived: [], suggested: [] });
  }
  const allExisting = groups.flatMap((g) => [...g.tracked, ...g.archived]).map((q) => ({ text: q.text }));
  for (const g of groups) {
    const base = g.category ?? g.label;
    const candidates = auditPrompts([base], country).map((text) => ({ text }));
    g.suggested = dedupePrompts(candidates, allExisting).kept.map((q) => ({ id: null, text: q.text }));
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

export async function loadPickerData(db: PrismaClient, ids: { workspaceId: string; brandId: string }, brand: { categories: string[]; country: string; language: string }, limit: number): Promise<PickerData> {
  const [clusters, used] = await Promise.all([
    db.intentCluster.findMany({
      where: { workspaceId: ids.workspaceId, brandId: ids.brandId },
      select: { id: true, label: true, category: true, prompts: { select: { id: true, active: true, archivedAt: true, versions: { orderBy: { version: "desc" }, take: 1, select: { text: true } } }, orderBy: { createdAt: "asc" } } },
    }),
    // Kota sayımı POST /prompts ile aynı kapsamda (çalışma alanındaki aktif sorular).
    db.prompt.count({ where: { workspaceId: ids.workspaceId, active: true } }),
  ]);
  return { groups: buildPickerGroups(clusters, brand.categories, brand.country), used, limit, locale: `${brand.language}-${brand.country}` };
}
