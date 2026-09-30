import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { authProviders } from "@/auth";
import { LoginForm } from "@/components/forms/login-form";

export const metadata: Metadata = { title: "Giriş", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/w";
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold">Giriş yap</h1>
      {sp.error ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm">
          Giriş tamamlanamadı. Bağlantının süresi dolmuş olabilir; yeni bir bağlantı isteyin.
        </div>
      ) : null}
      <Card className="p-5">
        <LoginForm providers={authProviders} next={next} />
      </Card>
      <p className="text-xs text-muted">Kendi parola sistemimiz yoktur: e-posta bağlantısı veya Google hesabı kullanılır. Oturumlar 7 gün sonra sona erer.</p>
    </div>
  );
}
