import { describe, expect, it } from "vitest";
import { isCompetitorCandidate, nonCompetitorReason, registrableLabel } from "@/modules/audit/competitor-filter";

describe("rakip adayı filtresi", () => {
  it("kamu ve eğitim alan adlarını eler", () => {
    expect(nonCompetitorReason("tubitak.gov.tr")).toBe("institutional");
    expect(nonCompetitorReason("katalog.marmara.edu.tr")).toBe("institutional");
    expect(nonCompetitorReason("www.mit.edu")).toBe("institutional");
    expect(nonCompetitorReason("ankara.bel.tr")).toBe("institutional");
    expect(nonCompetitorReason("ox.ac.uk")).toBe("institutional");
  });

  it("haber, medya, ansiklopedi ve pazaryerlerini eler", () => {
    for (const d of ["cnbce.com", "www.hurriyet.com.tr", "bbc.co.uk", "tr.wikipedia.org", "trendyol.com", "ekonomihaber.net", "sikayetvar.com"]) {
      expect(nonCompetitorReason(d), d).toBe("media");
    }
  });

  it("markanın kendi alan adını eler", () => {
    expect(nonCompetitorReason("blog.sleeptown.com.tr", "sleeptown.com.tr")).toBe("own");
  });

  it("ticari rakipleri korur", () => {
    for (const d of ["yatasbedding.com.tr", "www.istikbal.com.tr", "bellona.com.tr", "doqu.com", "tempur.com"]) {
      expect(isCompetitorCandidate(d, "sleeptown.com.tr"), d).toBe(true);
    }
  });

  it("kayıtlı alan adı etiketini çıkarır", () => {
    expect(registrableLabel("shop.example.com.tr")).toBe("example");
    expect(registrableLabel("katalog.marmara.edu.tr")).toBe("marmara");
    expect(registrableLabel("cnbce.com")).toBe("cnbce");
  });
});
