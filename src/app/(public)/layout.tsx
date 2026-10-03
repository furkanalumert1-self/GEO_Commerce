import Link from "next/link";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/brand";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">İçeriğe geç</a>
      <header className="border-b border-border bg-surface/80">
        <div className="mx-auto flex min-h-[60px] w-full max-w-6xl flex-wrap sm:min-h-[72px] items-center justify-between gap-2 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold"><span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary text-[13px] font-semibold text-white">C</span>{APP_NAME}</Link>
          <nav aria-label="Genel" className="flex flex-wrap items-center gap-1 text-sm">
            <Link href="/audit" className="hidden min-h-11 items-center rounded-md px-3 hover:bg-surface-subtle sm:inline-flex">Ücretsiz ölçüm</Link>
            <Link href="/pricing" className="hidden min-h-11 items-center rounded-md px-3 hover:bg-surface-subtle sm:inline-flex">Fiyatlar</Link>
            <Link href="/login" className="inline-flex min-h-11 items-center rounded-md px-3 hover:bg-surface-subtle">Giriş yap</Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-muted sm:px-6">
          <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
            <Link href="/audit" className="hover:text-text hover:underline">Ücretsiz ölçüm</Link>
            <Link href="/pricing" className="hover:text-text hover:underline">Fiyatlar</Link>
            <Link href="/login" className="hover:text-text hover:underline">Giriş yap</Link>
          </p>
          <p>API model yanıtları tüketici uygulamalarındaki (ChatGPT, Gemini vb.) sonuçlarla aynı değildir. Her ölçüm sağlayıcı, model, yüzey, ülke, dil ve örneklem bilgisiyle gösterilir. Gelir artışı veya AI sıralaması garanti edilmez.</p>
        </div>
      </footer>
    </div>
  );
}
