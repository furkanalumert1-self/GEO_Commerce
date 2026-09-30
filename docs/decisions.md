# Kararlar (yalnız yeni/çelişen)

1. **Prisma 7.10 (stable)** — npm `latest` etiketi 8.0 RC gösteriyor; RC yerine son stable seçildi. `prisma.config.ts` + `@prisma/adapter-pg`.
2. **TanStack Table kullanılmadı** — tablolar sunucu tarafı sayfalanan Server Component'ler; kurulan sürüm (v9) API'si doğrulanmadan bağımlılık eklenmedi. Gerekirse sonradan eklenir.
3. **Demo girişi** — `DEMO_MODE` + (dev veya açık `DEMO_LOGIN=true`). Production'da demo + canlı anahtar birlikteyse startup fail.
4. **Demo audit yalnız `.example` alan adları** — gerçek bir alan adına örnek veri atfedilmemesi için.
5. **Publish** — hiçbir connector canlı `contentWrite` doğrulamasına sahip olmadığından 422 + export alternatifi; "Manuel yayımlandı → ölçüme al" akışı eklendi.
6. **Kayıp gelir** — varsayılan gizli; `lostRevenueScenario` yalnız tüm kullanıcı girdileriyle hesaplar (UI girişi henüz yok).
7. **Cohort** — pano metrikleri seçili filtredeki gözlemlerden canlı hesaplanır; run bitiminde immutable `MetricSnapshot` yazılır (rapor/trend kaynağı).
8. **RLS** — ilk sürümde uygulama katmanı scoping + composite FK + IDOR testleri; RLS açık iş.
9. **Rate limit** process içi (tek instance); çoklu instance için Redis gerekir.
10. **Test DB** — `prisma migrate deploy` (reset değil); testler her çalıştırmada izole tenant yaratır.
