import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-xl font-semibold">Sayfa bulunamadı</h1>
      <p className="mt-2 text-sm text-muted">Aradığınız kaynak yok veya erişim yetkiniz bulunmuyor.</p>
      <Link className="mt-4 inline-block text-primary underline" href="/w">Çalışma alanlarına dön</Link>
    </main>
  );
}
