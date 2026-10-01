import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Tahmin edilemeyen token (URL-safe). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Token'lar DB'de yalnız hash olarak saklanır. */
export const hashToken = (token: string) => sha256(`tok:${token}`);

export function hmacSha256(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Deterministik JSON (anahtar sıralı) — inputHash/versionHash için. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value, bigintReplacer);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function bigintReplacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

export const hashObject = (v: unknown) => sha256(stableStringify(v));

// ── Authenticated encryption (AES-256-GCM) — tenant entegrasyon sırları için ──

export interface SecretBox {
  keyId: string;
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

/** 32 baytlık anahtar: base64 (44 karakter) veya hex (64 karakter) kabul edilir. */
export function decodeKey(raw: string): Buffer {
  const v = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  if (key.length !== 32) throw new Error("SECRETS_ENCRYPTION_KEY 32 bayt olmalı (base64 veya 64 karakter hex)");
  return key;
}

export function createSecretBox(keyId: string, rawKey: string): SecretBox {
  const key = decodeKey(rawKey);
  return {
    keyId,
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(keyId));
      const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `v1.${keyId}.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
    },
    decrypt(sealed) {
      const [v, kid, ivB, tagB, ctB] = sealed.split(".");
      if (v !== "v1" || kid !== keyId || !ivB || !tagB || !ctB) throw new Error("Tanınmayan secret formatı veya anahtar");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
      decipher.setAAD(Buffer.from(keyId));
      decipher.setAuthTag(Buffer.from(tagB, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}
