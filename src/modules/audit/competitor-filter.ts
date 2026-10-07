/**
 * Rakip adayı filtresi: AI yanıtlarında kaynak gösterilen her alan adı rakip değildir.
 * Kamu/eğitim kurumları, haber/medya siteleri, ansiklopedi/akademik kaynaklar, sosyal ağlar
 * ve pazaryerleri "kaynak" olarak kalır ama rakip önerisine girmez.
 */

/** Kurumsal ikinci/üst düzey uzantılar (ör. tubitak.gov.tr, katalog.marmara.edu.tr). */
const INSTITUTIONAL_SUFFIX = /\.(edu|gov|mil|k12|bel|pol|tsk|ac|gob|gouv|govt|int)(\.[a-z]{2})?$|\.(edu|gov|mil|int)$|\.org\.tr$/;

/** Kurumsal/akademik alt alan adı ve kelime işaretleri. */
const INSTITUTIONAL_HINT = /(^|\.)(katalog|kutuphane|library|lib|dergi|dergipark|journal|scholar|akademik|academia|researchgate|universite|university|uni)\./;

/** Sağlık ve genel bilgi otoriteleri: yanıtlarda kaynak olarak geçer, satış yapan rakip değildir. */
const INFO_AUTHORITIES = new Set([
  "who", "cdc", "mayoclinic", "webmd", "healthline", "medlineplus", "clevelandclinic", "hopkinsmedicine", "nhs", "sleepfoundation",
  "verywellhealth", "verywellmind", "medicalnewstoday", "harvard", "health", "saglik", "memorial", "acibadem", "medicalpark", "florence",
]);

/** Haber, medya, ansiklopedi ve genel içerik siteleri (kayıtlı alan adının ilk etiketi). */
const MEDIA_BRANDS = new Set([
  // TR haber/ekonomi/teknoloji
  "cnbce", "hurriyet", "milliyet", "sabah", "sozcu", "ntv", "cnnturk", "haberturk", "bloomberght", "ensonhaber", "mynet", "onedio",
  "webtekno", "shiftdelete", "donanimhaber", "chip", "posta", "aksam", "takvim", "star", "yenisafak", "cumhuriyet", "dunya", "ekonomim",
  "trthaber", "trt", "aa", "dha", "iha", "haber7", "internethaber", "gazeteduvar", "t24", "bianet", "fortuneturkey", "forbes", "capital",
  "ekonomist", "patronlardunyasi", "marketingturkiye", "mediacat", "egirisim", "webrazzi", "log", "teknolojioku", "evrimagaci", "elle",
  "vogue", "cosmopolitan", "hthayat", "kadinlarkulubu", "hurriyetemlak", "sahibinden", "eksisozluk", "uludagsozluk", "quora",
  // Uluslararası haber/medya
  "bbc", "cnn", "nytimes", "theguardian", "reuters", "wsj", "bloomberg", "ft", "economist", "businessinsider", "techcrunch", "theverge",
  "wired", "cnet", "zdnet", "engadget", "huffpost", "washingtonpost", "usatoday", "apnews", "aljazeera", "dw", "euronews", "statista",
  // Ansiklopedi/akademik/genel platform
  "wikipedia", "wikihow", "britannica", "dergipark", "researchgate", "academia", "springer", "sciencedirect", "ncbi", "nih", "jstor",
  "google", "youtube", "instagram", "facebook", "twitter", "x", "tiktok", "linkedin", "pinterest", "reddit", "medium", "substack", "wordpress", "blogspot",
  // Pazaryeri/fiyat karşılaştırma/şikâyet
  "guvendamgasi", "etbis", "eticaret", "trustpilot", "trendyol", "hepsiburada", "amazon", "n11", "ciceksepeti", "pttavm", "cimri", "akakce", "epey", "sikayetvar", "etsy", "ebay", "aliexpress", "temu",
]);

/** Alan adındaki genel içerik/medya kelimeleri. */
const MEDIA_WORD = /(haber|news|gazete|dergi|magazin|magazine|blog|forum|rehber|yorum|review|wiki|sozluk|radyo|radio|karsilastir|inceleme|tavsiye)/;

/** "En iyi …" liste/öneri siteleri (eniyisinde, eniyimarka, en-iyi-…): içerik kaynağıdır, satıcı rakip değildir. */
const LISTICLE_PREFIX = /^(en-?iyi|eniyi)/;

const MULTI_PART_TLD = /\.(com|net|org|gen|biz|info|web|tv|av|dr|name|bbs|tel)\.[a-z]{2}$|\.co\.[a-z]{2}$/;

/** "www.katalog.marmara.edu.tr" → "marmara"; "shop.example.com.tr" → "example". */
export function registrableLabel(domain: string): string {
  const d = domain.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const parts = d.split(".");
  const tldParts = MULTI_PART_TLD.test(d) || INSTITUTIONAL_SUFFIX.test(d) ? 2 : 1;
  return parts[parts.length - tldParts - 1] ?? parts[0] ?? d;
}

export type NonCompetitorReason = "institutional" | "media" | "own" | "invalid";

/** Rakip adayı olamayacak alan adları için gerekçe döner; aday olabiliyorsa null. */
export function nonCompetitorReason(domain: string, ownDomain?: string): NonCompetitorReason | null {
  const d = domain.toLowerCase().trim().replace(/^www\./, "");
  // Boş/bozuk değerler (ör. ayrıştırılamayan atıf) aday olamaz.
  if (!/^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(d)) return "invalid";
  if (ownDomain) {
    const own = ownDomain.toLowerCase().replace(/^www\./, "");
    if (d === own || d.endsWith(`.${own}`) || own.endsWith(`.${d}`)) return "own";
  }
  if (INSTITUTIONAL_SUFFIX.test(d) || INSTITUTIONAL_HINT.test(`${d}.`)) return "institutional";
  const label = registrableLabel(d);
  if (INFO_AUTHORITIES.has(label)) return "institutional";
  if (MEDIA_BRANDS.has(label) || MEDIA_WORD.test(label) || LISTICLE_PREFIX.test(label)) return "media";
  return null;
}

export const isCompetitorCandidate = (domain: string, ownDomain?: string) => nonCompetitorReason(domain, ownDomain) === null;

/** Genel bilgi kaynakları (kamu/akademik kurum, ansiklopedi, sağlık otoriteleri, sosyal ağ): tanıtım/iletişim hedefi değildir. */
const GENERAL_INFO = new Set([
  "wikipedia", "wikihow", "britannica", "dergipark", "researchgate", "academia", "springer", "sciencedirect", "ncbi", "nih", "jstor",
  "who", "cdc", "mayoclinic", "webmd", "healthline", "medlineplus",
  "google", "youtube", "instagram", "facebook", "twitter", "x", "tiktok", "linkedin", "pinterest", "reddit", "quora", "eksisozluk", "uludagsozluk",
]);

/**
 * "Diğer sitelerde görünürlük fırsatı" için uygun mu: rakip mağaza, kendi site ve genel bilgi kaynağı değil.
 * Haber/medya, inceleme ve pazaryeri siteleri uygundur (gerçek tanıtım/listeleme ilişkisi kurulabilir).
 */
export function isOutreachTarget(domain: string, ownDomain?: string): boolean {
  const reason = nonCompetitorReason(domain, ownDomain);
  if (reason === null || reason === "own" || reason === "invalid" || reason === "institutional") return false;
  return !GENERAL_INFO.has(registrableLabel(domain.toLowerCase().trim().replace(/^www\./, "")));
}
