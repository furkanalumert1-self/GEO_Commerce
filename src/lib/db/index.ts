import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  // Serverless'ta her fonksiyon örneği kendi havuzunu açar; Supabase pooler'ının istemci sınırına
  // takılmamak için havuz küçük tutulur ve boştaki bağlantılar çabuk kapatılır (DB_POOL_MAX ile ayarlanabilir).
  const max = Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 3 : 10)) || 3;
  const adapter = new PrismaPg({ connectionString: url, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  return new PrismaClient({ adapter });
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
