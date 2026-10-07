/**
 * Bağlantı alma aşamasındaki geçici hatalar: pooler istemci sınırı (Supabase EMAXCONNSESSION), Postgres
 * "too many clients", bağlantı kurulamadı/zaman aşımı. Bu aşamada sorgu henüz gönderilmediği için yeniden denemek
 * güvenlidir (yazma iki kez çalışmaz). Sorgu sırasında kopan bağlantılar burada yeniden denenmez.
 */
const TRANSIENT_CONNECT = /EMAXCONN|max client connections|too many clients|remaining connection slots|timeout exceeded when trying to connect|connection timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i;
const TRANSIENT_CODES = new Set(["53300", "57P03", "08001", "08006", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"]);

export function isTransientConnectError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: unknown; message?: unknown };
  if (typeof err.code === "string" && TRANSIENT_CODES.has(err.code)) return true;
  return typeof err.message === "string" && TRANSIENT_CONNECT.test(err.message);
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, e: unknown) => void;
}

/** Artan bekleme + rastgele sapma ile en fazla `attempts` deneme (varsayılan 5: ~0,3+0,6+1,2+2,4 sn). */
export async function connectWithRetry<T>(connect: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const base = opts.baseMs ?? 300;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try {
      return await connect();
    } catch (e) {
      if (i >= attempts || !isTransientConnectError(e)) throw e;
      opts.onRetry?.(i, e);
      await sleep(base * 2 ** (i - 1) + Math.floor(Math.random() * base));
    }
  }
}
