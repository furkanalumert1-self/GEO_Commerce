import { describe, expect, it } from "vitest";
import { isOutreachTarget } from "@/modules/audit/competitor-filter";
import { citationForQuote } from "@/modules/opportunities/engine";

describe("alıntı–kaynak eşleşmesi", () => {
  const cits = [
    { url: "https://www.kraftfoods.com/yastik", domain: "kraftfoods.com" },
    { url: "https://www.ikea.com.tr/yastik", domain: "ikea.com.tr" },
  ];
  it("alıntıda geçen alan adını seçer, ilk kaynağı değil", () => {
    expect(citationForQuote("… serinletici yüzey gibi özellikleri daha uygun fiyatlarla sunuyor (ikea.com.tr) - Bambi", cits)).toBe("https://www.ikea.com.tr/yastik");
    expect(citationForQuote("IKEA yastıkları uygun fiyatlı", cits)).toBe("https://www.ikea.com.tr/yastik");
  });
  it("eşleşme yoksa kaynak bağlanmaz", () => {
    expect(citationForQuote("Bambi ve Yataş öne çıkıyor", cits)).toBeNull();
    expect(citationForQuote(null, cits)).toBeNull();
  });
  it("alıntıyla örtüşen kaynak alıntısını kullanır", () => {
    expect(citationForQuote("Visco yastıklar boyun ağrısı için önerilir ve uzun ömürlüdür", [{ url: "https://blog.example/visco", domain: "blog.example", excerpt: "visco yastıklar boyun ağrısı için önerilir" }])).toBe("https://blog.example/visco");
  });
});

describe("diğer sitelerde görünürlük hedefi", () => {
  it("kamu, akademik ve genel bilgi kaynakları hedef değildir", () => {
    for (const d of ["cdc.gov", "www.nih.gov", "ncbi.nlm.nih.gov", "tr.wikipedia.org", "saglik.gov.tr", "youtube.com"]) expect(isOutreachTarget(d, "sleeptown.com.tr"), d).toBe(false);
  });
  it("medya, inceleme ve pazaryeri siteleri hedef olabilir; rakip mağaza ve kendi site olamaz", () => {
    expect(isOutreachTarget("hurriyet.com.tr", "sleeptown.com.tr")).toBe(true);
    expect(isOutreachTarget("trendyol.com", "sleeptown.com.tr")).toBe(true);
    expect(isOutreachTarget("yatas.com.tr", "sleeptown.com.tr")).toBe(false);
    expect(isOutreachTarget("sleeptown.com.tr", "sleeptown.com.tr")).toBe(false);
  });
});
