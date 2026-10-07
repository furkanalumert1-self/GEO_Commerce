"use client";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16" role="alert">
      <h1 className="text-xl font-semibold">Bir şeyler ters gitti</h1>
      <p className="mt-2 text-sm text-muted">Sayfa yüklenemedi. Tekrar deneyin; sorun sürerse destek ekibine aşağıdaki kodu iletin.</p>
      {error.digest ? <p className="mt-2 font-mono text-xs">Kod: {error.digest}</p> : null}
      <button className="mt-4 min-h-11 rounded-md border border-border px-4 text-sm" onClick={() => retry()}>Tekrar dene</button>
    </main>
  );
}
