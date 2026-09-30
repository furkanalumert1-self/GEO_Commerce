/** Uygulama hataları → §11 hata zarfı ve HTTP durumları. */
export type ErrorCode =
  | "validation_error"
  | "unauthenticated"
  | "forbidden"
  | "plan_required"
  | "not_found"
  | "conflict"
  | "unsupported"
  | "quota_exceeded"
  | "rate_limited"
  | "dependency_unavailable"
  | "not_configured"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthenticated: 401,
  forbidden: 403,
  plan_required: 403,
  not_found: 404,
  conflict: 409,
  unsupported: 422,
  quota_exceeded: 429,
  rate_limited: 429,
  dependency_unavailable: 503,
  not_configured: 503,
  internal: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: {
      fieldErrors?: Record<string, string[]>;
      retryable?: boolean;
      limit?: number;
      used?: number;
      resetAt?: string;
      [k: string]: unknown;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return STATUS[this.code];
  }
}

export const notFound = (what = "Kaynak") => new AppError("not_found", `${what} bulunamadı`);
export const forbidden = (msg = "Bu işlem için yetkiniz yok") => new AppError("forbidden", msg);
export const conflict = (msg: string, details = {}) => new AppError("conflict", msg, details);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
