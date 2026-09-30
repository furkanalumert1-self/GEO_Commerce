import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { AppError } from "./errors";

/**
 * SSRF korumalı fetch (§13). Crawler/import/webhook URL'leri için:
 * - yalnız http(s), port allowlist (80/443)
 * - DNS çözümü + her redirect'te private/loopback/link-local/metadata IPv4+IPv6 engeli
 * - DNS rebinding: bağlantı doğrulanan IP'ye pinlenir (lookup override)
 * - body/time/redirect limitleri
 */
export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedPorts?: number[];
  headers?: Record<string, string>;
  method?: "GET" | "POST" | "HEAD";
  body?: string;
  /** Test için DNS çözücü enjekte edilebilir. */
  resolver?: (host: string) => Promise<string[]>;
  /** Redirect'lerin aynı site altında kalması zorunlu mu (crawler: doğrulanmış domain). */
  sameSiteAs?: string;
}

export interface SafeResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

export function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function inCidr4(ip: string, cidr: string): boolean {
  const [base, bitsS] = cidr.split("/");
  const bits = Number(bitsS);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base!) & mask);
}

const BLOCKED_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24",
  "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32",
];

function expandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  // IPv4-mapped/embedded son bölüm
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]!);
    addr = addr.replace(v4[1]!, `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  if (addr.includes("::")) {
    const fill = 8 - h.length - t.length;
    if (fill < 0) return null;
    return [...h, ...new Array<string>(fill).fill("0"), ...t].map((x) => parseInt(x || "0", 16));
  }
  if (h.length !== 8) return null;
  return h.map((x) => parseInt(x, 16));
}

export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return BLOCKED_V4.some((c) => inCidr4(ip, c));
  if (v === 6) {
    const p = expandV6(ip);
    if (!p || p.some((x) => Number.isNaN(x))) return true;
    const all0 = p.every((x) => x === 0);
    if (all0) return true; // ::
    if (p.slice(0, 7).every((x) => x === 0) && p[7] === 1) return true; // ::1
    // IPv4-mapped ::ffff:a.b.c.d ve IPv4-compatible
    if (p.slice(0, 5).every((x) => x === 0) && (p[5] === 0xffff || p[5] === 0)) {
      const v4 = `${p[6]! >> 8}.${p[6]! & 0xff}.${p[7]! >> 8}.${p[7]! & 0xff}`;
      return isBlockedIp(v4);
    }
    if (p[0] === 0x64 && p[1] === 0xff9b) return true; // NAT64 → iç ağa çıkabilir
    const first = p[0]!;
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (first === 0x2001 && p[1] === 0x0db8) return true; // documentation
    return false;
  }
  return true;
}

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /\.internal$/i, /\.local$/i, /^metadata(\.google\.internal)?$/i];

export async function assertPublicUrl(
  raw: string,
  opts: Pick<SafeFetchOptions, "allowedPorts" | "resolver"> = {},
): Promise<{ url: URL; address: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("validation_error", "Geçersiz URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AppError("validation_error", "Yalnız http(s) URL'leri desteklenir");
  if (url.username || url.password) throw new AppError("validation_error", "URL kimlik bilgisi içeremez");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!(opts.allowedPorts ?? [80, 443]).includes(port)) throw new AppError("validation_error", "Port izinli değil");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.some((re) => re.test(host))) throw new AppError("validation_error", "Bu host'a erişim engelli");
  const addresses = isIP(host) ? [host] : await (opts.resolver ?? defaultResolver)(host);
  if (addresses.length === 0) throw new AppError("validation_error", "Alan adı çözümlenemedi");
  // Herhangi biri iç ağa çıkıyorsa reddet (rebinding / çoklu kayıt).
  if (addresses.some(isBlockedIp)) throw new AppError("validation_error", "İç ağ adreslerine erişim engelli");
  return { url, address: addresses[0]! };
}

async function defaultResolver(host: string): Promise<string[]> {
  const res = await lookup(host, { all: true, verbatim: true });
  return res.map((r) => r.address);
}

function registrableDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { url, address } = await assertPublicUrl(current, opts);
    if (opts.sameSiteAs) {
      const site = registrableDomain(opts.sameSiteAs);
      const h = registrableDomain(url.hostname);
      if (h !== site && !h.endsWith(`.${site}`)) throw new AppError("validation_error", "Redirect doğrulanmış domain dışına çıkıyor");
    }
    const res = await pinnedRequest(url, address, { ...opts, maxBytes, timeoutMs });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, url).toString();
      continue;
    }
    return { ...res, url: url.toString() };
  }
  throw new AppError("validation_error", "Çok fazla yönlendirme");
}

function pinnedRequest(
  url: URL,
  address: string,
  opts: SafeFetchOptions & { maxBytes: number; timeoutMs: number },
): Promise<Omit<SafeResponse, "url">> {
  return new Promise((resolve, reject) => {
    const fn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const family = isIP(address);
    const req = fn(
      url,
      {
        method: opts.method ?? "GET",
        headers: { "user-agent": "GEOCommerceBot/1.0 (+https://example.invalid/bot)", accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.5", ...opts.headers },
        // DNS rebinding koruması: doğrulanan IP'ye bağlan.
        lookup: (_h, _o, cb) => cb(null, address, family),
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, Math.max(0, c.length - (size - opts.maxBytes))));
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        const done = () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")])),
            body: Buffer.concat(chunks).toString("utf8"),
            truncated,
          });
        res.on("end", done);
        res.on("close", done);
        res.on("error", (e) => (truncated ? done() : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(new AppError("dependency_unavailable", "Zaman aşımı", { retryable: true })));
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
