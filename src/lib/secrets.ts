import { config } from "@/lib/config";
import { createSecretBox, type SecretBox } from "@/lib/crypto";
import { AppError } from "@/lib/http/errors";

/** Tenant entegrasyon sırları (OAuth token) yalnız sunucuda, AES-256-GCM ile şifreli saklanır. */
export function secretBox(): SecretBox {
  const cfg = config();
  if (!cfg.SECRETS_ENCRYPTION_KEY) throw new AppError("not_configured", "SECRETS_ENCRYPTION_KEY yapılandırılmamış; entegrasyon anahtarları saklanamaz");
  return createSecretBox(cfg.SECRETS_KEY_ID ?? "k1", cfg.SECRETS_ENCRYPTION_KEY);
}

export function sealJson(value: Record<string, string>): string {
  return secretBox().encrypt(JSON.stringify(value));
}

export function openJson(sealed: string): Record<string, string> {
  return JSON.parse(secretBox().decrypt(sealed)) as Record<string, string>;
}
