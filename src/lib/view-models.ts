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
/** Kanıt güveni bu eşiğin altındaysa (≈12 başarılı yanıttan az) etki en fazla "Orta" gösterilir; az veriyle kesin teşhis verilmez. */
export const STRONG_EVIDENCE_CONFIDENCE = 0.5;

export function impactLevel(o: { priority?: string | null; score?: number | null; provisional?: boolean; confidence?: number | null }): ImpactLevel {
  if (o.provisional || o.score === null || o.score === undefined) return "unknown";
  if (o.priority === "high" && typeof o.confidence === "number" && o.confidence < STRONG_EVIDENCE_CONFIDENCE) return "medium";
  if (o.priority === "high" || o.priority === "medium" || o.priority === "low") return o.priority;
  return "unknown";
}

// ── İş akışı adımları ───────────────────────────────────────────────────────

export const WORKFLOW_STEPS = ["İncele", "Taslak hazırla", "Değişiklikleri onayla", "Sitenizde uygula", "Sonucu izle"] as const;
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
      return { current: 0, states: states(0), label: "Teşhis hazır", tone: "neutral", next: "Kanıtı inceleyin, ardından AI ile iyileştir ile taslak hazırlayın." };
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
      return { current: 4, states: states(4), label: "Yayınlandı", tone: "success", next: "Sonucu izlemeye alın ve aynı soruları yeniden ölçün; karşılaştırma eş uzunlukta dönemlerle yapılır." };
    case "measuring":
      return {
        current: 4,
        states: states(4),
        label: opts.manualPublish ? "Sitenizde uygulandı (sizin bildiriminiz) · izleniyor" : "Sonuç izleniyor",
        tone: "primary",
        next: "Sonucu görmek için aynı soruları yeniden ölçün; önce/sonra farkı yeni ölçümler geldikçe güncellenir. Veri oluşmadan başarı iddiası yoktur.",
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
  | { kind: "early"; title: string; message: string }
  | { kind: "not_computable"; title: string; message: string };

/** Değişikliğin AI yanıtlarına yansıması için asgari süre ve her dönemde asgari yanıt sayısı. */
export const MIN_EFFECT_DAYS = 3;
export const MIN_EFFECT_SAMPLES = 10;

/**
 * Dönemin bitmesi ile karşılaştırma yeterliliği ayrı değerlendirilir. Başlangıç (önceki dönem) verisi
 * yoksa geçmişe dönük veri oluşmayacağı için etki hesaplanamaz — "veri toplanıyor" denmez.
 */
export function measurementOutcome(partial: boolean, beforeSamples: number, afterSamples: number, opts: { elapsedDays?: number } = {}): MeasurementOutcome {
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
  // Erken veya küçük örneklemli fark gürültüdür (uygulamadan dakikalar sonra +13 puan gibi): sayı gösterilmez.
  // Önceki dönem geçmiştir, büyümez: onun azlığı yalnız güven notu olur; beklenen şey süre ve sonraki dönem verisidir.
  const tooSoon = partial && opts.elapsedDays !== undefined && opts.elapsedDays < MIN_EFFECT_DAYS;
  const afterFew = afterSamples < MIN_EFFECT_SAMPLES;
  const beforeNote = beforeSamples < MIN_EFFECT_SAMPLES ? `Önceki dönemde yalnız ${beforeSamples} yanıt var; fark gösterildiğinde kesin değil, yön gösterici olarak yorumlanmalı.` : null;
  if (tooSoon || afterFew) {
    const reasons = [
      tooSoon ? `Uygulamanın üzerinden ${opts.elapsedDays === 0 ? "1 günden az" : `${opts.elapsedDays} gün`} geçti; AI yanıtlarının değişikliği yansıtması birkaç gün sürer.` : null,
      afterFew ? `Karşılaştırma için uygulamadan sonra en az ${MIN_EFFECT_SAMPLES} yanıt gerekir (şu an ${afterSamples}).` : null,
    ].filter(Boolean);
    const when = tooSoon ? `${MIN_EFFECT_DAYS - (opts.elapsedDays ?? 0)} gün sonra` : "yeterli yanıt toplandığında";
    return { kind: "early", title: "Değerlendirmek için henüz erken", message: `${reasons.join(" ")} Fark, ${when} aynı sorular yeniden ölçüldüğünde gösterilir.${beforeNote ? ` ${beforeNote}` : ""}` };
  }
  if (beforeNote) return { kind: "computable", title: "Değişiklik sonrası gözlenen fark (düşük güven)", message: `${beforeNote}${partial ? " Kısmi dönem: fark değişebilir." : ""}` };
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

// ── Yanıt metni durumu ─────────────────────────────────────────────────────

export const RAW_TEXT_RETENTION_DAYS = 30;

/**
 * Yanıt metni yoksa nedeni: alınamadı / işlenemedi / süresi doldu / saklanmadı ayrı söylenir.
 * Başarısız yanıt "değerlendirilemedi"dir; sıfır görünürlük veya silinmiş kayıt gibi gösterilmez.
 */
export function rawTextNote(o: { status: string; rawText: string | null; sampledAt: Date; errorCode?: string | null }, now = new Date()): string | null {
  if (o.rawText) return null;
  if (o.status === "failed" || o.status === "pending") return `Yanıt alınamadı${o.errorCode ? ` (${o.errorCode})` : ""}. Bu ölçüm değerlendirilemedi; sıfır görünürlük sayılmaz.`;
  if (o.status === "parse_failed") return "Yanıt alındı ancak işlenemedi; bu ölçüm değerlendirilemedi.";
  const ageDays = (now.getTime() - o.sampledAt.getTime()) / 86_400_000;
  if (ageDays > RAW_TEXT_RETENTION_DAYS) return `Yanıt metni saklama süresi (${RAW_TEXT_RETENTION_DAYS} gün) dolduğu için silindi; ölçüm sonuçları korunur.`;
  return "Bu yanıtın metni saklanmadı; ölçüm sonuçları korunur.";
}

// ── Sıradaki adım (Genel Bakış) ────────────────────────────────────────────

export interface NextStepInput {
  productCount: number;
  pendingCandidates: number;
  promptCount: number;
  hasRun: boolean;
  continuing: { title: string; href: string } | null;
  topOpportunity: { title: string; href: string } | null;
  /** Duraklamış (yarım kalan) ölçüm varsa önce o sürdürülür. */
  runInProgress?: { href: string } | null;
  /** Açık fırsat yokken markanın hiç anılmadığı soru sayısı. */
  missedCount?: number;
}

export interface NextStep {
  title: string;
  reason: string;
  cta: string;
  href: string; // base'e göre göreli yol ("/catalog#adaylar" gibi)
}

/** Ana akış sırası: Ürünler → Sorular → Ölçüm → Öneri/Taslak. Her durumda tek ana eylem. */
export function nextStep(i: NextStepInput): NextStep {
  if (i.productCount === 0 && i.pendingCandidates > 0) return { title: `Bulunan ${i.pendingCandidates} ürünü kontrol edip kataloğa ekleyin`, reason: "Ürün bilgisi olmadan içerik önerileri hazırlanamıyor.", cta: "Ürünleri incele", href: "/catalog#adaylar" };
  if (i.productCount === 0) return { title: "Ürün bilgilerinizi tamamlayın", reason: "Sitenizi inceleyip ürünlerinizi bulalım; onayladıklarınız kataloğa eklenir.", cta: "Ürünleri bul", href: "/catalog#adaylar" };
  if (i.promptCount === 0) return { title: "Takip edeceğiniz soruları seçin", reason: "Müşterilerinizin AI'a sorabileceği soruları seçin; ölçüm bu sorularla yapılır.", cta: "Soruları seç", href: "/prompts" };
  if (!i.hasRun) return { title: "İlk ölçümü başlatın", reason: "Seçtiğiniz sorulara AI yanıtlarını toplayıp markanızın görünürlüğünü ölçelim.", cta: "Ölçümü planla", href: "/prompts#olcum" };
  if (i.runInProgress) return { title: "Yarım kalan ölçümü sürdürün", reason: "Son ölçüm sayfa kapandığı için durakladı; kaldığı yerden devam eder.", cta: "Ölçümü aç", href: i.runInProgress.href };
  if (i.continuing) return { title: `Taslağı tamamlayın: ${i.continuing.title}`, reason: "Yarım kalan bir içerik taslağınız var.", cta: "Devam et", href: i.continuing.href };
  if (i.topOpportunity) return { title: `İlk öneriyi inceleyin: ${i.topOpportunity.title}`, reason: "Rakiplerin öne çıktığı ve kanıtı en güçlü soru grubu.", cta: "Başla", href: i.topOpportunity.href };
  if (i.missedCount) return { title: `Markanızın anılmadığı ${i.missedCount} soruyu inceleyin`, reason: "Şu an açık fırsat yok; bu sorularda öne çıkan siteleri rakip olarak onaylarsanız fırsat oluşur.", cta: "İncele", href: "/opportunities" };
  return { title: "Yeni ölçüm başlatın", reason: "Şu an açık öneri yok; yeni ölçüm güncel durumu gösterir.", cta: "Ölçümü planla", href: "/prompts#olcum" };
}

/**
 * Görünürlük payı ölçülemediğinde nedeni: sıfır pay ile tanımsız payda ayrılır.
 * - onaylı rakip yok → karşılaştırma kümesi yok
 * - geçerli yanıt yok → veri yok
 * - takip edilen markaların hiçbiri anılmadı → pay tanımsız (0 değil)
 */
export function sovMissingReason(input: { competitorCount: number; validAnswers: number }): string {
  if (input.validAnswers === 0) return "Geçerli yanıt yok";
  if (input.competitorCount === 0) return "Onaylı rakip yok";
  return "Takip edilen markaların hiçbiri anılmadı (pay tanımsız)";
}
