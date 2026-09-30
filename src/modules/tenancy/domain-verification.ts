import { resolveTxt } from "node:dns/promises";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashToken, randomToken } from "@/lib/crypto";
import { AppError } from "@/lib/http/errors";
import { safeFetch } from "@/lib/http/safe-fetch";
import { config } from "@/lib/config";

/**
 * Alan adı sahipliği: DNS TXT veya HTML meta token (yetkili OAuth connector ayrıca). Domain eşleşmesi
 * tek başına sahiplik sayılmaz; yazma/tracking/connector için doğrulama gerekir.
 */
export const TXT_PREFIX = "geo-commerce-verify=";

export async function createChallenge(db: PrismaClient, workspaceId: string, brandId: string, method: "dns_txt" | "html_token") {
  const token = randomToken(18);
  await db.domainVerification.create({ data: { workspaceId, brandId, method, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
  return { token, method, instructions: method === "dns_txt" ? `DNS'e TXT kaydı ekleyin: ${TXT_PREFIX}${token}` : `Ana sayfa <head> içine ekleyin: <meta name="geo-commerce-verify" content="${token}">` };
}

export async function checkChallenge(db: PrismaClient, workspaceId: string, brandId: string) {
  const brand = await db.brand.findFirstOrThrow({ where: { id: brandId, workspaceId } });
  if (config().DEMO_MODE && brand.domain.endsWith(".example")) throw new AppError("unsupported", "Örnek alan adları doğrulanamaz");
  const pending = await db.domainVerification.findMany({ where: { brandId, verifiedAt: null, expiresAt: { gt: new Date() } } });
  if (pending.length === 0) throw new AppError("conflict", "Aktif doğrulama talebi yok");
  const found = new Set<string>();
  try {
    const txt = await resolveTxt(brand.domain);
    for (const rec of txt) {
      const v = rec.join("");
      if (v.startsWith(TXT_PREFIX)) found.add(hashToken(v.slice(TXT_PREFIX.length)));
    }
  } catch {
    /* TXT yok */
  }
  try {
    const res = await safeFetch(`https://${brand.domain}/`, { sameSiteAs: brand.domain, maxBytes: 500_000 });
    for (const m of res.body.matchAll(/<meta[^>]+name=["']geo-commerce-verify["'][^>]+content=["']([^"']+)["']/gi)) found.add(hashToken(m[1]!));
  } catch {
    /* sayfa erişilemedi */
  }
  const match = pending.find((p) => found.has(p.tokenHash));
  if (!match) return { verified: false };
  const now = new Date();
  await db.$transaction([
    db.domainVerification.update({ where: { id: match.id }, data: { verifiedAt: now } }),
    db.brand.update({ where: { id: brandId }, data: { verifiedAt: now } }),
  ]);
  return { verified: true, method: match.method };
}
