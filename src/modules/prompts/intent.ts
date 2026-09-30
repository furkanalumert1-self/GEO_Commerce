import { sha256 } from "@/lib/crypto";

/**
 * Prompt normalizasyonu, dedupe ve Commercial Intent rubric'i (§5).
 * Prompt gözlemleri gerçek arama hacmi değildir.
 */

/** Türkçe duyarlı Unicode normalize: NFC, tr-TR küçük harf, noktalama/boşluk sadeleştirme. */
export function normalizePrompt(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[“”"'’`]/g, "")
    .replace(/[?!.,;:()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const promptHash = (text: string) => sha256(normalizePrompt(text));

function tokens(text: string): Set<string> {
  return new Set(normalizePrompt(text).split(" ").filter((t) => t.length > 1));
}

/** Basit Jaccard benzerliği (lexical); vector search ancak ölçülmüş ihtiyaçta (§16). */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export interface DedupeResult<T> {
  kept: T[];
  duplicates: Array<{ item: T; of: T; reason: "exact" | "similar" }>;
}

export function dedupePrompts<T extends { text: string }>(items: T[], existing: T[] = [], threshold = 0.85): DedupeResult<T> {
  const kept: T[] = [];
  const duplicates: DedupeResult<T>["duplicates"] = [];
  const pool = [...existing];
  const hashes = new Map(pool.map((p) => [promptHash(p.text), p]));
  for (const item of items) {
    const h = promptHash(item.text);
    const exact = hashes.get(h);
    if (exact) {
      duplicates.push({ item, of: exact, reason: "exact" });
      continue;
    }
    const near = pool.find((p) => similarity(p.text, item.text) >= threshold);
    if (near) {
      duplicates.push({ item, of: near, reason: "similar" });
      continue;
    }
    kept.push(item);
    pool.push(item);
    hashes.set(h, item);
  }
  return { kept, duplicates };
}

// ── Commercial Intent 0–100 ──
// Rubric: açık satın alma/öneri isteği 0–40, ürün/kategori özgüllüğü 0–25,
// bütçe/özellik kısıtı 0–20, karşılaştırma/alternatif 0–15.

export interface IntentRubric {
  purchase: number; // 0–40
  specificity: number; // 0–25
  constraints: number; // 0–20
  comparison: number; // 0–15
  total: number; // 0–100
  version: string;
  reasons: string[];
}

export const INTENT_RUBRIC_VERSION = "intent-rubric@1";

const PURCHASE_STRONG = ["satın al", "sipariş", "nereden alabilirim", "nereden alınır", "en iyi", "öner", "tavsiye", "hangisini almalıyım", "buy", "best", "recommend"];
const PURCHASE_WEAK = ["fiyat", "indirim", "kampanya", "ucuz", "price", "deal"];
const CONSTRAINT = ["altı", "altında", "bütçe", "tl", "₺", "$", "under", "için", "hassas", "vegan", "organik", "parfümsüz", "spf", "ml", "gram", "kg"];
const COMPARISON = [" vs ", "karşılaştır", "farkı", "mı yoksa", "alternatif", "yerine", "benzeri", "compare", "alternative"];
const INFORMATIONAL = ["nedir", "nasıl yapılır", "ne işe yarar", "neden", "what is", "how to"];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function scoreCommercialIntent(text: string, catalogTerms: string[] = []): IntentRubric {
  const t = ` ${normalizePrompt(text)} `;
  const reasons: string[] = [];
  let purchase = 0;
  if (PURCHASE_STRONG.some((k) => t.includes(k))) {
    purchase = 32;
    reasons.push("Açık öneri/satın alma isteği");
  } else if (PURCHASE_WEAK.some((k) => t.includes(k))) {
    purchase = 18;
    reasons.push("Fiyat/indirim ilgisi");
  }
  if (INFORMATIONAL.some((k) => t.includes(k))) {
    purchase = Math.max(0, purchase - 14);
    reasons.push("Bilgi sorusu kalıbı");
  }
  const catalogHits = catalogTerms.filter((c) => c && t.includes(normalizePrompt(c))).length;
  const specificity = clamp(catalogHits * 10 + (t.split(" ").length > 6 ? 5 : 0), 0, 25);
  if (catalogHits > 0) reasons.push(`${catalogHits} katalog terimi eşleşti`);
  const constraintHits = CONSTRAINT.filter((k) => t.includes(k)).length + (/\d/.test(t) ? 1 : 0);
  const constraints = clamp(constraintHits * 7, 0, 20);
  if (constraints > 0) reasons.push("Bütçe/özellik kısıtı");
  const comparison = COMPARISON.some((k) => t.includes(k)) ? 15 : 0;
  if (comparison > 0) reasons.push("Karşılaştırma/alternatif");
  const total = clamp(purchase + specificity + constraints + comparison, 0, 100);
  return { purchase, specificity, constraints, comparison, total, version: INTENT_RUBRIC_VERSION, reasons };
}

export function classifyIntentType(text: string): "informational" | "category_discovery" | "transactional" | "comparison" | "alternative" | "local" {
  const t = ` ${normalizePrompt(text)} `;
  if (["alternatif", "yerine", "benzeri", "alternative"].some((k) => t.includes(k))) return "alternative";
  if ([" vs ", "karşılaştır", "farkı", "mı yoksa", "compare"].some((k) => t.includes(k))) return "comparison";
  if (["yakınımda", "istanbul", "ankara", "izmir", "mağaza adresi", "near me"].some((k) => t.includes(k))) return "local";
  if (["satın al", "sipariş", "nereden alabilirim", "fiyat", "buy"].some((k) => t.includes(k))) return "transactional";
  if (INFORMATIONAL.some((k) => t.includes(k))) return "informational";
  return "category_discovery";
}

/** Rubric sınırlarını kalıcı veri için güvenceye alır (kullanıcı override dahil). */
export function validateRubric(r: Pick<IntentRubric, "purchase" | "specificity" | "constraints" | "comparison">): IntentRubric {
  const purchase = clamp(Math.round(r.purchase), 0, 40);
  const specificity = clamp(Math.round(r.specificity), 0, 25);
  const constraints = clamp(Math.round(r.constraints), 0, 20);
  const comparison = clamp(Math.round(r.comparison), 0, 15);
  return { purchase, specificity, constraints, comparison, total: purchase + specificity + constraints + comparison, version: INTENT_RUBRIC_VERSION, reasons: ["Kullanıcı override"] };
}
