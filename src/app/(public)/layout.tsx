import Link from "next/link";
import type { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">İçeriğe geç</a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 sm:px-6">
          <Link href="/" className="font-semibold">Callypso AI Growth</Link>
          <nav aria-label="Genel" className="flex flex-wrap items-center gap-1 text-sm">
            <Link href="/audit" className="inline-flex min-h-11 items-center rounded-md px-3 hover:bg-bg">Ücretsiz GEO Audit</Link>
            <Link href="/pricing" className="inline-flex min-h-11 items-center rounded-md px-3 hover:bg-bg">Fiyatlar</Link>
            <Link href="/login" className="inline-flex min-h-11 items-center rounded-md border border-border px-3 hover:bg-bg">Giriş</Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-muted sm:px-6">
          <p>API model yanıtları tüketici uygulamalarındaki (ChatGPT, Gemini vb.) sonuçlarla aynı değildir. Her ölçüm sağlayıcı, model, yüzey, ülke, dil ve örneklem bilgisiyle gösterilir. Gelir artışı veya AI sıralaması garanti edilmez.</p>
        </div>
      </footer>
    </div>
  );
}
