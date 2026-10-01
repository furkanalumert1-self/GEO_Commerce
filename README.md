# Callypso AI Growth

E-ticaret markaları için AI görünürlük ve gelir platformu: **Keşfet → Teşhis et → Düzelt → Ölç → Gelir**.
Next.js (App Router) + TypeScript strict + Prisma/PostgreSQL + BullMQ/Redis. Modüler monolit, ayrı worker süreci.

> API model yanıtları tüketici uygulamasındaki sonuçlarla aynı değildir; her gözlem sağlayıcı/model/yüzey/ülke/dil/örneklem ile saklanır. Gelir artışı veya AI sıralaması garanti edilmez.

## Kurulum
Gereksinim: Node 22+, Docker (veya yerel Postgres 16 + Redis 7).

```bash
docker compose up -d            # postgres, redis, minio, mailpit
cp .env.example .env            # DATABASE_URL, REDIS_URL, AUTH_SECRET, SECRETS_ENCRYPTION_KEY doldurun
npm install                     # prisma generate otomatik
npm run db:migrate              # migration'ları uygula
DEMO_MODE=true npm run db:seed  # deterministik örnek veri (yalnız demo)
npm run dev                     # web  → http://localhost:3000
npm run worker                  # ayrı terminalde worker
```

## Demo (yalnız yerel)
`DEMO_MODE=true` → dış çağrı yok, fixture AI yanıtları, "Örnek veri" etiketi. Giriş sayfasındaki demo düğmeleri:
`owner@demo.example` (Commerce sahibi), `editor@` (onay yetkisiz), `analyst@`, `billing@`, `ajans@` (Agency, 2 müşteri), `client@` (tek marka).
`next start` ile demo girişi için ayrıca `DEMO_LOGIN=true`. Demo API anahtarı: `demo_key_luma_readonly_0001` (salt okuma).
Demo audit yalnız `.example` alan adlarını tarar (ör. `lumabakim.example`).

## Testler
```bash
npm test                  # birim
npm run test:integration  # TEST_DATABASE_URL gerekli (migrate deploy + izole tenant'lar)
npm run build && npm run test:e2e   # Playwright 360/768/1440 + axe (seed'li DB + worker çalışır olmalı)
npm run lint && npm run typecheck
```
Canlı sağlayıcı testleri contract fixture'ları ile; canlı smoke ayrı ve opt-in.

## Dış erişim gerektirenler
AI sağlayıcı anahtarları, Stripe, Shopify partner uygulaması, ikas/Ticimax/IdeaSoft API erişimi, OpenAI Ads advertiser erişimi, SMTP/S3.
Anahtar yoksa ilgili özellik arayüzde açıkça `not_configured` / `access_required` görünür — sahte başarı yoktur.
Ayrıntı: [docs/provider-capabilities.md](docs/provider-capabilities.md).

## Belgeler
- [docs/progress.md](docs/progress.md) — faz durumu, testler, açık işler
- [docs/decisions.md](docs/decisions.md) — spesifikasyondan sapan/yeni kararlar
- [docs/runbook.md](docs/runbook.md) — deploy, yedek, olay yönetimi

## Yapı
```
src/app/(public)            landing, pricing, audit, auth, paylaşılan rapor
src/app/(product)/w/[id]    tenant kabuğu, marka sayfaları
src/app/api/v1              ince route handler'lar
src/modules/*               domain servisleri (metrics, opportunities, attribution, billing, …)
src/adapters/*              dış sistem sınırları (ai, commerce, ads, billing, email, storage)
src/workers                 job runner, handler'lar, retention
prisma/                     şema, migration, seed
```
