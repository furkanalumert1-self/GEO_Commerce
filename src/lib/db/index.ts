import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const adapter = new PrismaPg({ connectionString: url });
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
