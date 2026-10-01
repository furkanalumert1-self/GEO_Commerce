# Runbook

## Süreçler
- `web`: `npm run build && npm start` (HTTP; uzun iş çalıştırmaz)
- `worker`: `npm run worker` (BullMQ; outbox relay, stale lease kurtarma, kota lease temizliği, retention). Redis zorunlu.
- Sağlık: `/api/v1/health/live`, `/api/v1/health/ready` (DB + Redis; detaylar yalnız logda).

## Deploy
1. CI: lint → typecheck → unit → integration → build.
2. Staging'e `npm run db:deploy` (önce backup). Migration'lar geriye uyumlu yazılır (expand → deploy → contract).
3. Web ve worker'ı aynı sürümle yeniden başlat. Worker SIGTERM'de graceful kapanır.
4. Rollback: önceki imaj; şema geriye uyumlu olduğu için DB geri alınmaz. Gerekirse PITR.

## Yedek
Günlük backup + PITR (sağlayıcı destekliyorsa); ayda bir restore testi.

## Olaylar
- DLQ: `/admin` → dead job; `POST /api/v1/admin/jobs/:id/retry` (gerekçe zorunlu, audit log).
- Maliyet tavanı: `DAILY_PROVIDER_COST_CAP_USD` aşılırsa ücretsiz audit durur (503).
- Billing: webhook imza hatası → 400; `InboxEvent.error` admin panelinde sayılır.
- Sızıntı şüphesi: API anahtarlarını iptal et, `SECRETS_ENCRYPTION_KEY` rotasyonu (yeni `SECRETS_KEY_ID`), oturumları geçersiz kıl (`AUTH_SECRET` rotasyonu).
- Platform admin: `PLATFORM_ADMIN_ALLOWLIST` + IdP tarafında MFA zorunlu.

## Vercel (yalnız web)
- Framework: Next.js (`vercel.json`). Build env gerektirmez; runtime env'leri Project Settings → Environment Variables'a girilir.
- Zorunlu: `DATABASE_URL` (yönetilen Postgres, ör. Neon/Supabase), `AUTH_SECRET`, `SECRETS_ENCRYPTION_KEY`, `SECRETS_KEY_ID`, `APP_URL`, `REDIS_URL`.
- Migration: deploy'dan önce yerelden `DATABASE_URL=<prod> npm run db:deploy`.
- Worker Vercel'de çalışmaz (kalıcı süreç gerekir): Railway/Render/Fly üzerinde `npm run worker`, aynı env ile.
- Demo yayını: `DEMO_MODE=true`, `DEMO_LOGIN=true`, ardından `DEMO_MODE=true npm run db:seed`. Canlı anahtarlarla birlikte kullanılamaz.

## Supabase
- `DATABASE_URL`: Supabase → Connect → **Session pooler** adresi (direct `db.<ref>.supabase.co` IPv6'dır; Vercel ve GitHub Actions'tan erişilemez). Sonuna `?sslmode=require&uselibpqcompat=true` ekleyin; şifredeki özel karakterler URL-encode edilmeli.
- Tablolar: GitHub → Actions → "DB setup" → Run workflow (repo secret `DATABASE_URL` gerekli).
