/**
 * Redis'siz geçici yürütme (JOB_EXECUTION_MODE=inline) sınırları. Vercel Fluid compute açıkken (Hobby dahil)
 * fonksiyon süresi 300 sn'ye kadar çıkabilir; "advance" rotaları `maxDuration = 120` export eder.
 * Bir adım STEP_BUDGET_MS sonrasında yeni dış çağrı başlatmaz; başlamış çağrı en fazla CALL_TIMEOUT_MS sürer
 * → en kötü durumda ~75 sn + kayıt payı. Web aramalı AI yanıtları 30 sn'yi aşabildiği için çağrı süresi 55 sn.
 */
export const INLINE_STEP_BUDGET_MS = 20_000;
export const INLINE_CALL_TIMEOUT_MS = 55_000;
/** Ücretsiz audit'te adım modunda taranan sayfa üst sınırı (worker modunda plan limiti: 20). */
export const INLINE_AUDIT_CRAWL_PAGES = 10;
/** Marka taramasında adım modunda tek adımda taranan sayfa üst sınırı. */
export const INLINE_CRAWL_MAX_PAGES = 25;

export const stepDeadline = (startedAt = Date.now()) => startedAt + INLINE_STEP_BUDGET_MS;
