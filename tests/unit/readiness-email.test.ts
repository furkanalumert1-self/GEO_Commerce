import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "@/modules/audit/readiness";
import type { CrawlResult } from "@/modules/audit/crawler";
import { normalizeFrom, resendErrorMessage } from "@/adapters/email";

const page = (url: string, links: string[]) =>
  ({ url, status: 200, pageType: "home", facts: { title: null, metaDescription: null, canonical: null, robotsNoindex: false, lang: "tr", h1: null, textLength: 1000, links, jsonLd: [], schemaTypes: [], products: [], ogSiteName: null, trackers: [] } }) as unknown as CrawlResult["pages"][number];

const crawl = (links: string[]): CrawlResult => ({ domain: "magaza.com", robotsFound: true, robotsDisallowAll: false, sitemapFound: true, pages: [page("https://www.magaza.com/", links)], failed: [], skippedByRobots: 0, truncated: false });

describe("readiness: politika ve iletişim bağlantıları", () => {
  it("taranmamış ama bağlantısı olan sayfaları tespit eder", () => {
    const r = evaluateReadiness(crawl(["https://www.magaza.com/iade-ve-degisim", "https://www.magaza.com/kvkk-aydinlatma", "https://www.magaza.com/iletisim"]));
    expect(r.checks.find((c) => c.id === "policy_pages")?.status).toBe("pass");
    expect(r.checks.find((c) => c.id === "contact_page")?.status).toBe("pass");
  });

  it("başka alan adlarındaki bağlantıları saymaz", () => {
    const r = evaluateReadiness(crawl(["https://baska.com/iletisim", "https://baska.com/iade", "https://baska.com/gizlilik"]));
    expect(r.checks.find((c) => c.id === "policy_pages")?.status).toBe("not_detected");
    expect(r.checks.find((c) => c.id === "contact_page")?.status).toBe("not_detected");
  });
});

describe("e-posta: Resend hata mesajları", () => {
  it("doğrulanmamış alan adını açıklar", async () => {
    const res = new Response(JSON.stringify({ name: "validation_error", message: "The gmail.com domain is not verified." }), { status: 403 });
    const msg = await resendErrorMessage(res);
    expect(msg).toContain("Resend 403");
    expect(msg).toContain("doğrulanmamış");
    expect(msg).toContain("gmail.com domain is not verified");
  });

  it("geçersiz anahtarı açıklar", async () => {
    expect(await resendErrorMessage(new Response(JSON.stringify({ message: "API key is invalid" }), { status: 401 }))).toContain("RESEND_API_KEY geçersiz");
  });

  it("EMAIL_FROM tırnaklarını temizler", () => {
    expect(normalizeFrom('"Callypso <no-reply@ornek.com>"')).toBe("Callypso <no-reply@ornek.com>");
    expect(normalizeFrom("  ")).toBeUndefined();
  });
});
