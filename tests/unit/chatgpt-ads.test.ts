import { describe, expect, it } from "vitest";
import { apiPayload, contextHints, policyIssues, validateChatgptAd } from "@/modules/ads/chatgpt";

const base = { brandDomain: "homedius.com", country: "TR", categories: ["Yataklı Koltuk", "Puf Seti"] };

describe("ChatGPT Ads taslak kuralları", () => {
  it("geçerli sohbet kartında hata yok; TR için bağlamsal bilgi notu var", () => {
    const issues = validateChatgptAd({ ...base, title: "Yataklı Koltuk Modelleri", body: "Küçük evler için yer kazandıran koltuk modelleri", targetUrl: "https://www.homedius.com/yatakli-koltuk" });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(issues.some((i) => i.field === "market" && i.level === "info")).toBe(true);
  });

  it("karakter sınırı, alan adı ve abartılı iddia kontrolleri", () => {
    const issues = validateChatgptAd({ ...base, title: "x".repeat(51), body: "Türkiye'nin en iyi koltuğu, garantili!!", targetUrl: "https://baska.com/" });
    expect(issues.filter((i) => i.level === "error").map((i) => i.field).sort()).toEqual(["targetUrl", "title"]);
    expect(issues.some((i) => i.message.includes("Abartılı"))).toBe(true);
  });

  it("yasak ve kısıtlı kategoriler", () => {
    expect(policyIssues(["Alkol", "Şarap"], "TR").some((i) => i.level === "error")).toBe(true);
    expect(policyIssues(["Sağlık takviyesi"], "TR")[0]!.level).toBe("error");
    expect(policyIssues(["Sağlık takviyesi"], "US")[0]!.level).toBe("warning");
    expect(policyIssues(["Yataklı Koltuk"], "TR")).toEqual([]);
  });

  it("bağlam ipuçları sorulardan ve kategoriden üretilir; API taslağı duraklatılmış ve micros", () => {
    const hints = contextHints({ prompts: ["Türkiye'de en iyi yataklı koltuk markaları hangileri?"], category: "Yataklı Koltuk", products: ["Mocca Katlanır Koltuk"] });
    expect(hints).toContain("en iyi yataklı koltuk markaları hangileri");
    expect(hints).toContain("yataklı koltuk nasıl seçilir");
    const p = apiPayload({ name: "Homedius · Yataklı Koltuk", country: "TR", dailyBudget: 250, maxCpc: 3.5, title: "T", body: "B", targetUrl: "https://homedius.com/", hints });
    expect(p.campaign.status).toBe("paused");
    expect(p.campaign.daily_spend_limit_micros).toBe(250_000_000);
    expect(p.ad_group.bidding.max_bid_micros).toBe(3_500_000);
    expect(p.campaign.targeting.locations.countries).toEqual(["TR"]);
  });
});

describe("ChatGPT Ads kampanya planı yardımcıları", () => {
  it("metin önerileri karakter sınırları içinde ve doğrulanabilir özellikleri kullanır", async () => {
    const { copySuggestions } = await import("@/modules/ads/chatgpt-plan");
    const copies = copySuggestions("Homedius", "Yataklı Koltuk", ["Ücretsiz kargo"]);
    expect(copies).toHaveLength(3);
    for (const c of copies) {
      expect([...c.title].length).toBeLessThanOrEqual(50);
      expect([...c.body].length).toBeLessThanOrEqual(100);
    }
    expect(copies[1]!.body).toContain("Ücretsiz kargo");
    expect(copies.map((c) => `${c.title} ${c.body}`).join(" ")).not.toMatch(/en iyi|garantili/i);
  });

  it("bütçe kademeleri reklam grubu sayısıyla (en fazla 3) ölçeklenir", async () => {
    const { budgetTiers } = await import("@/modules/ads/chatgpt-plan");
    const one = budgetTiers(1);
    const five = budgetTiers(5);
    expect(one[0]!.key).toBe("test");
    expect(one[0]!.dailyBudget).toBe(24); // 8 tıklama × $3
    expect(one[0]!.total).toBe(24 * 14);
    expect(five[0]!.dailyClicks).toBe(24); // 3 grup ile sınırlı
    expect(one[0]!.maxCpc).toBeLessThan(3);
  });
});
