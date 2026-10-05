import { describe, expect, it } from "vitest";
import { DEFAULT_RULE, evaluateBudgetChange, evaluateCreateCampaign, type BudgetChangeInput } from "@/modules/ads/rules";
import { canTransitionAction, checkApprovalHash, lineDiff, publishPrecondition, rollbackDecision, toHtml, validateJsonLd, versionHash, type ActionContent } from "@/modules/actions/workflow";

const base: BudgetChangeInput = {
  level: "approval_required", killSwitch: false, capabilities: ["read", "budget_write"], accessStatus: "active",
  currentDailyMinor: 10000n, proposedDailyMinor: 11000n, rolling7dSpendMinor: 0n, lastChangeAt: null,
  conversionsInWindow: 100, approved: true, approvalRevoked: false, now: new Date("2026-09-30T12:00:00Z"),
  rule: { ...DEFAULT_RULE, rollingSpendCapMinor: 100000n },
};

describe("Ads bütçe guard", () => {
  it("±%10 sınırı", () => {
    expect(evaluateBudgetChange(base)).toEqual({ allowed: true, mode: "execute" });
    expect(evaluateBudgetChange({ ...base, proposedDailyMinor: 11001n })).toMatchObject({ allowed: false, reason: "exceeds_max_daily_change" });
  });
  it("cooldown 24 saat", () => {
    expect(evaluateBudgetChange({ ...base, lastChangeAt: new Date("2026-09-30T00:00:00Z") })).toMatchObject({ reason: "cooldown_active" });
  });
  it("rolling spend cap", () => {
    expect(evaluateBudgetChange({ ...base, rolling7dSpendMinor: 95000n })).toMatchObject({ reason: "rolling_spend_cap" });
  });
  it("kill switch ve erişim fail-closed", () => {
    expect(evaluateBudgetChange({ ...base, killSwitch: true })).toMatchObject({ reason: "kill_switch_active" });
    expect(evaluateBudgetChange({ ...base, accessStatus: "access_required" })).toMatchObject({ reason: "access_required" });
    expect(evaluateBudgetChange({ ...base, capabilities: ["read"] })).toMatchObject({ reason: "capability_missing:budget_write" });
  });
  it("iptal edilmiş onay yürütülmez", () => {
    expect(evaluateBudgetChange({ ...base, approvalRevoked: true })).toMatchObject({ reason: "approval_revoked" });
  });
  it("düşük örneklemde bounded rule yalnız öneri", () => {
    expect(evaluateBudgetChange({ ...base, level: "bounded_rules", conversionsInWindow: 3 })).toEqual({ allowed: true, mode: "recommend_only" });
  });
  it("mükerrer kampanya oluşturma engellenir", () => {
    const i = { accessStatus: "active" as const, capabilities: ["campaign_write" as const], killSwitch: false, approved: true, approvalRevoked: false };
    expect(evaluateCreateCampaign({ ...i, existingOperation: { status: "succeeded" } })).toMatchObject({ reason: "duplicate_operation" });
    expect(evaluateCreateCampaign({ ...i, existingOperation: null })).toMatchObject({ allowed: true });
  });
});

const content: ActionContent = {
  title: "Hassas cilt nemlendirici rehberi", metaDescription: "m", bodyBlocks: [{ heading: "Giriş", markdown: "Metin <b>x</b>" }],
  internalLinks: [], faq: [{ q: "Parfüm içerir mi?", a: "Hayır" }], jsonLd: { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Parfüm içerir mi?" }] },
  sources: [], changeSummary: "", placeholders: [],
};

describe("Action workflow", () => {
  it("durum geçişleri", () => {
    expect(canTransitionAction("draft", "published")).toBe(false);
    expect(canTransitionAction("approved", "publishing")).toBe(true);
    expect(canTransitionAction("completed", "draft")).toBe(false);
  });
  it("approval hash race → conflict", () => {
    const h = versionHash(content);
    expect(checkApprovalHash(h, h)).toEqual({ ok: true });
    expect(checkApprovalHash(h, versionHash({ ...content, title: "x" }))).toEqual({ ok: false, code: "conflict" });
  });
  it("rollback yalnız hash eşleşirse otomatik", () => {
    expect(rollbackDecision("abc", "abc")).toBe("auto");
    expect(rollbackDecision("changed", "abc")).toBe("conflict_review");
    expect(publishPrecondition("a", "b")).toBe("conflict");
  });
  it("JSON-LD görünür içerikle uyum", () => {
    expect(validateJsonLd(content.jsonLd, "Parfüm içerir mi? Hayır")).toHaveLength(0);
    expect(validateJsonLd(content.jsonLd, "başka metin").some((i) => i.severity === "error")).toBe(true);
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "Product", name: "x", offers: { price: "1" } }).some((i) => i.path === "offers")).toBe(true);
  });
  it("HTML export injection kaçışı", () => {
    const html = toHtml({ ...content, jsonLd: { "@context": "https://schema.org", "@type": "WebPage", name: "</script><script>alert(1)</script>" } });
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("</script><script>");
  });
  it("satır diff", () => {
    expect(lineDiff("a\nb", "a\nc").map((l) => l.type)).toEqual(["same", "removed", "added"]);
  });
});

describe("HTML dışa aktarma: markdown biçimi", () => {
  it("kalın/liste/bağlantı HTML olur; ham ** kalmaz; kaçış korunur", () => {
    const html = toHtml({ title: "Başlık", metaDescription: null, bodyBlocks: [{ heading: "Seçenekler", markdown: "**Alida** ve *Absolon* modelleri.\n\n- Pamuk\n- Ranforce\n\n[İncele](https://m.example/a) <b>x</b>" }], internalLinks: [], faq: [{ q: "Soru?", a: "**Evet**." }], jsonLd: null, sources: [], changeSummary: "", placeholders: [] } as never);
    expect(html).toContain("<h2>Başlık</h2>");
    expect(html).toContain("<strong>Alida</strong>");
    expect(html).toContain("<em>Absolon</em>");
    expect(html).toContain("<ul><li>Pamuk</li><li>Ranforce</li></ul>");
    expect(html).toContain('<a href="https://m.example/a">İncele</a>');
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("**");
  });
});
