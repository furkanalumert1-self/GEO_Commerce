import { hashObject } from "@/lib/crypto";

/**
 * Fix with AI akışı (§6): draft→review→approved→publishing→published→measuring→completed;
 * failed / rejected / rolled_back yan yollar. Her revizyon immutable; onay sonrası düzenleme onayı düşürür.
 */
export type ActionStatus =
  | "draft" | "review" | "approved" | "publishing" | "published" | "measuring" | "completed"
  | "failed" | "rejected" | "rolled_back";

const TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  draft: ["review", "rejected"],
  review: ["approved", "rejected", "draft"],
  approved: ["publishing", "draft", "measuring"], // measuring: export-only akışta manuel yayın sonrası
  publishing: ["published", "failed"],
  published: ["measuring", "rolled_back"],
  measuring: ["completed", "rolled_back"],
  completed: [],
  failed: ["draft", "publishing"],
  rejected: ["draft"],
  rolled_back: ["draft"],
};

export function canTransitionAction(from: ActionStatus, to: ActionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const ACTION_TYPES = ["content", "landing", "category", "product", "comparison", "faq", "schema", "citation_task", "ad_draft"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface ActionContent {
  title?: string;
  metaDescription?: string;
  bodyBlocks: Array<{ heading?: string; markdown: string }>;
  internalLinks: Array<{ anchor: string; url: string }>;
  faq: Array<{ q: string; a: string }>;
  jsonLd: Record<string, unknown> | null;
  sources: Array<{ url: string; note?: string }>;
  changeSummary: string;
  placeholders: string[]; // eksik bilgi → review uyarısı
}

export const versionHash = (content: ActionContent) => hashObject(content);

// ── Zorunlu eksikler (yer tutucular) ──

/** Büyük harfli köşeli parantez yer tutucusu: [FİYAT], [ONAYLI İDDİA EKLEYİN]. Markdown bağlantısı ([metin](url)) sayılmaz. */
// [ÜRÜN ADI] gibi büyük harfli tokenlar ve [PLACEHOLDER: ...] / [EKSİK: ...] / [TODO ...] biçimleri.
const PLACEHOLDER_RE = /\[(?:[A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9 _/-]{0,60}|(?:[Pp]laceholder|PLACEHOLDER|EKSİK|Eksik|EKSIK|TODO|TBD|DOLDUR|Doldur)\b[^\]]{0,160})\](?!\()/g;

/** Önizlemede yer tutucuları işaretlemek için (her çağrıda yeni, durumsuz RegExp). */
export const placeholderRegex = () => new RegExp(PLACEHOLDER_RE.source, "g");

export interface ContentIssue {
  /** Editördeki alanın DOM id'si (bağlantı için). */
  fieldId: string;
  fieldLabel: string;
  token: string;
}

/**
 * Yayına engel zorunlu eksikler: görünür içerikte doldurulmamış yer tutucu. `placeholders` listesi
 * bilgilendirici inceleme notlarıdır ve tek başına engel değildir.
 */
export function blockingIssues(c: ActionContent): ContentIssue[] {
  const fields: Array<[string, string, string | undefined]> = [
    ["a-title", "Başlık", c.title],
    ["a-meta", "Meta açıklama", c.metaDescription],
    ...c.bodyBlocks.map((b, i): [string, string, string] => [`a-block-${i}`, b.heading ?? `Blok ${i + 1}`, b.markdown]),
    ...c.faq.flatMap((f, i): Array<[string, string, string]> => [
      [`a-faq-${i}-q`, `SSS ${i + 1} soru`, f.q],
      [`a-faq-${i}-a`, `SSS ${i + 1} yanıt`, f.a],
    ]),
  ];
  const out: ContentIssue[] = [];
  for (const [fieldId, fieldLabel, text] of fields) {
    for (const m of (text ?? "").matchAll(PLACEHOLDER_RE)) out.push({ fieldId, fieldLabel, token: m[0] });
  }
  return out;
}

/** Approval hash race: onay verilen versiyon hash'i güncel versiyonla aynı olmalı. */
export function checkApprovalHash(expectedHash: string, currentHash: string): { ok: true } | { ok: false; code: "conflict" } {
  return expectedHash === currentHash ? { ok: true } : { ok: false, code: "conflict" };
}

/**
 * Rollback yalnız hedefteki mevcut içerik bizim yayımladığımız hash ile aynıysa otomatik;
 * değilse conflict review.
 */
export function rollbackDecision(currentRemoteHash: string | null, ourPublishedHash: string): "auto" | "conflict_review" {
  return currentRemoteHash !== null && currentRemoteHash === ourPublishedHash ? "auto" : "conflict_review";
}

/** Publish: hedef resource hash onaydan sonra değişmişse 409 ve yeni diff. */
export function publishPrecondition(remoteHashAtApproval: string | null, remoteHashNow: string | null): "ok" | "conflict" {
  return remoteHashAtApproval === remoteHashNow ? "ok" : "conflict";
}

// ── JSON-LD doğrulama (yapısal; rich result/AI citation garantisi değildir) ──

const KNOWN_TYPES = new Set(["Product", "FAQPage", "Organization", "BreadcrumbList", "ItemList", "Article", "WebPage", "Offer", "AggregateRating", "Review", "HowTo", "CollectionPage"]);

export interface JsonLdIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export function validateJsonLd(doc: unknown, visibleText = ""): JsonLdIssue[] {
  const issues: JsonLdIssue[] = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return [{ path: "$", message: "JSON-LD bir nesne olmalı", severity: "error" }];
  }
  const d = doc as Record<string, unknown>;
  if (d["@context"] !== "https://schema.org" && d["@context"] !== "http://schema.org") {
    issues.push({ path: "@context", message: "@context https://schema.org olmalı", severity: "error" });
  }
  const type = d["@type"];
  if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
    issues.push({ path: "@type", message: `Desteklenmeyen veya eksik @type: ${String(type)}`, severity: "error" });
  }
  if (type === "Product") {
    if (!d.name) issues.push({ path: "name", message: "Product.name zorunlu", severity: "error" });
    const offers = d.offers as Record<string, unknown> | undefined;
    if (offers) {
      if (offers.price === undefined || offers.priceCurrency === undefined) {
        issues.push({ path: "offers", message: "Offer price ve priceCurrency gerektirir (uydurma fiyat eklemeyin)", severity: "error" });
      }
    }
    if (d.aggregateRating || d.review) {
      issues.push({ path: "aggregateRating", message: "Yorum/puan yalnız görünür ve doğrulanmış veriden eklenebilir", severity: "warning" });
    }
  }
  if (type === "FAQPage") {
    const main = d.mainEntity;
    if (!Array.isArray(main) || main.length === 0) {
      issues.push({ path: "mainEntity", message: "FAQPage en az bir soru içermeli", severity: "error" });
    } else if (visibleText) {
      const vt = visibleText.toLocaleLowerCase("tr-TR");
      main.forEach((q, i) => {
        const name = (q as Record<string, unknown>)?.name;
        if (typeof name === "string" && !vt.includes(name.toLocaleLowerCase("tr-TR"))) {
          issues.push({ path: `mainEntity[${i}]`, message: "FAQ sorusu görünür içerikte yok", severity: "error" });
        }
      });
    }
  }
  return issues;
}

// ── Export ──

export function toMarkdown(c: ActionContent): string {
  const parts: string[] = [];
  if (c.title) parts.push(`# ${c.title}`);
  if (c.metaDescription) parts.push(`> Meta: ${c.metaDescription}`);
  for (const b of c.bodyBlocks) parts.push(`${b.heading ? `## ${b.heading}\n\n` : ""}${b.markdown}`);
  if (c.faq.length) parts.push(`## SSS\n\n${c.faq.map((f) => `**${f.q}**\n\n${f.a}`).join("\n\n")}`);
  if (c.internalLinks.length) parts.push(`## İç link önerileri\n\n${c.internalLinks.map((l) => `- [${l.anchor}](${l.url})`).join("\n")}`);
  if (c.sources.length) parts.push(`## Kaynaklar\n\n${c.sources.map((s) => `- ${s.url}${s.note ? ` — ${s.note}` : ""}`).join("\n")}`);
  if (c.placeholders.length) parts.push(`## İnceleme gerekli\n\n${c.placeholders.map((p) => `- ${p}`).join("\n")}`);
  return parts.join("\n\n");
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function toHtml(c: ActionContent): string {
  const parts: string[] = [];
  if (c.title) parts.push(`<h1>${escapeHtml(c.title)}</h1>`);
  for (const b of c.bodyBlocks) {
    if (b.heading) parts.push(`<h2>${escapeHtml(b.heading)}</h2>`);
    for (const para of b.markdown.split(/\n{2,}/)) parts.push(`<p>${escapeHtml(para)}</p>`);
  }
  if (c.faq.length) {
    parts.push("<h2>SSS</h2>");
    for (const f of c.faq) parts.push(`<h3>${escapeHtml(f.q)}</h3><p>${escapeHtml(f.a)}</p>`);
  }
  if (c.jsonLd) {
    // "</" kaçışı script injection'ı önler.
    parts.push(`<script type="application/ld+json">${JSON.stringify(c.jsonLd).replace(/</g, "\\u003c")}</script>`);
  }
  return parts.join("\n");
}

/** Satır bazlı basit diff (split diff görünümü için). */
export function lineDiff(before: string, after: string): Array<{ type: "same" | "added" | "removed"; text: string }> {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Array<{ type: "same" | "added" | "removed"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ type: "removed", text: a[i++]! });
    else out.push({ type: "added", text: b[j++]! });
  }
  while (i < m) out.push({ type: "removed", text: a[i++]! });
  while (j < n) out.push({ type: "added", text: b[j++]! });
  return out;
}
