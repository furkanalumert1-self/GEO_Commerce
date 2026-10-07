"use client";

import { useEffect, useState } from "react";

const MAX_AUTO = 8;
// Hata ekranı her denemede yeniden oluşabilir; sayaç modül düzeyinde tutulur, 2 dk hatasız geçince sıfırlanır.
const state = { tries: 0, lastAt: 0 };

/**
 * Süren analiz sayfaları için hata ekranı: sayfa yenilenirken oluşan geçici sunucu hatası analizi durdurmasın diye
 * birkaç saniyede bir kendiliğinden yeniden dener (sayfa geri gelince analiz kaldığı yerden sürer). Sınır aşılırsa
 * "Tekrar dene" gösterilir.
 */
export function AutoRetryError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [gaveUp, setGaveUp] = useState(() => {
    if (Date.now() - state.lastAt > 120_000) state.tries = 0;
    return state.tries >= MAX_AUTO;
  });

  // Aynı hata ekranı denemeler arasında açık kalabilir: sınır her çizimde yeniden okunur.
  const exhausted = gaveUp || state.tries >= MAX_AUTO;

  useEffect(() => {
    if (exhausted) return;
    const t = setTimeout(() => {
      state.tries++;
      state.lastAt = Date.now();
      retry();
    }, 4000 + state.tries * 2000);
    return () => clearTimeout(t);
  }, [error, retry, exhausted]);

  return (
    <div className="mx-auto max-w-md px-4 py-16" role="status">
      <h1 className="text-xl font-semibold">{exhausted ? "Sayfa yüklenemedi" : "Bağlantı yavaşladı"}</h1>
      <p className="mt-2 text-sm text-muted">
        {exhausted
          ? "İlerleme kaydedildi. Tekrar denediğinizde analiz kaldığı yerden devam eder."
          : "Sayfa otomatik olarak yeniden yükleniyor; analiz kaldığı yerden devam edecek. Sekmeyi kapatmayın."}
      </p>
      {exhausted && error.digest ? <p className="mt-2 font-mono text-xs">Kod: {error.digest}</p> : null}
      {exhausted ? <button className="mt-4 min-h-11 rounded-md border border-border px-4 text-sm" onClick={() => { state.tries = 0; setGaveUp(false); retry(); }}>Tekrar dene</button> : null}
    </div>
  );
}
