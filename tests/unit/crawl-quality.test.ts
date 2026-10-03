import { describe, expect, it } from "vitest";
import { pinnedLookup } from "@/lib/http/safe-fetch";
import { classifyPage } from "@/modules/audit/html";
import { auditPrompts, deriveCategoryTerms } from "@/modules/audit/service";

describe("sabitlenmiş DNS lookup", () => {
  it("Node'un { all: true } çağrısına adres dizisiyle yanıt verir", () => {
    const lookup = pinnedLookup("93.184.216.34", 4);
    let all: unknown;
    lookup("x.com", { all: true }, (_e, a) => (all = a));
    expect(all).toEqual([{ address: "93.184.216.34", family: 4 }]);
    let single: unknown[] = [];
    lookup("x.com", {}, (_e, a, f) => (single = [a, f]));
    expect(single).toEqual(["93.184.216.34", 4]);
  });
});

describe("tarama sınıflandırması ve soru üretimi", () => {
  const p = (category: string) => ({ category });
  it("çok ürünlü liste sayfası kategori, tek ürünlü sayfa ürün; ana sayfa ana sayfadır", () => {
    expect(classifyPage("https://m.com/mocca-koltuklar", { schemaTypes: [], products: [p("a") as never, p("b") as never] })).toBe("category");
    expect(classifyPage("https://m.com/mocca-koltuk-gri", { schemaTypes: [], products: [p("a") as never] })).toBe("product");
    expect(classifyPage("https://m.com/", { schemaTypes: [], products: [p("a") as never, p("b") as never] })).toBe("home");
  });

  it("model adları yerine paylaşılan genel kategori terimleri seçilir", () => {
    const pages = [
      { pageType: "category", facts: { h1: null, title: "Mocca Koltuk", products: [p("Mobilya >Mocca Katlanır Koltuk"), p("Mobilya >Magic Katlanır Koltuk")] } },
      { pageType: "category", facts: { h1: null, title: "Coop Puf", products: [p("Mobilya >Coop Puf Seti"), p("Mobilya >Loop Puf Seti")] } },
    ];
    const terms = deriveCategoryTerms(pages);
    expect(terms).toEqual(["Katlanır Koltuk", "Puf Seti", "Mobilya"]);
    const prompts = auditPrompts(terms, "TR");
    expect(prompts).toHaveLength(5);
    expect(prompts.join(" ")).not.toMatch(/mocca|magic|hassas cilt/i);
  });
});
