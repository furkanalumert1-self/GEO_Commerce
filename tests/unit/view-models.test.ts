import { describe, expect, it } from "vitest";
import { absoluteDelta, actionCta, alignPrevious, deltaText, impactLevel, measurementOutcome, measurementWindows, previousPeriod, relativeChange, workflowView } from "@/lib/view-models";

describe("dönem farkı", () => {
  it("önceki eşit dönem", () => {
    const p = previousPeriod({ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T00:00:00Z") });
    expect(p.to.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(p.from.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });

  it("eksik veri 0 sayılmaz", () => {
    expect(absoluteDelta(null, 40, "puan")).toEqual({ kind: "none", reason: "no_current" });
    expect(absoluteDelta(42, null, "puan")).toEqual({ kind: "none", reason: "no_previous" });
    expect(deltaText(absoluteDelta(42, undefined, "puan"))).toBe("Önceki dönemde veri yok");
  });

  it("oran farkı yüzde puan olarak verilir", () => {
    const d = absoluteDelta(31.5, 28, "yüzde puan");
    expect(d).toMatchObject({ kind: "points", value: 3.5, direction: "up", unit: "yüzde puan" });
    expect(deltaText(d)).toBe("+3,5 yüzde puan önceki döneme göre");
    expect(deltaText(absoluteDelta(40, 44, "puan"))).toBe("−4 puan önceki döneme göre");
  });

  it("önceki değer sıfırsa göreli fark hesaplanmaz", () => {
    expect(relativeChange(10, 0)).toBeNull();
    expect(relativeChange(12, 10)).toBeCloseTo(0.2);
  });
});

describe("iş akışı görünümü", () => {
  it("aksiyon yoksa teşhis adımı", () => {
    expect(workflowView(null).current).toBe(0);
  });

  it("onaylı ≠ yayınlandı", () => {
    const a = workflowView("approved");
    const p = workflowView("published");
    expect(a.current).toBe(3);
    expect(a.label).toMatch(/yayına hazır/);
    expect(p.current).toBe(4);
    expect(p.label).toBe("Yayınlandı");
  });

  it("başarısız yayın başarı gibi gösterilmez", () => {
    const f = workflowView("failed");
    expect(f.tone).toBe("danger");
    expect(f.states[3]).toBe("blocked");
  });

  it("manuel uygulama kullanıcı bildirimi olarak etiketlenir", () => {
    expect(workflowView("measuring", { manualPublish: true }).label).toMatch(/Sitenizde uygulandı \(sizin bildiriminiz\)/);
    expect(workflowView("completed").states.every((s) => s === "done")).toBe(true);
  });

  it("satır CTA'sı", () => {
    expect(actionCta("draft")).toBe("Devam et");
    expect(actionCta("measuring")).toBe("Sonucu gör");
  });
});

describe("öncelik ve ölçüm penceresi", () => {
  it("geçici skor önceliği belirlenmemiş sayılır", () => {
    expect(impactLevel({ priority: "high", score: 80 })).toBe("high");
    expect(impactLevel({ priority: "high", score: 80, provisional: true })).toBe("unknown");
    expect(impactLevel({ priority: "x", score: 10 })).toBe("unknown");
  });

  it("sonraki pencere dolmadıysa kısmi dönem", () => {
    const pub = new Date("2026-09-20T00:00:00Z");
    const w = measurementWindows(pub, 14, new Date("2026-09-25T00:00:00Z"));
    expect(w.partial).toBe(true);
    expect(w.elapsedDays).toBe(5);
    expect(w.before.from.toISOString()).toBe("2026-09-06T00:00:00.000Z");
    const full = measurementWindows(pub, 14, new Date("2026-10-30T00:00:00Z"));
    expect(full.partial).toBe(false);
    expect(full.after.to.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });
});

describe("trend hizalama", () => {
  it("önceki dönemi gün farkıyla hizalar, eksik gün null", () => {
    const cur = [{ day: "2026-09-29" }, { day: "2026-09-30" }, { day: "2026-10-01" }];
    const prev = [{ day: "2026-08-30", score: 40 }, { day: "2026-09-01", score: 42 }];
    expect(alignPrevious(cur, prev, 30)).toEqual([40, null, 42]);
  });
});

describe("zorunlu eksik", () => {
  it("onaylı ama eksikli içerik hazır gösterilmez", () => {
    const v = workflowView("approved", { needsFix: true });
    expect(v.label).toBe("Düzeltme gerekli");
    expect(v.states[1]).toBe("blocked");
    expect(workflowView("measuring", { needsFix: true }).label).toBe("Sonuç izleniyor");
  });
});

describe("ölçüm yeterliliği", () => {
  it("dönem bitti + baseline yok → hesaplanamadı, veri toplanıyor denmez", () => {
    const o = measurementOutcome(false, 0, 40);
    expect(o.kind).toBe("not_computable");
    expect(o.message).toBe("Dönem tamamlandı; başlangıç verisi olmadığı için etki hesaplanamadı.");
    expect(o.message).not.toMatch(/toplanıyor/);
  });
  it("kısmi dönem + baseline var + sonrası yok → bekleniyor", () => {
    expect(measurementOutcome(true, 30, 0).title).toBe("Sonraki dönem verisi bekleniyor");
    expect(measurementOutcome(true, 30, 5).kind).toBe("computable");
  });
});
