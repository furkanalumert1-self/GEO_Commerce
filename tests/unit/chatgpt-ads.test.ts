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
    expect(hints).toContain("küçük ev için yataklı koltuk");
    const p = apiPayload({ name: "Homedius · Yataklı Koltuk", country: "TR", dailyBudget: 250, maxCpc: 3.5, title: "T", body: "B", targetUrl: "https://homedius.com/", hints });
    expect(p.campaign.status).toBe("paused");
    expect(p.campaign.daily_spend_limit_micros).toBe(250_000_000);
    expect(p.ad_group.bidding.max_bid_micros).toBe(3_500_000);
    expect(p.campaign.targeting.locations.countries).toEqual(["TR"]);
  });
});
