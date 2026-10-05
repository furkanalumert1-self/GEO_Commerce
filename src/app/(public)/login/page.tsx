import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { authProviders } from "@/auth";
import { LoginForm } from "@/components/forms/login-form";

export const metadata: Metadata = { title: "Giriş", robots: { index: false } };

// Müşteriye gösterilen metin: teknik ayar adı yok (yönetici ayrıntıları sunucu kayıtlarında, [auth] / email.send_failed).
const ERROR_TEXT: Record<string, string> = {
  CredentialsSignin: "Örnek hesap şu anda açılamıyor. Biraz sonra tekrar deneyin.",
  Configuration: "Giriş e-postasını şu anda gönderemiyoruz. Birkaç dakika sonra tekrar deneyin; sorun sürerse bize yazın.",
  Verification: "Giriş bağlantısının süresi dolmuş veya daha önce kullanılmış. Yeni bir bağlantı isteyin.",
  AccessDenied: "Bu hesapla giriş izni yok.",
  EmailSignin: "Giriş e-postasını şu anda gönderemiyoruz. Birkaç dakika sonra tekrar deneyin; sorun sürerse bize yazın.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/w";
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold">Giriş yap</h1>
      {sp.error ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm">
          <p>{ERROR_TEXT[sp.error] ?? "Giriş tamamlanamadı. Tekrar deneyin."}</p>
          <p className="mt-1 text-xs text-muted">Hata kodu: {sp.error.slice(0, 40)}</p>
        </div>
      ) : null}
      <Card className="p-5">
        <LoginForm providers={authProviders} next={next} />
      </Card>
      <p className="text-xs text-muted">Kendi parola sistemimiz yoktur: e-posta bağlantısı veya Google hesabı kullanılır. Oturumlar 7 gün sonra sona erer.</p>
    </div>
  );
}
