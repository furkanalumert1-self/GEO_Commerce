import { Badge, Card, CardHeader, TableWrap, Td, Th } from "@/components/ui";
import { ENGINE_SHORT, fmtDate, fmtMoney, fmtNumber, fmtPct, GAP_LABEL, SURFACE_LABEL } from "@/lib/format";

export interface ReportSnapshot {
  generatedAt: string;
  asOf: string;
  period: { from: string; to: string };
  brand: { name: string; domain: string };
  visibility: { score: number | null; partial: boolean; smallSample: boolean; coverage: number | null; sampleCount: number; formulaVersion: string; cohortHash: string; perEngine: Array<{ engine: string; score: number | null; coverage: number | null }> };
  sov: Array<{ id: string; name: string; type: string; value: number | null }>;
  provenance: { models: string[]; surfaces: string[] };
  opportunities: Array<{ title: string; score: number | null; gapType: string; status: string; recommendedAction: string | null }>;
  actions: Array<{ title: string; status: string; type: string }>;
  revenue: null | { model: string; aiOrders: number; aiNetByCurrency: Record<string, string>; attributionCoverage: number | null; unattributed: number };
  notes: string[];
}

/** Yazdırılabilir rapor görünümü (tarayıcı → PDF). Snapshot değişmez. */
export function ReportView({ snapshot: s, timeZone, brandingName }: { snapshot: ReportSnapshot; timeZone: string; brandingName?: string }) {
  return (
    <article className="mx-auto flex max-w-4xl flex-col gap-6 print:max-w-none">
      <header>
        {brandingName ? <p className="text-sm text-muted">{brandingName}</p> : null}
        <h1 className="text-2xl font-semibold">{s.brand.name} — AI görünürlük raporu</h1>
        <p className="text-sm text-muted">Dönem {fmtDate(s.period.from, timeZone)} – {fmtDate(s.period.to, timeZone)} · Oluşturma {fmtDate(s.generatedAt, timeZone, "tr-TR", true)} · asOf {fmtDate(s.asOf, timeZone)}</p>
      </header>
      <Card className="p-4">
        <h2 className="font-semibold">Yönetici özeti</h2>
        <p className="mt-2 text-sm">
          Seçili dönemde AI Visibility Score {s.visibility.score ?? "ölçülemedi"}{s.visibility.score !== null ? "/100" : ""} ({fmtNumber(s.visibility.sampleCount)} geçerli gözlem, coverage {fmtPct(s.visibility.coverage)}).
          {s.visibility.partial ? " Bazı motorlar kapsam eşiğinin altında kaldığı için toplam skor kısmidir." : ""}
          {s.visibility.smallSample ? " Örneklem küçüktür." : ""} {s.opportunities.length} açık fırsat öncelik sırasıyla aşağıdadır.
        </p>
        <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Teknik detaylar</summary><p className="mt-1 break-all">Formül {s.visibility.formulaVersion} · ölçüm kümesi {s.visibility.cohortHash} · yüzey {s.provenance.surfaces.map((x) => SURFACE_LABEL[x] ?? x).join(", ")} · modeller {s.provenance.models.join(", ")}</p></details>
      </Card>
      <Card>
        <CardHeader title="Motorlar ve SOV" />
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <ul className="text-sm">{s.visibility.perEngine.map((e) => <li key={e.engine}>{ENGINE_SHORT[e.engine] ?? e.engine}: {e.score ?? "—"} (coverage {fmtPct(e.coverage)})</li>)}</ul>
          <ul className="text-sm">{s.sov.map((x) => <li key={x.id}>{x.name}{x.type === "brand" ? " (siz)" : ""}: {x.value === null ? "ölçülemedi" : `%${fmtNumber(x.value, "tr-TR", 1)}`}</li>)}</ul>
        </div>
      </Card>
      <Card>
        <CardHeader title="Öncelikli fırsatlar" />
        <TableWrap label="Fırsatlar">
          <thead><tr><Th>Fırsat</Th><Th>Tür</Th><Th numeric>Skor</Th><Th>Öneri</Th></tr></thead>
          <tbody>{s.opportunities.map((o, i) => <tr key={i}><Td>{o.title}</Td><Td>{GAP_LABEL[o.gapType]}</Td><Td numeric>{o.score ?? "—"}</Td><Td className="text-muted">{o.recommendedAction}</Td></tr>)}</tbody>
        </TableWrap>
      </Card>
      <Card>
        <CardHeader title="Yapılan aksiyonlar" />
        <ul className="divide-y divide-border">{s.actions.map((a, i) => <li key={i} className="flex justify-between px-4 py-2 text-sm"><span>{a.title}</span><Badge>{a.status}</Badge></li>)}</ul>
      </Card>
      {s.revenue ? (
        <Card className="p-4 text-sm">
          <h2 className="font-semibold">Gözlemlenen gelir ({s.revenue.model})</h2>
          <p className="mt-1">AI kaynaklı {s.revenue.aiOrders} sipariş · {Object.entries(s.revenue.aiNetByCurrency).map(([c, v]) => fmtMoney(v, c)).join(" · ") || "—"} · attribution kapsamı {fmtPct(s.revenue.attributionCoverage)} · ilişkilendirilemeyen {s.revenue.unattributed}</p>
          <p className="mt-1 text-xs text-muted">Reklam performansı ayrı raporlanır; yerel attribution ile toplanmaz.</p>
        </Card>
      ) : null}
      <Card className="p-4 text-sm">
        <h2 className="font-semibold">Notlar ve sonraki adımlar</h2>
        <ul className="mt-1 list-disc pl-5 text-muted">{s.notes.map((n) => <li key={n}>{n}</li>)}<li>En yüksek skorlu fırsat için taslak oluşturup onaylayın; 14/28 gün sonra aynı soru kümesiyle yeniden ölçün.</li></ul>
      </Card>
    </article>
  );
}
