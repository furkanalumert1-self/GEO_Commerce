/**
 * Sunum katmanı selector'ları (UI görünüm modeli). Backend enum'larını, skor ve attribution
 * hesaplarını değiştirmez; yalnız mevcut veriyi ekranda doğru anlatmak için dönüştürür.
 */

const DAY = 86_400_000;

// ── Dönem ve fark ────────────────────────────────────────────────────────────

/** Seçili dönemle eşit uzunlukta, hemen önceki dönem. */
export function previousPeriod(range: { from: Date; to: Date }): { from: Date; to: Date } {
  const len = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - len), to: new Date(range.from.getTime()) };
}

export type Delta =
  | { kind: "none"; reason: "no_current" | "no_previous" }
  | { kind: "points"; value: number; unit: "puan" | "yüzde puan"; direction: "up" | "down" | "flat" };

/**
 * Mutlak fark. Skor (0–100) için "puan", yüzde oranlar (SOV gibi) için "yüzde puan".
 * Önceki ya da güncel değer yoksa fark hesaplanmaz (0 sayılmaz).
 */
export function absoluteDelta(current: number | null | undefined, previous: number | null | undefined, unit: "puan" | "yüzde puan", digits = 1): Delta {
  if (current === null || current === undefined || Number.isNaN(current)) return { kind: "none", reason: "no_current" };
  if (previous === null || previous === undefined || Number.isNaN(previous)) return { kind: "none", reason: "no_previous" };
  const f = 10 ** digits;
  const value = Math.round((current - previous) * f) / f;
  return { kind: "points", value, unit, direction: value > 0 ? "up" : value < 0 ? "down" : "flat" };
}

/** Göreli değişim (oran). Önceki değer 0 veya yoksa hesaplanmaz. */
export function relativeChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (previous === 0 || Number.isNaN(previous) || Number.isNaN(current)) return null;
  return (current - previous) / Math.abs(previous);
}

export function deltaText(d: Delta, locale = "tr-TR"): string {
  if (d.kind === "none") return d.reason === "no_previous" ? "Önceki dönemde veri yok" : "—";
  if (d.direction === "flat") return `Değişim yok (önceki döneme göre)`;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.abs(d.value));
  return `${d.direction === "up" ? "+" : "−"}${n} ${d.unit} önceki döneme göre`;
}

// ── Fırsat önceliği ─────────────────────────────────────────────────────────

export type ImpactLevel = "high" | "medium" | "low" | "unknown";

export const IMPACT_LABEL: Record<ImpactLevel, string> = {
  high: "Yüksek",
  medium: "Orta",
  low: "Düşük",
  unknown: "Öncelik belirlenemedi",
};

/** Mevcut öncelik alanını kullanır; geçici (provisional) skorlu fırsatta etki belirlenmiş sayılmaz. */
export function impactLevel(o: { priority?: string | null; score?: number | null; provisional?: boolean }): ImpactLevel {
  if (o.provisional || o.score === null || o.score === undefined) return "unknown";
  if (o.priority === "high" || o.priority === "medium" || o.priority === "low") return o.priority;
  return "unknown";
}

// ── İş akışı adımları ───────────────────────────────────────────────────────

export const WORKFLOW_STEPS = ["Teşhis", "Taslak", "İnceleme", "Uygulama", "Ölçüm"] as const;
export type StepState = "done" | "current" | "upcoming" | "blocked";

export interface WorkflowView {
  current: number;
  states: StepState[];
  /** Kullanıcıya gösterilen durum etiketi (UI görünüm modeli). */
  label: string;
  tone: "neutral" | "primary" | "success" | "warning" | "danger";
  /** Mevcut veriye göre sıradaki adımın açıklaması. */
  next: string;
}

function states(current: number, blockedAt?: number, allDone = false): StepState[] {
  return WORKFLOW_STEPS.map((_, i) => (allDone || i < current ? "done" : i === current ? (blockedAt === i ? "blocked" : "current") : "upcoming"));
}

/**
 * Aksiyon durumu → beş adımlı akış. Aksiyon yoksa teşhis aşamasıdır.
 * `manualPublish`: export ile kullanıcı tarafından uygulandığı bildirilen aksiyon (doğrulanmış yayın değil).
 */
export function workflowView(actionStatus: string | null | undefined, opts: { manualPublish?: boolean; needsFix?: boolean } = {}): WorkflowView {
  // Zorunlu alanı eksik içerik (onaylanmış olsa bile) hazır sayılmaz; taslak adımında engellenir.
  if (opts.needsFix && (actionStatus === "draft" || actionStatus === "review" || actionStatus === "approved")) {
    return { current: 1, states: states(1, 1), label: "Düzeltme gerekli", tone: "danger", next: "Doldurulmamış zorunlu alanları tamamlayıp yeni sürüm kaydedin; ardından yeniden onay gerekir." };
  }
  switch (actionStatus) {
    case null:
    case undefined:
      return { current: 0, states: states(0), label: "Teşhis hazır", tone: "neutral", next: "Kanıtı inceleyin, ardından Fix with AI ile taslak oluşturun." };
    case "draft":
      return { current: 1, states: states(1), label: "Taslak", tone: "neutral", next: "Taslağı düzenleyin ve incelemeye gönderin veya onaylayın." };
    case "rejected":
      return { current: 1, states: states(1, 1), label: "Reddedildi", tone: "danger", next: "Taslağa döndürüp düzenleyin; yeni sürüm yeniden onay ister." };
    case "review":
      return { current: 2, states: states(2), label: "İnceleme bekliyor", tone: "warning", next: "Yetkili kişi görüntülenen sürümü onaylamalı veya reddetmeli." };
    case "approved":
      return { current: 3, states: states(3), label: "Onaylandı · yayına hazır", tone: "primary", next: "İçerik henüz canlı değil. Bağlı mağazada yayınlayın veya dışa aktarıp manuel uygulayın." };
    case "publishing":
      return { current: 3, states: states(3), label: "Yayınlanıyor", tone: "warning", next: "Yayın işlemi sürüyor; tekrar göndermeden önce durumu yenileyin." };
    case "failed":
      return { current: 3, states: states(3, 3), label: "Yayın başarısız", tone: "danger", next: "Hata nedenini inceleyin; taslak korunur, yeniden onay sonrası tekrar deneyebilirsiniz." };
    case "rolled_back":
      return { current: 3, states: states(3, 3), label: "Geri alındı", tone: "danger", next: "Değişiklik geri alındı; taslağa döndürüp yeniden değerlendirin." };
    case "published":
      return { current: 4, states: states(4), label: "Yayınlandı", tone: "success", next: "Ölçümü başlatın; önce/sonra karşılaştırması eş uzunlukta dönemlerle yapılır." };
    case "measuring":
      return {
        current: 4,
        states: states(4),
        label: opts.manualPublish ? "Haricen uygulandı · ölçülüyor" : "Ölçülüyor",
        tone: "primary",
        next: "Sonraki dönem doldukça önce/sonra farkı güncellenir; veri oluşmadan başarı iddiası yoktur.",
      };
    case "completed":
      return { current: 4, states: states(4, undefined, true), label: "Ölçüm tamamlandı", tone: "success", next: "Gözlenen farkı inceleyin; sonuç zayıfsa teşhisi yeniden değerlendirin." };
    default:
      return { current: 0, states: states(0), label: actionStatus, tone: "neutral", next: "" };
  }
}

/** Aksiyon listesinde satır CTA'sı. */
export function actionCta(status: string): "Sonucu gör" | "Devam et" {
  return status === "measuring" || status === "completed" || status === "published" ? "Sonucu gör" : "Devam et";
}

// ── Ölçüm pencereleri ───────────────────────────────────────────────────────

export interface MeasurementWindows {
  before: { from: Date; to: Date };
  after: { from: Date; to: Date };
  days: number;
  /** Sonraki pencere henüz dolmadı. */
  partial: boolean;
  elapsedDays: number;
}

/** Yayın anı etrafında eş uzunlukta önce/sonra pencereleri (varsayılan 14 gün). */
export function measurementWindows(publishAt: Date, days = 14, now = new Date()): MeasurementWindows {
  const before = { from: new Date(publishAt.getTime() - days * DAY), to: publishAt };
  const fullEnd = new Date(publishAt.getTime() + days * DAY);
  const end = now < fullEnd ? now : fullEnd;
  const elapsedDays = Math.max(0, Math.floor((end.getTime() - publishAt.getTime()) / DAY));
  return { before, after: { from: publishAt, to: end }, days, partial: now < fullEnd, elapsedDays };
}

// ── Trend hizalama ──────────────────────────────────────────────────────────

/** "YYYY-MM-DD" gününü takvim günü olarak kaydırır. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Önceki dönem serisini güncel dönemin günlerine hizalar (gün − dönem uzunluğu).
 * Eksik gün `null` kalır; çizgi boşluğu doldurmaz.
 */
export function alignPrevious(current: Array<{ day: string }>, previous: Array<{ day: string; score: number | null }>, offsetDays: number): Array<number | null> {
  const byDay = new Map(previous.map((p) => [p.day, p.score]));
  return current.map((c) => byDay.get(shiftDay(c.day, -offsetDays)) ?? null);
}

// ── Ölçüm sonucu yeterliliği ────────────────────────────────────────────────

export type MeasurementOutcome =
  | { kind: "computable"; title: string; message: string | null }
  | { kind: "not_computable"; title: string; message: string };

/**
 * Dönemin bitmesi ile karşılaştırma yeterliliği ayrı değerlendirilir. Başlangıç (önceki dönem) verisi
 * yoksa geçmişe dönük veri oluşmayacağı için etki hesaplanamaz — "veri toplanıyor" denmez.
 */
export function measurementOutcome(partial: boolean, beforeSamples: number, afterSamples: number): MeasurementOutcome {
  if (beforeSamples === 0) {
    return {
      kind: "not_computable",
      title: "Etki hesaplanamadı",
      message: partial
        ? "Yayından önceki dönemde bu soru kümesi için gözlem yok; bu nedenle etki hesaplanamayacak. Sonraki dönem değeri yalnız bilgi amaçlıdır."
        : "Dönem tamamlandı; başlangıç verisi olmadığı için etki hesaplanamadı.",
    };
  }
  if (afterSamples === 0) {
    return partial
      ? { kind: "not_computable", title: "Sonraki dönem verisi bekleniyor", message: "Yayından sonra henüz gözlem yok; sonuç oluşmadan başarı veya başarısızlık değerlendirilmez." }
      : { kind: "not_computable", title: "Etki hesaplanamadı", message: "Dönem tamamlandı; yayından sonra gözlem olmadığı için etki hesaplanamadı." };
  }
  return { kind: "computable", title: "Değişiklik sonrası gözlenen fark", message: partial ? "Kısmi dönem: sonraki pencere henüz dolmadı; fark değişebilir." : null };
}

/** Kayıtlı gerekçe metinlerindeki teknik terimleri sade Türkçeye çevirir (eski kayıtlar için de). */
export function plainTr(text: string): string {
  return text
    .replace(/aynı cohort/gi, "aynı soru kümesi")
    .replace(/cohort/gi, "soru kümesi")
    .replace(/prompt'un/gi, "sorunun")
    .replace(/\bprompt\b/gi, "soru");
}
