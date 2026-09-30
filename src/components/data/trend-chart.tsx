"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** 3–5 seri; renk + legend + tablo alternatifi (renkle tek başına anlam taşınmaz). */
const SERIES_COLORS = ["#2458A6", "#26704B", "#875A16", "#6B4E9B", "#526070"];
const DASHES = ["", "6 3", "2 2", "8 4 2 4", "1 3"];

export function TrendChart({ data, series, yLabel }: { data: Array<Record<string, number | string | null>>; series: Array<{ key: string; label: string }>; yLabel: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="h-64 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid stroke="#DCE2E8" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#526070" }} tickFormatter={(d: string) => d.slice(5)} minTickGap={16} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#526070" }} width={40} />
            <Tooltip contentStyle={{ fontSize: 12, borderColor: "#DCE2E8" }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.slice(0, 5).map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES_COLORS[i]} strokeDasharray={DASHES[i]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-primary">Veriyi tablo olarak göster</summary>
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
