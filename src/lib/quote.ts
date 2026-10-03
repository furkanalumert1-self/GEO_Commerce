/**
 * AI yanıtından alınan alıntıyı okunur hale getirir: markdown bağlantıları ([metin](url)) → metin,
 * kalın/italik işaretleri ve tablo çizgileri kaldırılır, yarım kalan ilk kelime parçası atılır.
 */
export function cleanQuote(raw: string, max = 280): string {
  let s = raw
    .replace(/\(\s*\[([^\]]+)\]\([^)]*\)\s*\)/g, "($1)")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)[*_](\S)/g, "$1$2")
    .replace(/\s*\|\s*(\|\s*)*/g, " · ")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .replace(/(\s·)+\s*$/g, "")
    .replace(/^\s*·\s*/, "")
    .trim();
  // Alıntı kelime ortasından başlıyorsa (küçük harf/noktalama ile) ilk parçayı at ve "…" ile başla.
  if (/^[a-zçğıöşü.,;:)\-]/.test(s)) {
    const cut = s.search(/[\s.]/);
    s = `…${cut > 0 && cut < 20 ? s.slice(cut).replace(/^[\s.,;:)\-]+/, " ") : ` ${s}`}`.replace(/^…\s*/, "… ");
  }
  return s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, "")}…` : s;
}
