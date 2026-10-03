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
- Demo yayını: `DEMO_MODE=true`, `DEMO_LOGIN=true`, ardından `DEMO_MODE=true npm run db:seed`. Demo yalnız `isDemo` workspace'leri ve `.example` alan adlarını etkiler; gerçek workspace'ler canlı sağlayıcıları kullanır, mock'a düşmez. Canlı anahtarlarla birlikte açık olabilir.

## Supabase
- `DATABASE_URL`: Supabase → Connect → **Session pooler** adresi (direct `db.<ref>.supabase.co` IPv6'dır; Vercel ve GitHub Actions'tan erişilemez). Sonuna `?sslmode=require&uselibpqcompat=true` ekleyin; şifredeki özel karakterler URL-encode edilmeli.
- Tablolar: GitHub → Actions → "DB setup" → Run workflow (repo secret `DATABASE_URL` gerekli).

## Gerçek entegrasyon kurulumu (Callypso AI Growth)
Değerleri sohbete/repo'ya yazmayın; Vercel (web) ve worker ortamına girin. Preview/staging/production için ayrı değerler kullanın.

| Amaç | Değişkenler | Panelde yapılacak |
|---|---|---|
| Gerçek giriş (e-posta bağlantısı) | `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` (ör. `Callypso AI Growth <no-reply@alanadiniz>`), veya `SMTP_URL` | Resend'de gönderen alan adını doğrulayın (SPF/DKIM); doğrulanmamış alan adıyla yalnız Resend hesap sahibine gönderim yapılabilir. |
| Google ile giriş | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google Cloud OAuth istemcisi; yetkili yönlendirme: `{APP_URL}/api/auth/callback/google`; uygulama adı **Callypso AI Growth**. |
| Entegrasyon sırları | `SECRETS_ENCRYPTION_KEY` (32 bayt), `SECRETS_KEY_ID` (ör. `k1`) | Canlıya çıktıktan sonra anahtar değiştirilmez (rotasyon prosedürü yukarıda). |
| Shopify | `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | Shopify Partner/Dev Dashboard'da uygulama: App URL `{APP_URL}`, Redirect URL `{APP_URL}/api/v1/integrations/shopify/callback`, kapsamlar `read_products, read_inventory, read_orders`, uygulama adı **Callypso AI Growth**. Public dağıtımda zorunlu GDPR webhook'ları Partner panelinde tanımlanmalı. Sipariş webhook'ları bağlantıda otomatik kaydedilir: `{APP_URL}/api/v1/webhooks/shopify/{integrationId}`. |
| AI görünürlük ölçümü | `OPENAI_API_KEY` + `OPENAI_MONITOR_MODEL`, `GOOGLE_AI_API_KEY` + `GOOGLE_MONITOR_MODEL`, `PERPLEXITY_API_KEY` + `PERPLEXITY_MONITOR_MODEL` | Yalnız yapılandırılan platform çalışır; harcama tavanı `DAILY_PROVIDER_COST_CAP_USD`. |
| Fix with AI taslakları | `OPENAI_API_KEY`, `GENERATION_MODEL` | Yoksa gerçek workspace'te taslak üretimi açık hata verir (şablon/mock yok). |
| Kuyruk/worker | `REDIS_URL` + worker süreci | Audit, ölçüm ve mağaza senkronizasyonu worker olmadan kuyrukta bekler. |

Shopify bağlantı akışı: Entegrasyon → mağaza adresi (`*.myshopify.com`) → Shopify onayı → callback'te HMAC + tek kullanımlık state + oturum kullanıcısı doğrulanır → token şifreli saklanır → mağaza API'si ve kapsamlar kontrol edilir → yalnız bundan sonra **Bağlı** → katalog/sipariş senkronizasyonu kuyruğa alınır. İçerik yayınlama (yazma kapsamı) istenmez; onaylı içerik dışa aktarılıp manuel uygulanır ve "kullanıcı bildirimi" olarak ölçülür.

## Sağlayıcı testi (kuyruk/worker gerekmez)
`PLATFORM_ADMIN_ALLOWLIST` içindeki e-posta ile gerçek girişten sonra `/admin` → "Sağlayıcı testi": her yapılandırılmış AI platformuna tek kısa çağrı yapar (model, gecikme, kaynak sayısı veya hata kodu) ve isteğe bağlı olarak yöneticiye test e-postası gönderir. Anahtar değerleri hiçbir yerde gösterilmez.

## Redis'siz geçici mod (`JOB_EXECUTION_MODE=inline`)
Redis ve ayrı worker olmadan Vercel + mevcut veritabanı üzerinde gerçek audit, ölçüm, tarama ve Fix with AI.

- Ayar: `JOB_EXECUTION_MODE=inline` (REDIS_URL gerekmez). Varsayılan `queue`; queue modunda REDIS_URL yoksa iş başlatma açık `not_configured` hatası verir (iş sonsuza kadar "sırada" kalmaz), `/api/v1/health/ready` 503 döner.
- Yürütme: işler `JobRecord`'a yazılır (outbox'a değil). Açık sayfa, iş bitene kadar `POST /api/v1/jobs/:id/advance` (girişli kullanıcı, işi başlatma yetkisiyle) veya `POST /api/v1/audits/:token/advance` (anonim audit, süreli bağlantı) ile sıradaki adımı ister. GET uç noktaları iş başlatmaz.
- Sınırlar (`src/lib/queue/inline.ts`): adım bütçesi 20 sn (sonrasında yeni dış çağrı başlamaz), sağlayıcı çağrısı zaman aşımı 55 sn (web aramalı yanıtlar 30 sn’yi aşabiliyor), adım rotaları `maxDuration = 120` (Vercel Fluid compute gerekir; Hobby’de varsayılan açık, üst sınır 300 sn). Audit taraması en fazla 10 sayfa ("Hızlı analiz": 5 soru × ChatGPT/Gemini), marka taraması tek adımda en fazla 25 sayfa (aşarsa "kısmi"), Fix with AI üretimi 50 sn zaman aşımı.
- Güvenlik: aynı işe paralel/çift istek kilit (lease) ile engellenir; yarıda kalan adımın kilidi 2 dk sonra düşer ve iş kaldığı yerden devam eder. Tamamlanmış çağrılar tekrar edilmez; kesinti anında yanıtı alınmış ama kaydedilememiş tek çağrı yeniden yapılabilir (en fazla bir ek maliyet). Geçici hata/zaman aşımı/429 sınırlı yeniden denenir; anahtar/model hatası (auth, 400, 404) alan platform o işte tekrar çağrılmaz. Başarısız sorgu görünürlük sıfırı sayılmaz.
- Sınırlamalar: analiz yalnız sayfa açıkken ilerler (sekme kapanırsa duraklar, geri gelince devam eder); zamanlanmış/otomatik ölçüm yoktur; örneklem küçüktür. Kalıcı çözüm: Redis + worker ile `JOB_EXECUTION_MODE=queue`. Inline modda açılmış işler queue moduna geçişte otomatik yeniden çalıştırılmaz.
- Ödeme sağlayıcısı yokken uçtan uca test: `/admin` → Tenant'lar → "7 gün Fix with AI" (yalnız `PLATFORM_ADMIN_ALLOWLIST` yöneticisi; süreli, gerekçeli, audit log'lu; demo workspace'e verilmez).
