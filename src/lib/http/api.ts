import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { hashObject, hashToken } from "@/lib/crypto";
import { log } from "@/lib/observability/log";
import { AppError, isAppError } from "./errors";
import { resolveBrandAccess, resolveWorkspaceAccess, type BrandAccess, type Principal, type WorkspaceAccess } from "@/modules/tenancy/access";

/**
 * İnce route handler yardımcıları (§11): {data, meta:{requestId}} / {error:{...}, requestId}.
 * Mutations: cookie oturumunda Origin doğrulaması (CSRF); API anahtarında scope + rate limit.
 */

export function json(data: unknown, init: { status?: number; requestId: string; nextCursor?: string | null; headers?: Record<string, string> }) {
  return new NextResponse(JSON.stringify({ data, meta: { requestId: init.requestId, ...(init.nextCursor !== undefined ? { nextCursor: init.nextCursor } : {}) } }, bigintSafe), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", "x-request-id": init.requestId, ...(init.headers ?? {}) },
  });
}

export function errorResponse(e: unknown, requestId: string) {
  if (isAppError(e)) {
    const { fieldErrors, retryable, ...rest } = e.details;
    const safeExtra = e.code === "quota_exceeded" ? { limit: rest.limit, used: rest.used, resetAt: rest.resetAt } : {};
    return NextResponse.json(
      { error: { code: e.code, message: e.message, fieldErrors, retryable: retryable ?? false, ...safeExtra }, requestId },
      { status: e.status, headers: { "x-request-id": requestId } },
    );
  }
  if (e instanceof z.ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of e.issues) (fieldErrors[i.path.join(".") || "_"] ??= []).push(i.message);
    return NextResponse.json({ error: { code: "validation_error", message: "Geçersiz istek", fieldErrors, retryable: false }, requestId }, { status: 400, headers: { "x-request-id": requestId } });
  }
  log.error("api.unhandled", { requestId, error: e });
  return NextResponse.json({ error: { code: "internal", message: "Beklenmeyen bir hata oluştu", retryable: true }, requestId }, { status: 500, headers: { "x-request-id": requestId } });
}

function bigintSafe(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  const appOrigin = new URL(config().APP_URL).origin;
  const reqOrigin = req.nextUrl.origin;
  if (!origin || (origin !== appOrigin && origin !== reqOrigin)) {
    throw new AppError("forbidden", "Geçersiz origin");
  }
}

// Basit bellek içi rate limit (tek instance); çoklu instance'da Redis'e taşınmalı (docs/decisions.md).
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > limit) throw new AppError("rate_limited", "Çok fazla istek", { retryable: true, resetAt: new Date(b.resetAt).toISOString() });
}

export async function getPrincipal(req: NextRequest): Promise<Principal> {
  const authz = req.headers.get("authorization");
  if (authz?.startsWith("Bearer ")) {
    const token = authz.slice(7).trim();
    const key = await db.apiKey.findUnique({ where: { keyHash: hashToken(token) } });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) throw new AppError("unauthenticated", "Geçersiz API anahtarı");
    rateLimit(`key:${key.id}`, 120, 60_000);
    await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    return { kind: "api_key", userId: null, apiKeyId: key.id, scopes: key.scopes, brandScope: key.brandScope };
  }
  const session = await auth();
  if (!session?.user?.id) throw new AppError("unauthenticated", "Oturum gerekli");
  assertSameOrigin(req);
  return { kind: "user", userId: session.user.id };
}

type Ctx<P> = { params: Promise<P> };

interface HandlerArgs<P> {
  req: NextRequest;
  params: P;
  requestId: string;
}

export function route<P = Record<string, string>>(fn: (a: HandlerArgs<P>) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
    try {
      const params = (await ctx.params) ?? ({} as P);
      return await fn({ req, params, requestId });
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}

export function workspaceRoute<P extends { w: string }>(fn: (a: HandlerArgs<P> & { access: WorkspaceAccess }) => Promise<Response>) {
  return route<P>(async (a) => {
    const principal = await getPrincipal(a.req);
    const access = await resolveWorkspaceAccess(db, principal, a.params.w);
    return fn({ ...a, access });
  });
}

export function brandRoute<P extends { w: string; b: string }>(fn: (a: HandlerArgs<P> & { access: BrandAccess }) => Promise<Response>) {
  return route<P>(async (a) => {
    const principal = await getPrincipal(a.req);
    const access = await resolveBrandAccess(db, principal, a.params.w, a.params.b);
    return fn({ ...a, access });
  });
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("validation_error", "Geçersiz JSON gövdesi");
  }
  return schema.parse(body);
}

export const listQuery = z.object({
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().max(40).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  country: z.string().length(2).optional(),
  language: z.string().min(2).max(10).optional(),
  engine: z.string().max(40).optional(),
});

export function parseQuery<T extends z.ZodType>(req: NextRequest, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams));
}

/**
 * Idempotency-Key: workspace+route+key unique; aynı key farklı inputHash → 409.
 * Aynı key+input tekrar gelirse saklı yanıt döner.
 */
export async function withIdempotency(
  req: NextRequest,
  workspaceId: string,
  routeKey: string,
  input: unknown,
  requestId: string,
  run: () => Promise<{ status: number; data: unknown }>,
): Promise<Response> {
  const key = req.headers.get("idempotency-key");
  if (!key) throw new AppError("validation_error", "Idempotency-Key başlığı gerekli");
  if (key.length > 200) throw new AppError("validation_error", "Idempotency-Key çok uzun");
  const inputHash = hashObject(input);
  const existing = await db.idempotencyRecord.findUnique({ where: { workspaceId_route_key: { workspaceId, route: routeKey, key } } });
  if (existing) {
    if (existing.inputHash !== inputHash) throw new AppError("conflict", "Aynı Idempotency-Key farklı girdiyle kullanıldı");
    if (existing.statusCode !== null) return json(existing.response, { status: existing.statusCode, requestId, headers: { "idempotent-replay": "true" } });
    throw new AppError("conflict", "Aynı istek hâlâ işleniyor", { retryable: true });
  }
  try {
    await db.idempotencyRecord.create({ data: { workspaceId, route: routeKey, key, inputHash } });
  } catch {
    throw new AppError("conflict", "Aynı istek hâlâ işleniyor", { retryable: true });
  }
  try {
    const out = await run();
    await db.idempotencyRecord.update({
      where: { workspaceId_route_key: { workspaceId, route: routeKey, key } },
      data: { statusCode: out.status, response: JSON.parse(JSON.stringify(out.data, bigintSafe)) },
    });
    return json(out.data, { status: out.status, requestId });
  } catch (e) {
    await db.idempotencyRecord.delete({ where: { workspaceId_route_key: { workspaceId, route: routeKey, key } } }).catch(() => undefined);
    throw e;
  }
}
