import type { SafeResponse } from "@/lib/http/safe-fetch";
import type { Fetcher } from "./crawler";

/**
 * Demo modu için hayali mağaza sitesi (lumabakim.example). Dış çağrı yapılmaz.
 * Yalnız .example alan adları için kullanılır; gerçek bir alan adına örnek veri atfedilmez.
 */
export const DEMO_CATEGORIES = [
  { slug: "nemlendirici", name: "Nemlendiriciler" },
  { slug: "serum", name: "Serumlar" },
  { slug: "gunes-kremi", name: "Güneş Kremleri" },
  { slug: "temizleyici", name: "Yüz Temizleyiciler" },
  { slug: "maske", name: "Maskeler" },
];

const ADJ = ["Hassas", "Yoğun", "Hafif", "Onarıcı", "Dengeleyici", "Nazik"];

export function demoProducts() {
  return Array.from({ length: 30 }, (_, i) => {
    const cat = DEMO_CATEGORIES[i % DEMO_CATEGORIES.length]!;
    const adj = ADJ[i % ADJ.length]!;
    const price = 18990 + ((i * 3701) % 40000);
    return {
      id: `LB-${String(i + 1).padStart(3, "0")}`,
      slug: `urun-${i + 1}`,
      name: `${adj} ${cat.name.replace(/ler$|lar$/, "")} ${i + 1}`,
      category: cat,
      priceMinor: price,
      stock: i % 7 === 0 ? 0 : 10 + (i % 25),
      // Bazı ürünlerde şema eksik (readiness/fırsat senaryosu).
      schemaComplete: i % 4 !== 0,
    };
  });
}

let currentPath = "/";
function page(title: string, body: string, extraHead = "") {
  return `<!doctype html><html lang="tr"><head><title>${title}</title><meta name="description" content="${title} — Luma Bakım"><link rel="canonical" href="https://lumabakim.example${currentPath}">${extraHead}</head><body>${body}</body></html>`;
}

function render(path: string): { status: number; body: string; type: string } {
  currentPath = path;
  const products = demoProducts();
  const nav = `<nav>${DEMO_CATEGORIES.map((c) => `<a href="/kategori/${c.slug}">${c.name}</a>`).join(" ")} <a href="/iade-politikasi">İade</a> <a href="/gizlilik">Gizlilik</a> <a href="/iletisim">İletişim</a></nav>`;
  const filler = "<p>Luma Bakım, hassas ve kuru ciltler için dermatolojik olarak test edilmiş, parfümsüz formüller geliştiren bir cilt bakım markasıdır. Ürünlerimizin içerik listelerini açıkça paylaşıyor, her ürün sayfasında kullanım önerileri ve cilt tipi uygunluğunu belirtiyoruz. Kargo ve iade koşullarımız ayrıntılı olarak politika sayfalarında yer alır.</p>";
  if (path === "/robots.txt") return { status: 200, body: "User-agent: *\nDisallow: /hesabim\nSitemap: https://lumabakim.example/sitemap.xml\n", type: "text/plain" };
  if (path === "/sitemap.xml") {
    const urls = ["/", ...DEMO_CATEGORIES.map((c) => `/kategori/${c.slug}`), ...products.slice(0, 12).map((p) => `/urun/${p.slug}`), "/iade-politikasi", "/gizlilik", "/iletisim"];
    return { status: 200, type: "application/xml", body: `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>https://lumabakim.example${u}</loc></url>`).join("")}</urlset>` };
  }
  if (path === "/") {
    const org = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", name: "Luma Bakım", url: "https://lumabakim.example" })}</script>`;
    return { status: 200, type: "text/html", body: page("Luma Bakım — Hassas cilt bakımı", `<h1>Luma Bakım</h1>${nav}${filler}${filler}`, `${org}<meta property="og:site_name" content="Luma Bakım">`) };
  }
  const cat = DEMO_CATEGORIES.find((c) => path === `/kategori/${c.slug}`);
  if (cat) {
    const list = products.filter((p) => p.category.slug === cat.slug);
    return { status: 200, type: "text/html", body: page(`${cat.name} | Luma Bakım`, `<h1>${cat.name}</h1>${nav}<ul>${list.map((p) => `<li><a href="/urun/${p.slug}">${p.name}</a></li>`).join("")}</ul><p>Kısa kategori açıklaması.</p>`) };
  }
  const prod = products.find((p) => path === `/urun/${p.slug}`);
  if (prod) {
    const ld = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: prod.name,
      sku: prod.id,
      category: prod.category.name,
      ...(prod.schemaComplete
        ? { offers: { "@type": "Offer", price: (prod.priceMinor / 100).toFixed(2), priceCurrency: "TRY", availability: prod.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } }
        : {}),
    };
    return { status: 200, type: "text/html", body: page(`${prod.name} | Luma Bakım`, `<h1>${prod.name}</h1>${nav}${filler}`, `<script type="application/ld+json">${JSON.stringify(ld)}</script>`) };
  }
  if (["/iade-politikasi", "/gizlilik", "/iletisim"].includes(path)) {
    return { status: 200, type: "text/html", body: page("Bilgi | Luma Bakım", `<h1>Bilgi</h1>${nav}${filler}`) };
  }
  return { status: 404, type: "text/html", body: "not found" };
}

export const fixtureFetcher: Fetcher = async (url) => {
  const u = new URL(url);
  if (!u.hostname.endsWith(".example")) throw new Error("Demo modunda yalnız .example alan adları taranabilir");
  const r = render(u.pathname);
  const res: SafeResponse = { url: u.toString(), status: r.status, headers: { "content-type": r.type }, body: r.body, truncated: false };
  return res;
};
