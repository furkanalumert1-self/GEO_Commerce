import "dotenv/config";
import { execSync } from "node:child_process";

/** Test DB şemasını migration'larla günceller (boş DB'ye uygulanabildiğini de doğrular). Testler her çalıştırmada izole tenant oluşturur. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL tanımlı değil");
  execSync("npx prisma migrate deploy --config prisma.config.ts", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url, PRISMA_SKIP_POSTINSTALL_GENERATE: "1" } });
}
