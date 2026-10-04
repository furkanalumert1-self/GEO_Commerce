import { describe, expect, it } from "vitest";
import { canonicalizeUrl, extract, type Entity } from "@/modules/monitoring/extract";

const entities: Entity[] = [
  { id: "b", type: "brand", name: "Luma Bakım", aliases: ["Luma"], domain: "lumabakim.example" },
  { id: "c1", type: "competitor", name: "Nora Cilt", aliases: [], domain: "noracilt.example" },
];

describe("extract", () => {
  it("açık listede rank verir, listede değilse rank null", () => {
    const r = extract("Öneriler:\n1. Nora Cilt — iyi\n2. Luma Bakım — iyi", [], entities);
    expect(r.listDetected).toBe(true);
    expect(r.mentions.find((m) => m.entityId === "b")?.rank).toBe(2);
    const r2 = extract("Luma Bakım ve Nora Cilt sık anılıyor.", [], entities);
    expect(r2.mentions.every((m) => m.rank === null)).toBe(true);
  });
  it("Türkçe ekli adları yakalar", () => {
    const r = extract("Luma'nın serumu popüler.", [], entities);
    expect(r.mentions.some((m) => m.entityId === "b")).toBe(true);
  });
  it("kelime içinde geçen alias eşleşmez", () => {
    const r = extract("Illuminator serisi", [], entities);
    expect(r.mentions).toHaveLength(0);
  });
  it("negatif mention ayrı", () => {
    const r = extract("Nora Cilt ürünlerini önermem.", [], entities);
    expect(r.mentions[0]?.kind).toBe("negative");
  });
  it("citation own/competitor/third_party ve utm temizliği", () => {
    const r = extract("x", ["https://www.lumabakim.example/a?utm_source=x", "https://noracilt.example/b", "https://forum.example/c"], entities);
    expect(r.citations.map((c) => c.association)).toEqual(["own", "competitor", "third_party"]);
    expect(r.citations[0]?.canonicalUrl).toBe("https://lumabakim.example/a");
  });
  it("javascript: URL reddedilir", () => {
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("sıra yazılan numaradır; alt maddeler ve ikinci liste sayacı bozmaz", () => {
    const ents = [{ id: "y", type: "competitor" as const, name: "Yataş", aliases: [], domain: "yatas.com.tr" }, { id: "b", type: "competitor" as const, name: "Bellona", aliases: [], domain: "bellona.com.tr" }];
    const text = "Öneriler:\n\n1. Yataş\n   - Ortopedik seri\n   - Visco seri\n2. İstikbal\n3. Doqu\n4. Bellona\n\nDikkat edilecekler:\n- Sertlik\n- Garanti";
    const r = extract(text, [], ents);
    expect(r.mentions.find((m) => m.entityId === "y")?.rank).toBe(1);
    expect(r.mentions.find((m) => m.entityId === "b")?.rank).toBe(4);
  });
});
