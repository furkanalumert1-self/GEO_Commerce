"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Ana seri accent, karşılaştırma nötr ve kesik; renk + çizgi deseni + legend + tablo alternatifi
 * (renkle tek başına anlam taşınmaz). Değerler globals.css token'larının SVG için aynasıdır.
 */
const C = { accent: "#3D6248", compare: "#8F9589", grid: "#E3E5DD", tick: "#596057", others: ["#8A570B", "#596057", "#2F6542", "#B13E37"] };
const DASHES = ["", "6 4", "2 3", "8 4 2 4", "1 3"];

export interface TrendSeries {
  key: string;
  label: string;
  /** main: accent düz çizgi; compare: nötr kesik (ör. önceki dönem). */
  variant?: "main" | "compare";
}

export function TrendChart({
  data,
  series,
  yLabel,
  marker,
}: {
  data: Array<Record<string, number | string | null>>;
  series: TrendSeries[];
  yLabel: string;
  /** Dikey işaret (ör. yayın günü), `day` değeriyle. */
  marker?: { day: string; label: string };
}) {
  let other = 0;
  const styled = series.slice(0, 5).map((s, i) => {
    if (s.variant === "main" || (!s.variant && i === 0)) return { ...s, color: C.accent, dash: "", width: 2.25 };
    if (s.variant === "compare") return { ...s, color: C.compare, dash: "6 4", width: 1.75 };
    const k = other++;
    return { ...s, color: C.others[k % C.others.length]!, dash: DASHES[(k + 2) % DASHES.length]!, width: 1.75 };
  });
  return (
    <figure className="flex flex-col gap-2">
      <div className="h-64 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart accessibilityLayer={false} tabIndex={-1} data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.tick }} tickFormatter={(d: string) => d.slice(5)} minTickGap={16} axisLine={{ stroke: C.grid }} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: C.tick }} width={40} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontSize: 12, borderColor: C.grid, borderRadius: 8, boxShadow: "0 16px 48px rgb(24 32 24 / 14%)" }} />
            <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
            {marker ? <ReferenceLine x={marker.day} stroke={C.tick} strokeDasharray="3 3" label={{ value: marker.label, fontSize: 11, fill: C.tick, position: "insideTopLeft" }} /> : null}
            {styled.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeDasharray={s.dash} strokeWidth={s.width} dot={false} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-primary sm:min-h-0">Veriyi tablo olarak göster</summary>
        <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label={`${yLabel} tablo`}>
          <table className="w-full min-w-[480px] text-sm">
            <caption className="sr-only">{yLabel}</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-border px-2 py-1 text-left">Gün</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="border-b border-border px-2 py-1 text-right">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={String(row.day)}>
                  <td className="border-b border-border px-2 py-1">{String(row.day)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="tabular border-b border-border px-2 py-1 text-right">{row[s.key] ?? "Ölçülemedi"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
