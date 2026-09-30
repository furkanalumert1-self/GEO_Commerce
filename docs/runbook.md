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
