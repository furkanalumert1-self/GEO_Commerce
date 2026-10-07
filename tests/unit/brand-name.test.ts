import { describe, expect, it } from "vitest";
import { cleanBrandName, homeBrandName } from "@/modules/audit/business";
import { isCompetitorCandidate } from "@/modules/audit/competitor-filter";

const home = (facts: { title?: string | null; h1?: string | null; ogSiteName?: string | null }) =>
  ({ url: "https://x/", pageType: "home", facts: { title: null, h1: null, ogSiteName: null, metaDescription: null, schemaTypes: [], products: [], links: [], breadcrumbs: [], lang: "tr", ...facts } }) as never;

describe("marka adı", () => {
  it("başlıktaki genel ekleri ve tekrarı temizler", () => {
    expect(cleanBrandName("English Home Online Alışveriş | English Home", "englishhome.com")).toBe("English Home");
    expect(cleanBrandName("Karaca Online Alışveriş Sitesi", "karaca.com")).toBe("Karaca");
    expect(cleanBrandName("Folinea® – Advanced Hair Growth", "folinea.com")).toBe("Folinea");
    expect(cleanBrandName("Madame Coco | Resmi Web Sitesi", "madamecoco.com")).toBe("Madame Coco");
  });

  it("site adı yoksa başlıktan yalnız alan adıyla eşleşen parça alınır; kampanya başlığı marka olmaz", () => {
    expect(homeBrandName(home({ title: "Yeni Sezon Ev Tekstili | English Home" }), "englishhome.com")).toBe("English Home");
    expect(homeBrandName(home({ title: "Yeni sezon indirimleri", h1: "Kampanyalar" }), "lumabakim.com.tr")).toBe("lumabakim");
  });
});

describe("rakip adayı", () => {
  it("sağlık ve bilgi otoriteleri rakip adayı olmaz", () => {
    expect(isCompetitorCandidate("mayoclinic.org")).toBe(false);
    expect(isCompetitorCandidate("www.sleepfoundation.org")).toBe(false);
    expect(isCompetitorCandidate("ikea.com.tr")).toBe(true);
  });
});
