import type { PrismaClient } from "@/generated/prisma/client";
import { dedupePrompts, promptHash } from "./intent";
import { catalogMatchCount, classifyPurpose, groupAttributes, INFO_PATTERNS, PURPOSE_LABEL, purposeTemplates, questionPattern, questionQuality, type QuestionPattern } from "./quality";

/** Ürün grubu → soru seçimi için sayfa verisi. Kayıt/ölçüm yapmaz; öneriler yalnız hesaplanır. */
export interface PickerQuestion {
  id: string | null; // kayıtlı sorunun kimliği; öneride null
  text: string;
  /** Sorunun amacı (kullanıcı etiketi). */
  purpose?: string;
  /** Öneriler için: "Uygun" / "Düzenleme gerekli" ve tek cümle neden. */
  quality?: "ok" | "edit";
  reason?: string;
  suggestion?: string | null;
}

export interface PickerGroup {
  key: string; // clusterId veya "cat:<kategori>"
  clusterId: string | null;
  label: string;
  category: string | null;
  tracked: PickerQuestion[];
  archived: PickerQuestion[];
  suggested: PickerQuestion[];
  /** Ürün türü belirsiz veya katalogla uyumsuz öneriler: varsayılan listede değil, düzenlenerek eklenir. */
  needsEdit: PickerQuestion[];
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

const MAX_PATTERN_GROUPS = 2;
const lower = (s: string) => s.toLocaleLowerCase("tr-TR");

/**
 * Saf birleştirme: soru grupları + markanın ürün kategorileri. Öneriler grubun ürün kategorisinden
 * (yoksa grup adından) şablonla üretilir; mevcut (aktif/arşiv) sorulara aynı veya çok benzer olanlar çıkarılır.
 */
export function buildPickerGroups(clusters: ClusterRow[], brandCategories: string[], country: string, catalog: Array<{ name: string; categories: string[] }> = []): PickerGroup[] {
  const norm = (s: string) => s.trim().toLocaleLowerCase("tr-TR");
  const groups: PickerGroup[] = clusters.map((c) => {
    const tracked: PickerQuestion[] = [];
    const archived: PickerQuestion[] = [];
    for (const p of c.prompts) {
      const text = p.versions[0]?.text;
      if (!text) continue;
      const q = { id: p.id, text, purpose: PURPOSE_LABEL[classifyPurpose(text)] };
      if (p.archivedAt || !p.active) archived.push(q);
      else tracked.push(q);
    }
    return { key: c.id, clusterId: c.id, label: c.label, category: c.category, tracked, archived, suggested: [], needsEdit: [] };
  });
  // Henüz soru grubu olmayan ürün kategorileri de seçilebilir grup olarak gösterilir (kayıtta grup oluşur).
  for (const cat of brandCategories.map((x) => x.trim()).filter(Boolean)) {
    if (groups.some((g) => norm(g.label) === norm(cat) || (g.category && norm(g.category) === norm(cat)))) continue;
    groups.push({ key: `cat:${cat}`, clusterId: null, label: cat, category: cat, tracked: [], archived: [], suggested: [], needsEdit: [] });
  }
  // Aktif eşdeğeri olan arşiv sorusu tekrar sunulmaz (aynı normalize metin); tarihsel kayıt silinmez.
  const activeHashes = new Set(groups.flatMap((g) => g.tracked.map((q) => promptHash(q.text))));
  for (const g of groups) {
    const seen = new Set<string>();
    g.archived = g.archived.filter((q) => {
      const h = promptHash(q.text);
      if (activeHashes.has(h) || seen.has(h)) return false;
      seen.add(h);
      return true;
    });
  }
  const allExisting = groups.flatMap((g) => [...g.tracked, ...g.archived]).map((q) => ({ text: q.text }));
  const catalogTerms = [...new Set(catalog.flatMap((p) => p.categories))];
  // Aynı soru kalıbı en çok MAX_PATTERN_GROUPS grupta takip edilir: sınıra ulaşan kalıp başka gruba önerilmez.
  // Öneriler sayılmaz (her grup öneri alır); kalıp sırası gruplar arasında döndürülür, ilk öneriler farklı olur.
  const patternUse = new Map<QuestionPattern, number>();
  for (const g of groups) for (const q of g.tracked) {
    const pt = questionPattern(q.text);
    if (pt) patternUse.set(pt, (patternUse.get(pt) ?? 0) + 1);
  }
  // Az sorusu olan ve katalogda karşılığı olan gruplar önerileri önce alır.
  const order = groups
    .map((g, i) => ({ g, i, m: catalogMatchCount(g.category ?? g.label, catalog) ?? 0 }))
    .sort((a, b) => a.g.tracked.length - b.g.tracked.length || b.m - a.m || a.i - b.i);
  order.forEach(({ g }, gi) => {
    const base = g.category ?? g.label;
    const words = lower(base).split(/\s+/).filter((w) => w.length > 3).map((w) => w.slice(0, Math.max(4, w.length - 2)));
    const names = catalog.filter((p) => words.some((w) => lower(`${p.name} ${p.categories.join(" ")}`).includes(w))).map((p) => p.name);
    const all = purposeTemplates(base, country, { attributes: groupAttributes(names) });
    // Bilgi sorusu grup başına en çok bir tane: grupta zaten varsa önerilmez.
    const hasInfo = g.tracked.some((q) => INFO_PATTERNS.includes(questionPattern(q.text) as QuestionPattern));
    const rotated = all.slice(gi % Math.max(1, all.length - 1)).concat(all.slice(0, gi % Math.max(1, all.length - 1)));
    const candidates = rotated.filter((c) => !(hasInfo && INFO_PATTERNS.includes(c.pattern)) && (patternUse.get(c.pattern) ?? 0) < MAX_PATTERN_GROUPS);
    const kept = dedupePrompts(candidates.map((c) => ({ text: c.text })), allExisting).kept.map((k) => k.text);
    const matches = catalogMatchCount(base, catalog);
    // Bilgi sorusu her zaman listenin sonunda gösterilir.
    const ordered = candidates.filter((x) => kept.includes(x.text)).sort((a, b) => Number(INFO_PATTERNS.includes(a.pattern)) - Number(INFO_PATTERNS.includes(b.pattern)));
    for (const c of ordered) {
      const q = questionQuality(c.text, { group: g.label, catalogTerms, catalogMatches: matches });
      const item: PickerQuestion = { id: null, text: c.text, purpose: PURPOSE_LABEL[c.purpose], quality: q.status, reason: q.reason, suggestion: q.suggestion };
      if (q.status === "ok") g.suggested.push(item);
      else g.needsEdit.push(item);
    }
  });
  return groups.sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

/**
 * Site taramasında/ürün dosyasında bulunan ürün kategorileri de soru grubu olarak sunulur (ör. "Çarşaflar",
 * "Termos"): en az 2 ürünü olanlar, ürün sayısına göre en çok 8 tane. Tek ürünlü kategoriler listeyi kalabalıklaştırmaz.
 */
export function catalogGroupCategories(catalog: Array<{ categories: string[] }>, max = 8): string[] {
  const count = new Map<string, number>();
  for (const p of catalog) for (const c of new Set(p.categories.map((x) => x.trim()).filter(Boolean))) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr")).slice(0, max).map(([c]) => c);
}

export async function loadPickerData(db: PrismaClient, ids: { workspaceId: string; brandId: string }, brand: { categories: string[]; country: string; language: string }, limit: number): Promise<PickerData> {
  const [clusters, used, products] = await Promise.all([
    db.intentCluster.findMany({
      where: { workspaceId: ids.workspaceId, brandId: ids.brandId },
      select: { id: true, label: true, category: true, prompts: { select: { id: true, active: true, archivedAt: true, versions: { orderBy: { version: "desc" }, take: 1, select: { text: true } } }, orderBy: { createdAt: "asc" } } },
    }),
    // Kota sayımı POST /prompts ile aynı kapsamda (çalışma alanındaki aktif sorular).
    db.prompt.count({ where: { workspaceId: ids.workspaceId, active: true } }),
    db.product.findMany({ where: { workspaceId: ids.workspaceId, brandId: ids.brandId, active: true }, select: { name: true, categories: { select: { category: { select: { name: true } } } } }, take: 1000 }),
  ]);
  const catalog = products.map((p) => ({ name: p.name, categories: p.categories.map((c) => c.category.name) }));
  return { groups: buildPickerGroups(clusters, [...brand.categories, ...catalogGroupCategories(catalog)], brand.country, catalog), used, limit, locale: `${brand.language}-${brand.country}` };
}
