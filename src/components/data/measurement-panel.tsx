import Link from "next/link";
import { Badge, Card, CardHeader } from "@/components/ui";
import { fmtDate, fmtNumber } from "@/lib/format";
import { absoluteDelta, deltaText, relativeChange, type MeasurementWindows } from "@/lib/view-models";

export interface MeasurementSide {
  score: number | null;
  samples: number;
  engines: string[];
}

/**
 * Önce/sonra: aynı soru kümesi, platform ve metrik tanımıyla eş uzunlukta dönemler.
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
}: {
  windows: MeasurementWindows;
  before: MeasurementSide;
  after: MeasurementSide;
  manual: boolean;
  timeZone: string;
  scopeLabel: string;
  diagnosisHref?: string;
}) {
  const d = absoluteDelta(after.score, before.score, "puan");
  const rel = relativeChange(after.score, before.score);
  const sameEngines = before.engines.join(",") === after.engines.join(",");
  const noBaseline = before.samples === 0;
  return (
    <Card>
      <CardHeader
        title="Ölçüm: değişiklik sonrası gözlenen fark"
        description={`${scopeLabel} · AI görünürlük skoru (0–100) · ${windows.days} günlük eş dönemler`}
        action={windows.partial ? <Badge tone="warning">Kısmi dönem · {windows.elapsedDays}/{windows.days} gün</Badge> : <Badge tone="success">Dönem tamamlandı</Badge>}
      />
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <p className="text-sm text-text-secondary">Önce</p>
          <p className="tabular mt-1 text-[28px] font-semibold leading-tight">{before.score ?? "—"}</p>
          <p className="text-xs text-text-secondary">{fmtDate(windows.before.from, timeZone)} – {fmtDate(windows.before.to, timeZone)} · {fmtNumber(before.samples)} yanıt</p>
        </div>
        <div>
          <p className="text-sm text-text-secondary">Sonra</p>
          <p className="tabular mt-1 text-[28px] font-semibold leading-tight">{after.score ?? "—"}</p>
          <p className="text-xs text-text-secondary">{fmtDate(windows.after.from, timeZone)} – {fmtDate(windows.after.to, timeZone)} · {fmtNumber(after.samples)} yanıt</p>
        </div>
        <div>
          <p className="text-sm text-text-secondary">Gözlenen fark</p>
          <p className="tabular mt-1 text-[28px] font-semibold leading-tight">{d.kind === "points" ? `${d.value > 0 ? "+" : d.value < 0 ? "−" : ""}${fmtNumber(Math.abs(d.value), "tr-TR", 1)}` : "—"}</p>
          <p className="text-xs text-text-secondary">
            {d.kind === "points" ? `puan${rel !== null ? ` · göreli ${rel > 0 ? "+" : ""}${fmtNumber(rel * 100, "tr-TR", 0)}%` : ""}` : deltaText(d)}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-border px-5 py-4 text-sm text-text-secondary">
        {noBaseline ? <p>Yayından önceki dönemde bu soru kümesi için gözlem yok; karşılaştırma için veri toplanıyor.</p> : null}
        {after.samples === 0 && !noBaseline ? <p>Yayından sonra henüz gözlem yok; sonuç oluşmadan başarı veya başarısızlık değerlendirilmez.</p> : null}
        {!sameEngines && before.samples > 0 && after.samples > 0 ? <p className="text-warning">Platform kapsamı dönemler arasında değişti; fark sınırlı yorumlanmalıdır.</p> : null}
        <p>
          {manual ? "Uygulama kullanıcı bildirimiyle kaydedildi (doğrulanmış mağaza yayını değil). " : ""}
          Aynı dönemdeki site, model veya stok değişiklikleri de sonucu etkileyebilir; bu fark gelir artışı olarak yorumlanmamalıdır.
        </p>
        {d.kind === "points" && d.value <= 0 && diagnosisHref ? (
          <p>
            Sonuç nötr veya negatif. <Link className="text-primary underline" href={diagnosisHref}>Teşhisi yeniden inceleyin</Link>
          </p>
        ) : null}
      </div>
    </Card>
  );
}
