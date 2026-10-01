import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` veritabanına bağlanmaz; DATABASE_URL yoksa (ör. Vercel install adımı) boş bırakılır.
// migrate/db komutları gerçek URL ister ve URL yoksa kendi hatasını verir.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
