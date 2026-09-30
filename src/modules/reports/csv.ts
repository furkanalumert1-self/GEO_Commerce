/**
 * CSV export — formül/CSV injection kaçışı: =,+,-,@,TAB,CR ile başlayan hücreler ' ile öneklenir.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",");

export function toCsv(header: string[], rows: unknown[][]): string {
  return [csvRow(header), ...rows.map(csvRow)].join("\r\n");
}
