import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "@/lib/config";

/**
 * S3 uyumlu depolama. Anahtarlar her zaman tenant prefix'i taşır; indirmeler kısa TTL imzalı URL.
 */
export function tenantKey(workspaceId: string, ...parts: string[]): string {
  const safe = parts.map((p) => p.replace(/[^a-zA-Z0-9._-]/g, "_"));
  return `ws/${workspaceId}/${safe.join("/")}`;
}

export interface StorageAdapter {
  status(): "ready" | "not_configured";
  put(key: string, body: string | Uint8Array, contentType: string): Promise<void>;
  signedGetUrl(key: string, ttlSeconds?: number): Promise<string>;
}

export function getStorage(): StorageAdapter {
  const cfg = config();
  if (!cfg.STORAGE_BUCKET || !cfg.STORAGE_ACCESS_KEY_ID || !cfg.STORAGE_SECRET_ACCESS_KEY) {
    const nc = async (): Promise<never> => {
      throw new Error("Nesne depolama yapılandırılmamış");
    };
    return { status: () => "not_configured", put: nc, signedGetUrl: nc };
  }
  const client = new S3Client({
    region: cfg.STORAGE_REGION ?? "us-east-1",
    endpoint: cfg.STORAGE_ENDPOINT,
    forcePathStyle: Boolean(cfg.STORAGE_ENDPOINT),
    credentials: { accessKeyId: cfg.STORAGE_ACCESS_KEY_ID, secretAccessKey: cfg.STORAGE_SECRET_ACCESS_KEY },
  });
  const Bucket = cfg.STORAGE_BUCKET;
  return {
    status: () => "ready",
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async signedGetUrl(key, ttlSeconds = 300) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: ttlSeconds });
    },
  };
}
