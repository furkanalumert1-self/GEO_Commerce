import { normalizePrompt } from "@/modules/prompts/intent";

/**
 * Yanıttan mention/citation çıkarımı (§5 Run).
 * - Adın ilk geçiş sırası gerçek recommendation rank değildir; rank yalnız açık liste varsa.
 * - Belirsiz eşleşmeler (kısa/jenerik alias) review queue'ya gider.
 * - Citation ≠ mention; link varlığı markayı önerdiğini tek başına kanıtlamaz.
 */
export const PARSE_VERSION = "extract@1";

export interface Entity {
  id: string;
  type: "brand" | "competitor";
  name: string;
  aliases: string[];
  domain: string;
}

export interface ExtractedMention {
  entityId: string;
  entityType: "brand" | "competitor";
  kind: "mention" | "recommendation" | "negative" | "incidental";
  rank: number | null;
  confidence: number;
  excerpt: string;
  needsReview: boolean;
}

export interface ExtractedCitation {
  url: string;
  canonicalUrl: string;
  domain: string;
  association: "own" | "competitor" | "third_party";
  entityId: string | null;
  sourceType: string;
}

export interface ExtractionResult {
  listDetected: boolean;
  mentions: ExtractedMention[];
  citations: ExtractedCitation[];
  parseVersion: string;
}

const NEGATIVE = ["önermem", "önerilmez", "kaçının", "şikayet", "kötü", "sorunlu", "avoid", "not recommend"];
const RECOMMEND = ["öneririm", "tavsiye", "en iyi", "öne çıkıyor", "iyi bir seçenek", "recommend", "best"];

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Türkçe ekleri de (Luma'nın, Luma'yı) kapsayan kelime sınırı eşleşmesi. */
function findAll(textLower: string, term: string): number[] {
  const t = term.toLocaleLowerCase("tr-TR").trim();
  if (!t) return [];
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(t)}(?=$|[^\\p{L}\\p{N}]|['’])`, "gu");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(textLower))) out.push(m.index + m[1]!.length);
  return out;
}

export function canonicalizeUrl(raw: string): { canonical: string; domain: string } | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const domain = u.hostname.toLowerCase().replace(/^www\./, "");
    const params = new URLSearchParams();
    // Takip parametreleri canonical'dan çıkarılır.
    for (const [k, v] of u.searchParams) if (!/^(utm_|gclid|fbclid|ref$)/i.test(k)) params.append(k, v);
    const q = params.toString();
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return { canonical: `https://${domain}${path}${q ? `?${q}` : ""}`, domain };
  } catch {
    return null;
  }
}

export function domainMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return host === d || host.endsWith(`.${d}`);
}

const SOURCE_TYPES: Array<[RegExp, string]> = [
  [/(sikayetvar|trustpilot|yorum|review)/, "review"],
  [/(forum|reddit|eksisozluk|donanimhaber|kizlarsoruyor)/, "forum"],
  [/(blog|medium|wordpress)/, "blog"],
  [/(haber|news|hurriyet|milliyet|sabah|ntv|cnn|bbc|onedio)/, "media"],
  [/(rehber|directory|yellowpages|cimri|akakce|epey)/, "directory"],
];

function sourceTypeFor(domain: string): string {
  for (const [re, type] of SOURCE_TYPES) if (re.test(domain)) return type;
  return "other";
}

/**
 * Açık liste: numaralı veya madde işaretli üst düzey satırlar ≥2.
 * Numaralı satırda sıra, yazılan numaradır (ör. "4. Bellona" → 4). Madde işaretli listede sıra,
 * o listedeki konumdur; yeni bir başlık/paragrafla başlayan liste sayacı sıfırlar. Girintili alt
 * maddeler ayrı sıra almaz, üst maddenin parçası sayılır.
 */
function listItems(text: string): Array<{ index: number; start: number; end: number }> {
  const lines = text.split("\n");
  const items: Array<{ index: number; start: number; end: number }> = [];
  let offset = 0;
  let bulletN = 0;
  let last: { index: number; start: number; end: number } | null = null;
  for (const line of lines) {
    const numbered = /^ {0,1}(\d{1,3})[.)]\s+/.exec(line);
    const bullet = /^ {0,1}[-*•]\s+/.test(line);
    const indented = /^(\s{2,}|\t)\S/.test(line);
    if (numbered) {
      last = { index: Number(numbered[1]), start: offset, end: offset + line.length };
      items.push(last);
      bulletN = 0;
    } else if (bullet) {
      bulletN++;
      last = { index: bulletN, start: offset, end: offset + line.length };
      items.push(last);
    } else if (indented && last) {
      last.end = offset + line.length; // alt madde/devam satırı üst maddeye aittir
    } else if (line.trim()) {
      bulletN = 0;
      last = null;
    }
    offset += line.length + 1;
  }
  return items.length >= 2 ? items : [];
}

export function extract(answer: string, urls: string[], entities: Entity[]): ExtractionResult {
  const lower = answer.toLocaleLowerCase("tr-TR");
  const items = listItems(answer);
  const mentions: ExtractedMention[] = [];

  for (const e of entities) {
    const terms = [e.name, ...e.aliases, e.domain.replace(/^www\./, "")];
    const positions = [...new Set(terms.flatMap((t) => findAll(lower, t)))].sort((a, b) => a - b);
    if (positions.length === 0) continue;
    const first = positions[0]!;
    const excerpt = answer.slice(Math.max(0, first - 80), Math.min(answer.length, first + 120)).trim();
    const around = normalizePrompt(answer.slice(Math.max(0, first - 120), Math.min(answer.length, first + 160)));
    const matchedOnlyShortAlias = terms
      .filter((t) => findAll(lower, t).length > 0)
      .every((t) => t.trim().length <= 3);
    // Sıra: markanın liste maddesi içindeki ilk geçişi (önce düz metinde geçse bile).
    const item = items.find((it) => positions.some((p) => p >= it.start && p <= it.end));
    let kind: ExtractedMention["kind"] = "mention";
    if (NEGATIVE.some((k) => around.includes(k))) kind = "negative";
    else if (item || RECOMMEND.some((k) => around.includes(k))) kind = "recommendation";
    mentions.push({
      entityId: e.id,
      entityType: e.type,
      kind,
      rank: item ? item.index : null,
      confidence: matchedOnlyShortAlias ? 0.5 : 0.9,
      excerpt,
      needsReview: matchedOnlyShortAlias,
    });
  }

  const seen = new Set<string>();
  const citations: ExtractedCitation[] = [];
  const inlineUrls = answer.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
  for (const raw of [...urls, ...inlineUrls]) {
    const c = canonicalizeUrl(raw);
    if (!c || seen.has(c.canonical)) continue;
    seen.add(c.canonical);
    const owner = entities.find((e) => domainMatches(c.domain, e.domain));
    citations.push({
      url: raw,
      canonicalUrl: c.canonical,
      domain: c.domain,
      association: owner ? (owner.type === "brand" ? "own" : "competitor") : "third_party",
      entityId: owner?.id ?? null,
      sourceType: owner ? "own" : sourceTypeFor(c.domain),
    });
  }

  return { listDetected: items.length > 0, mentions, citations, parseVersion: PARSE_VERSION };
}
