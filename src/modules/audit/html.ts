/**
 * Hafif HTML/JSON-LD çıkarımı (crawler). Bilgi yoksa null — uydurma yok.
 * Crawl içeriği güvenilmeyen veridir; içindeki talimatlar izlenmez.
 */
export interface ProductFacts {
  name: string | null;
  description: string | null;
  category: string | null;
  price: string | null;
  currency: string | null;
  availability: string | null;
  sku: string | null;
  image: string | null;
  url: string | null;
}

export interface PageFacts {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsNoindex: boolean;
  lang: string | null;
  h1: string | null;
  textLength: number;
  links: string[];
  jsonLd: unknown[];
  schemaTypes: string[];
  products: ProductFacts[];
  ogSiteName: string | null;
  trackers: string[];
  /** BreadcrumbList adları (ana sayfa hariç, sırayla); kategori ipucu olarak kullanılır. */
  breadcrumbs?: string[];
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function metaContent(html: string, key: string, by: "name" | "property" = "name"): string | null {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const v = attr(m[0], by);
    if (v && v.toLowerCase() === key.toLowerCase()) return attr(m[0], "content");
  }
  return null;
}

export function visibleText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const HOME_CRUMB = /^(ana ?sayfa|home|homepage|başlangıç)$/i;

function collectTypes(node: unknown, out: Set<string>, products: ProductFacts[], baseUrl: string, crumbs: string[] = []) {
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, out, products, baseUrl, crumbs));
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const t = o["@type"];
  const types = Array.isArray(t) ? t : t ? [t] : [];
  for (const x of types) if (typeof x === "string") out.add(x);
  if (types.includes("BreadcrumbList") && Array.isArray(o.itemListElement) && crumbs.length === 0) {
    const items = (o.itemListElement as Array<Record<string, unknown>>)
      .filter((x) => x && typeof x === "object")
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((x) => {
        const item = x.item as Record<string, unknown> | string | undefined;
        const name = x.name ?? (typeof item === "object" ? item?.name : undefined);
        return typeof name === "string" ? decode(name).trim() : "";
      })
      .filter((n) => n && !HOME_CRUMB.test(n));
    crumbs.push(...items);
  }
  if (types.includes("Product")) {
    const offers = (Array.isArray(o.offers) ? o.offers[0] : o.offers) as Record<string, unknown> | undefined;
    const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);
    const img = Array.isArray(o.image) ? o.image[0] : o.image;
    products.push({
      name: str(o.name),
      description: str(o.description),
      category: str(o.category),
      price: str(offers?.price ?? (offers?.priceSpecification as Record<string, unknown> | undefined)?.price),
      currency: str(offers?.priceCurrency),
      availability: str(offers?.availability)?.replace(/^https?:\/\/schema\.org\//, "") ?? null,
      sku: str(o.sku),
      image: typeof img === "string" ? img : str((img as Record<string, unknown> | undefined)?.url),
      url: str(o.url) ?? baseUrl,
    });
  }
  for (const v of Object.values(o)) if (v && typeof v === "object") collectTypes(v, out, products, baseUrl, crumbs);
}

const TRACKER_PATTERNS: Array<[RegExp, string]> = [
  [/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/, "google_tag_manager"],
  [/gtag\(|googletagmanager\.com\/gtag/, "google_tag"],
  [/connect\.facebook\.net|fbq\(/, "meta_pixel"],
  [/analytics\.tiktok\.com|ttq\./, "tiktok_pixel"],
  [/geo-commerce-tracker|\/t\.js\?k=/, "geo_commerce_tracker"],
];

function microdataBreadcrumbs(html: string): string[] {
  const start = html.search(/itemtype\s*=\s*["']https?:\/\/schema\.org\/BreadcrumbList["']/i);
  if (start < 0) return [];
  const rest = html.slice(start, start + 20_000);
  const end = rest.search(/<\/(ol|ul|nav)>/i);
  const block = end > 0 ? rest.slice(0, end) : rest.slice(0, 5_000);
  return [...block.matchAll(/itemprop\s*=\s*["']name["'][^>]*>([^<]{1,120})</gi)]
    .map((m) => decode(m[1]!).trim())
    .filter((n) => n && !HOME_CRUMB.test(n));
}

export function extractPage(html: string, url: string): PageFacts {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const canonicalTag = (html.match(/<link\b[^>]*rel\s*=\s*["']?canonical["']?[^>]*>/i) ?? [])[0];
  const htmlTag = (html.match(/<html\b[^>]*>/i) ?? [])[0];
  const robots = metaContent(html, "robots") ?? "";
  const links: string[] = [];
  const linkRe = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html)) && links.length < 500) {
    const href = decode(lm[2] ?? lm[3] ?? "");
    // İstemci şablonu yer tutucuları ({{url}}) gerçek bağlantı değildir.
    if (/\{\{|\}\}|\$\{/.test(href)) continue;
    try {
      const abs = new URL(href, url);
      if (abs.protocol === "http:" || abs.protocol === "https:") {
        abs.hash = "";
        links.push(abs.toString());
      }
    } catch {
      /* geçersiz link */
    }
  }
  const jsonLd: unknown[] = [];
  const ldRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jm: RegExpExecArray | null;
  while ((jm = ldRe.exec(html))) {
    try {
      jsonLd.push(JSON.parse(jm[1]!.trim()));
    } catch {
      jsonLd.push({ __invalid: true });
    }
  }
  const types = new Set<string>();
  const products: ProductFacts[] = [];
  const breadcrumbs: string[] = [];
  collectTypes(jsonLd, types, products, url, breadcrumbs);
  // Microdata (itemtype="https://schema.org/X"): tip listesi ve JSON-LD yoksa breadcrumb adları.
  for (const m of html.matchAll(/itemtype\s*=\s*["']https?:\/\/schema\.org\/([A-Za-z]+)["']/gi)) types.add(m[1]!);
  if (!breadcrumbs.length) breadcrumbs.push(...microdataBreadcrumbs(html));
  const text = visibleText(html);
  return {
    title: titleM ? visibleText(titleM[1]!) || null : null,
    metaDescription: metaContent(html, "description"),
    canonical: canonicalTag ? attr(canonicalTag, "href") : null,
    robotsNoindex: /noindex/i.test(robots),
    lang: htmlTag ? attr(htmlTag, "lang") : null,
    h1: h1M ? visibleText(h1M[1]!) || null : null,
    textLength: text.length,
    links: [...new Set(links)],
    jsonLd,
    schemaTypes: [...types],
    products,
    ogSiteName: metaContent(html, "og:site_name", "property"),
    trackers: TRACKER_PATTERNS.filter(([re]) => re.test(html)).map(([, n]) => n),
    breadcrumbs,
  };
}

/** robots.txt — User-agent: * ve bot adımız için Disallow kuralları. */
export function parseRobots(txt: string, agent = "geocommercebot"): { disallow: string[]; sitemaps: string[] } {
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  let applies = false;
  let sawAgentLine = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [kRaw, ...rest] = line.split(":");
    const k = kRaw!.trim().toLowerCase();
    const v = rest.join(":").trim();
    if (k === "sitemap") sitemaps.push(v);
    else if (k === "user-agent") {
      const ua = v.toLowerCase();
      if (!sawAgentLine) applies = false;
      applies = applies || ua === "*" || ua === agent;
      sawAgentLine = true;
    } else {
      sawAgentLine = false;
      if (k === "disallow" && applies && v) disallow.push(v);
    }
  }
  return { disallow, sitemaps };
}

export function isAllowedByRobots(pathname: string, disallow: string[]): boolean {
  return !disallow.some((d) => {
    if (d.endsWith("$")) return pathname === d.slice(0, -1);
    const prefix = d.replace(/\*.*$/, "");
    return pathname.startsWith(prefix);
  });
}

export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]!));
  const isIndex = /<sitemapindex/i.test(xml);
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

export function classifyPage(url: string, facts: Pick<PageFacts, "schemaTypes" | "products">): string {
  const p = new URL(url).pathname.toLowerCase();
  if (p === "/" || p === "") return "home";
  if (/\/(kategori|category|collections?|c)\//.test(p) || facts.schemaTypes.includes("CollectionPage")) return "category";
  // Birden çok ürün listeleyen sayfa (kategori/koleksiyon), tek ürün detay sayfası değildir.
  if (facts.products.length > 1) return "category";
  if (facts.products.length === 1 || /\/(urun|product|p)\//.test(p)) return "product";
  if (/(iade|return|refund|kargo|shipping|gizlilik|privacy|kvkk|mesafeli|terms|sozlesme)/.test(p)) return "policy";
  if (/(iletisim|contact|hakkimizda|about)/.test(p)) return "contact";
  return "other";
}
