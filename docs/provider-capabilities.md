# Sağlayıcı erişim matrisi

Kontrol tarihi: 2026-09-30. "Canlı" = gerçek hesapla doğrulandı. Hiçbiri henüz canlı doğrulanmadı.

| Sağlayıcı | Kullanım | Uygulama | Doküman / auth | Test | Engel |
|---|---|---|---|---|---|
| OpenAI (Responses API + web_search) | ChatGPT motoru, `api_grounded` | `src/adapters/ai/providers.ts` | Bearer; model `OPENAI_MONITOR_MODEL` | Fixture/parse ✓, canlı ✗ | API anahtarı; şema yeniden doğrulanmalı |
| Google Gemini (generateContent + google_search) | Gemini motoru | aynı | `x-goog-api-key` | canlı ✗ | anahtar |
| Perplexity (chat/completions) | Perplexity motoru | aynı | Bearer | canlı ✗ | anahtar |
| Google AI Overviews / AI Mode, Copilot | ayrı surface | `unsupported` | izinli/lisanslı kaynak yok | — | lisans; Gemini yanıtı yerine kullanılmaz |
| Lisanslı UI kaynağı | `licensed_ui` | yalnız env | `LICENSED_MONITOR_*` | — | sözleşme |
| Shopify | katalog/sipariş/iade/yazma | webhook HMAC + order normalize | `X-Shopify-Hmac-Sha256` | contract fixture ✓ | partner app + mağaza acceptance |
| ikas / Ticimax / IdeaSoft | katalog/sipariş | `not_configured`/`unsupported` | resmi doküman doğrulanmadı | — | partner/API erişimi; uydurma endpoint yok |
| CSV / feed | tüm platformlar | ✓ | — | ✓ | — |
| Stripe | billing | checkout/portal/webhook | `stripe-signature` | replay/stale entegrasyon ✓ (event düzeyi) | anahtar + ülke kullanılabilirliği |
| OpenAI Ads (Advertiser API, CAPI) | Ads | `access_required` | tenant hesap anahtarı (genel OPENAI_API_KEY değil) | guard testleri ✓ | advertiser erişimi, pixel/CAPI etkinleştirme |
| SMTP/Resend, S3/MinIO | e-posta, depolama | ✓ | — | not_configured yolu | yapılandırma |
