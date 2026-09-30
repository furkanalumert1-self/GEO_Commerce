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

/** Process başına tek client (connection pool). */
export const db: PrismaClient = globalForPrisma.__prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = db;

export { Prisma } from "@/generated/prisma/client";
