import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { log } from "@/lib/observability/log";
import { connectWithRetry } from "./connect-retry";

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

type ConnectCallback = (err: Error | undefined, client?: pg.PoolClient, done?: (release?: unknown) => void) => void;

/**
 * Bağlantı alırken geçici hatada (pooler istemci sınırı dolu vb.) kısa bekleyip yeniden dener; sorgular ve
 * işlemler (transaction) bağlantıyı buradan aldığı için hepsi korunur. Sorgu sırasında oluşan hatalar denenmez.
 */
class RetryingPool extends pg.Pool {
  connect(): Promise<pg.PoolClient>;
  connect(callback: ConnectCallback): void;
  connect(callback?: ConnectCallback): Promise<pg.PoolClient> | void {
    const p = connectWithRetry(() => super.connect(), {
      onRetry: (attempt, e) => log.warn("db.connect_retry", { attempt, error: e instanceof Error ? e.message.slice(0, 120) : String(e) }),
    });
    if (!callback) return p;
    p.then(
      (client) => callback(undefined, client, (release) => client.release(release as Error | boolean | undefined)),
      (err: Error) => callback(err),
    );
  }
}

export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  // Serverless'ta her fonksiyon örneği kendi havuzunu açar; Supabase pooler'ının istemci sınırına
  // takılmamak için havuz küçük tutulur ve boştaki bağlantılar çabuk bırakılır (DB_POOL_MAX ile ayarlanabilir).
  const onVercel = Boolean(process.env.VERCEL);
  const max = Number(process.env.DB_POOL_MAX ?? (onVercel ? 2 : 10)) || 2;
  const pool = new RetryingPool({ connectionString: url, max, idleTimeoutMillis: onVercel ? 3_000 : 10_000, connectionTimeoutMillis: 10_000 });
  // Boştaki bağlantı sunucu tarafında koparsa süreç çökmesin; havuz bağlantıyı atıp yenisini açar.
  pool.on("error", (e) => log.warn("db.pool_idle_error", { error: e.message.slice(0, 120) }));
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

function instance(): PrismaClient {
  globalForPrisma.__prisma ??= createPrismaClient();
  return globalForPrisma.__prisma;
}

/**
 * Process başına tek client (connection pool). İlk kullanımda oluşturulur; böylece `next build`
 * DATABASE_URL olmadan da modülleri yükleyebilir.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const c = instance();
    const v = Reflect.get(c, prop, c);
    return typeof v === "function" ? v.bind(c) : v;
  },
});

export { Prisma } from "@/generated/prisma/client";
