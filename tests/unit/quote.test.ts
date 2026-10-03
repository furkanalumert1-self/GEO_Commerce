import { describe, expect, it } from "vitest";
import { cleanQuote } from "@/lib/quote";

describe("alıntı temizleme", () => {
  it("markdown bağlantı, kalın ve yarım kelimeyi temizler", () => {
    const q = cleanQuote(".999 TL**. - Küçük stüdyo daire için benim ilk tercihlerimden biri olurdu. ([ikea.com.tr](https://www.ikea.com.tr/urun/x?utm_source=openai)) 4. **IKEA TORNSBOR");
    expect(q).not.toMatch(/\]\(|https?:|\*\*/);
    expect(q).toContain("(ikea.com.tr)");
    expect(q.startsWith("…")).toBe(true);
  });
  it("tablo çizgilerini ayırıcıya çevirir", () => {
    const q = cleanQuote("anlar için; 10 yıl garanti ([ikea.com.tr](https://x)) | | **Kelebek** | İkili ve üçlü yata");
    expect(q).not.toContain("|");
    expect(q).toContain("Kelebek");
  });
});
