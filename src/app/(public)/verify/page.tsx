import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "E-postanızı kontrol edin", robots: { index: false } };

export default function VerifyPage() {
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-5">
        <h1 className="text-xl font-semibold">E-postanızı kontrol edin</h1>
        <p className="mt-2 text-sm text-muted">Giriş bağlantısı gönderildi. Bağlantı 15 dakika geçerlidir ve tek kullanımlıktır.</p>
        <p className="mt-4 text-sm">
          E-posta gelmediyse <Link className="text-primary underline" href="/login">yeni bağlantı isteyin</Link>.
        </p>
      </Card>
    </div>
  );
}
