# İlerleme kaydı (≤60 satır)

Son güncelleme: 2026-09-30 · Dal: `claude/vigilant-heisenberg-mlhiht`

## Test durumu
- Birim: 106/106 ✓ (formüller, SOV, null/profile/cohort, niyet/fırsat sınırları, attribution, DST, SSRF/IPv6, crypto, RBAC, Ads guard, CSV/HTML injection, plan kapıları)
- Entegrasyon (PostgreSQL): 13/13 ✓ (eşzamanlı kota, çift borç yok, lease cleanup, IDOR/API key kapsamı/composite FK, onay hash race, sipariş replay + out-of-order + iade restate, billing replay/stale, deterministik skor, DLQ/retry)
- E2E (Playwright, 360/768/1440 + axe): 9/9 ✓ — audit→claim→trial, ölçüm→fırsat→Fix→onay→export, ajans müşteri izolasyonu
- typecheck ✓ · lint 0 hata (3 uyarı: react-hook-form `watch` compiler uyarısı) · `next build` ✓ · migration boş DB'ye ✓

## Fazlar
| Faz | Durum |
|---|---|
| P0 Temel | ✓ repo, şema+migration, Auth.js (e-posta/Google/demo), RBAC, tenant kabuğu, tasarım token'ları, seed, config |
| P1 Acquisition+Monitoring | ✓ audit (crawl+readiness+2 motor+claim), onboarding sihirbazı, crawler, katalog, prompt/intent, 3 AI adapter (canlı smoke bekliyor), run/score/SOV/rakipler |
| P2 Opportunity+Action | ✓ citation gap, skor/teşhis, Fix editörü (diff, sürüm, JSON-LD, export, onay), ölçüm döngüsü kaydı |
| P3 Commerce | ◐ adapter sözleşmesi, Shopify webhook+normalize (fixture), CSV/feed, tracker ingest, sipariş/iade, attribution. ikas/Ticimax/IdeaSoft: erişim bekliyor |
| P4 Monetization+Agency | ◐ entitlement, kota, Stripe adapter+webhook, ajans çok müşteri, raporlar (snapshot/CSV/paylaşım), API key, admin |
| P5 Ads+Hardening | ◐ Ads intelligence/draft/CSV, guard kuralları (test), access_required durumları; SSRF, redaksiyon, CSP |

## Açık işler (done altında gizlenmez)
- [ ] Canlı smoke: OpenAI / Gemini / Perplexity anahtarlarıyla (adapter şemaları resmi dokümanla yeniden doğrulanmalı)
- [ ] Shopify canlı OAuth + sync (partner mağaza) · ikas/Ticimax/IdeaSoft resmi API erişimi — en az bir yerel connector canlı doğrulanmadan P3 "ticari tamam" değil
- [ ] Stripe canlı checkout testi (şirket ülkesinde kullanılabilirlik doğrulanmalı; yoksa yerel sağlayıcı)
- [ ] PDF server render (şu an yazdırılabilir HTML snapshot + CSV)
- [ ] Giden webhook uç nokta yönetimi UI + teslim worker'ı + 7 gün replay UI (modeller hazır)
- [ ] Zamanlanmış otomatik ölçüm (MonitoringSchedule → run) ve rapor zamanlaması worker'ı
- [ ] Bildirim üretimi (eşik/düşüş/bağlantı) ve e-posta digest; tercih UI
- [ ] Postgres RLS (defense-in-depth) + ayrı migration rolü — şu an uygulama katmanı scoping + composite FK
- [ ] Rate limit Redis'e taşınmalı (şu an process içi)
- [ ] Ads: canlı hesap/capability testi, paused campaign create, conversion outbox (OpenAI CAPI)
- [ ] Commerce event kotası sayacı, SSO/SCIM (Enterprise sözleşmesi), privacy export/delete job'u
- [ ] i18n: sayfa içi metinlerin çeviri kataloğuna taşınması (kabuk metinleri anahtarlı)
- [ ] Demo senaryo anahtarı (empty/partial/expired trial/quota/broken connector) — seed kısmen kapsar (reauth connector, access_required Ads)

## Engeller
- Dış hesap/erişim: AI sağlayıcı anahtarları, Stripe, Shopify partner, ikas/Ticimax/IdeaSoft, OpenAI Ads advertiser erişimi.

## Sonraki adım
Canlı AI anahtarlarıyla opt-in smoke → Shopify partner mağaza acceptance → zamanlanmış ölçüm worker'ı.
