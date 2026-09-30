import { safeFetch, type SafeResponse } from "@/lib/http/safe-fetch";
import { sha256 } from "@/lib/crypto";
import { classifyPage, extractPage, isAllowedByRobots, parseRobots, parseSitemap, type PageFacts } from "./html";

/**
 * Crawler (§4): robots'a uyar; yalnız public http(s), doğrulanmış domain altı; sitemap paginasyonu,
 * canonical dedupe, içerik hash'i, timeout/byte/page/depth/rate limit. Login/paywall bypass yok.
 */
export type Fetcher = (url: string, opts: { sameSiteAs: string; headers?: Record<string, string> }) => Promise<SafeResponse>;

export const liveFetcher: Fetcher = (url, opts) =>
  safeFetch(url, { sameSiteAs: opts.sameSiteAs, headers: opts.headers, maxBytes: 1_500_000, timeoutMs: 10_000, maxRedirects: 4 });

export interface CrawledPage {
  url: string;
  canonical: string | null;
  status: number;
  pageType: string;
  contentHash: string;
  etag: string | null;
  facts: PageFacts;
}

export interface CrawlResult {
  domain: string;
  robotsFound: boolean;
  robotsDisallowAll: boolean;
  sitemapFound: boolean;
  pages: CrawledPage[];
  failed: Array<{ url: string; reason: string }>;
  skippedByRobots: number;
  truncated: boolean;
}

export interface CrawlOptions {
  domain: string;
  maxPages: number;
  maxDepth?: number;
  delayMs?: number;
  fetcher?: Fetcher;
  onProgress?: (done: number, total: number) => void | Promise<void>;
  previous?: Map<string, { etag: string | null; contentHash: string }>;
}

export function normalizeDomain(input: string): string {
  const raw = input.trim().toLowerCase();
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  const u = new URL(withScheme);
  return u.hostname.replace(/^www\./, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function crawlSite(opts: CrawlOptions): Promise<CrawlResult> {
  const fetcher = opts.fetcher ?? liveFetcher;
  const domain = opts.domain;
  const origin = `https://${domain}`;
  const maxDepth = opts.maxDepth ?? 3;
  const result: CrawlResult = { domain, robotsFound: false, robotsDisallowAll: false, sitemapFound: false, pages: [], failed: [], skippedByRobots: 0, truncated: false };

  let disallow: string[] = [];
  let sitemapUrls: string[] = [`${origin}/sitemap.xml`];
  try {
    const r = await fetcher(`${origin}/robots.txt`, { sameSiteAs: domain });
    if (r.status === 200) {
      result.robotsFound = true;
      const parsed = parseRobots(r.body);
      disallow = parsed.disallow;
      if (parsed.sitemaps.length) sitemapUrls = parsed.sitemaps;
      result.robotsDisallowAll = disallow.includes("/");
    }
  } catch {
    /* robots yok → varsayılan izin */
  }

  const queue: Array<{ url: string; depth: number }> = [{ url: `${origin}/`, depth: 0 }];
  // Sitemap (index paginasyonu dahil, sınırlı)
  const seenSitemaps = new Set<string>();
  while (sitemapUrls.length && seenSitemaps.size < 5) {
    const sm = sitemapUrls.shift()!;
    if (seenSitemaps.has(sm)) continue;
    seenSitemaps.add(sm);
    try {
      const r = await fetcher(sm, { sameSiteAs: domain });
      if (r.status !== 200) continue;
      result.sitemapFound = true;
      const parsed = parseSitemap(r.body);
      sitemapUrls.push(...parsed.sitemaps);
      for (const u of parsed.urls.slice(0, opts.maxPages * 3)) queue.push({ url: u, depth: 1 });
    } catch {
      /* sitemap erişilemedi */
    }
  }

  const visited = new Set<string>();
  const canonicals = new Set<string>();
  while (queue.length && result.pages.length < opts.maxPages) {
    const { url, depth } = queue.shift()!;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    const host = u.hostname.replace(/^www\./, "");
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    u.hash = "";
    const key = u.toString();
    if (visited.has(key)) continue;
    visited.add(key);
    if (!isAllowedByRobots(u.pathname, disallow)) {
      result.skippedByRobots++;
      continue;
    }
    try {
      const prev = opts.previous?.get(key);
      const r = await fetcher(key, { sameSiteAs: domain, headers: prev?.etag ? { "if-none-match": prev.etag } : undefined });
      if (r.status === 304 && prev) continue; // delta: değişmemiş
      if (r.status >= 400) {
        result.failed.push({ url: key, reason: `http_${r.status}` });
        continue;
      }
      const ct = r.headers["content-type"] ?? "";
      if (ct && !ct.includes("html")) continue;
      const facts = extractPage(r.body, r.url);
      const canonical = facts.canonical ? safeAbs(facts.canonical, r.url) : null;
      const canonKey = canonical ?? key;
      if (canonicals.has(canonKey)) continue; // canonical dedupe
      canonicals.add(canonKey);
      result.pages.push({
        url: key,
        canonical,
        status: r.status,
        pageType: classifyPage(key, facts),
        contentHash: sha256(r.body),
        etag: r.headers.etag || null,
        facts,
      });
      await opts.onProgress?.(result.pages.length, Math.min(opts.maxPages, visited.size + queue.length));
      if (depth < maxDepth) for (const l of facts.links) queue.push({ url: l, depth: depth + 1 });
      if (opts.delayMs) await sleep(opts.delayMs);
    } catch (e) {
      result.failed.push({ url: key, reason: (e as Error).message.slice(0, 120) });
    }
  }
  result.truncated = queue.length > 0;
  return result;
}

function safeAbs(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}
