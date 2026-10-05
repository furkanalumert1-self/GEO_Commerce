import Link from "next/link";
import { Badge, Card, CardHeader } from "@/components/ui";
import { fmtDate, fmtNumber } from "@/lib/format";
import { absoluteDelta, measurementOutcome, relativeChange, type MeasurementWindows } from "@/lib/view-models";

export interface MeasurementSide {
  score: number | null;
  samples: number;
  engines: string[];
}

/**
 * Önce/sonra: aynı soru kümesi, platform ve metrik tanımıyla eş uzunlukta dönemler.
 * Dönemin bitmesi ile karşılaştırma yeterliliği ayrı; baseline yoksa fark "—" kalır.
 * "Değişiklik sonrası gözlenen fark" — nedensellik veya gelir etkisi iddia edilmez.
 */
export function MeasurementPanel({
  windows,
  before,
  after,
  manual,
  timeZone,
  scopeLabel,
  diagnosisHref,
  sharedEngines,
}: {
  windows: MeasurementWindows;
  before: MeasurementSide;
  after: MeasurementSide;
  manual: boolean;
  timeZone: string;
  scopeLabel: string;
  diagnosisHref?: string;
  /** Dönemler arası platformlar farklıysa yalnız ortak olanlarla karşılaştırılır; adları gösterilir. */
  sharedEngines?: string;
}) {
  const outcome = measurementOutcome(windows.partial, before.samples, after.samples, { elapsedDays: windows.elapsedDays });
  const d = outcome.kind === "computable" ? absoluteDelta(after.score, before.score, "puan") : null;
  const rel = d?.kind === "points" ? relativeChange(after.score, before.score) : null;
  const sameEngines = before.engines.join(",") === after.engines.join(",");
  return (
    <Card>
      <CardHeader
        title={`Ölçüm: ${outcome.title.toLocaleLowerCase("tr-TR")}`}
        description={`${scopeLabel} · AI görünürlük skoru (0–100) · ${windows.days} günlük eş dönemler`}
        action={windows.partial ? <Badge tone="warning">Kısmi dönem · {windows.elapsedDays}/{windows.days} gün</Badge> : <Badge>Dönem tamamlandı</Badge>}
      />
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="text-sm text-text-secondary">Önce</p>
          <p className="tabular mt-1 text-[28px] font-semibold leading-tight">{before.samples ? (before.score ?? "—") : "—"}</p>
          <p className="text-xs text-text-secondary">{fmtDate(windows.before.from, timeZone)} – {fmtDate(windows.before.to, timeZone)} · {fmtNumber(before.samples)} yanıt</p>
        </div>
        <div className="min-w-0">
          <p className="text-sm text-text-secondary">Sonra{outcome.kind === "early" && after.samples ? " (erken ölçüm)" : ""}</p>
          <p className="tabular mt-1 text-[28px] font-semibold leading-tight">{after.samples ? (after.score ?? "—") : "—"}</p>
          <p className="text-xs text-text-secondary">{fmtDate(windows.after.from, timeZone)} – {fmtDate(windows.after.to, timeZone)} · {fmtNumber(after.samples)} yanıt</p>
        </div>
        <div className="min-w-0">
          <p className="text-sm text-text-secondary">Gözlenen fark</p>
          <p className="tabular mt-1 text-[28px] font-semibold leading-tight">{d?.kind === "points" ? `${d.value > 0 ? "+" : d.value < 0 ? "−" : ""}${fmtNumber(Math.abs(d.value), "tr-TR", 1)}` : "—"}</p>
          <p className="text-xs text-text-secondary">
            {d?.kind === "points" ? `puan${rel !== null ? ` · göreli ${rel > 0 ? "+" : ""}${fmtNumber(rel * 100, "tr-TR", 0)}%` : ""}` : outcome.kind === "early" ? "Henüz erken" : "Hesaplanamadı"}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-border px-5 py-4 text-sm text-text-secondary">
        {outcome.message ? <p className={outcome.kind === "computable" ? undefined : "font-medium text-text"}>{outcome.message}</p> : null}
        {sharedEngines ? <p>Karşılaştırma yalnız iki dönemde de ölçülen platformlarla yapıldı: {sharedEngines}.</p> : null}
        {!sameEngines && before.samples > 0 && after.samples > 0 ? <p className="text-warning">Platform kapsamı dönemler arasında değişti; fark sınırlı yorumlanmalıdır.</p> : null}
        <p>
          {manual ? "Uygulama kullanıcı bildirimiyle kaydedildi (doğrulanmış mağaza yayını değil). " : ""}
          Aynı dönemdeki site, model veya stok değişiklikleri de sonucu etkileyebilir; bu fark gelir artışı olarak yorumlanmamalıdır.
        </p>
        {d?.kind === "points" && d.value <= 0 && !windows.partial && diagnosisHref ? (
          <p>
            Sonuç nötr veya negatif. <Link className="text-primary underline" href={diagnosisHref}>Teşhisi yeniden inceleyin</Link>
          </p>
        ) : null}
      </div>
    </Card>
  );
}
