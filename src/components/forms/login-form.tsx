"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";

const DEMO_USERS = [
  ["owner@demo.example", "Marka sahibi (Owner, Commerce)"],
  ["editor@demo.example", "Editör (onay yetkisi yok)"],
  ["analyst@demo.example", "Analist"],
  ["billing@demo.example", "Faturalama"],
  ["ajans@demo.example", "Ajans sahibi (Agency)"],
  ["client@demo.example", "Ajans müşterisi (tek marka)"],
];

export function LoginForm({ providers, next }: { providers: { email: boolean; google: boolean; demo: boolean }; next: string }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Geçerli bir e-posta girin");
      return;
    }
    setPending(true);
    await signIn("nodemailer", { email, callbackUrl: next });
  };

  const none = !providers.email && !providers.google && !providers.demo;
  return (
    <div className="flex flex-col gap-4">
      {none ? (
        <div role="alert" className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
          Giriş sağlayıcısı yapılandırılmamış (not_configured). SMTP_URL veya AUTH_GOOGLE_ID/SECRET ayarlayın.
        </div>
      ) : null}
      {providers.email ? (
        <form onSubmit={emailLogin} noValidate className="flex flex-col gap-3">
          <Field label="E-posta" htmlFor="email" error={error ?? undefined}>
            <input id="email" type="email" autoComplete="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "email-error" : undefined} />
          </Field>
          <Button type="submit" variant="primary" disabled={pending}>{pending ? "Gönderiliyor…" : "Giriş bağlantısı gönder"}</Button>
        </form>
      ) : null}
      {providers.google ? (
        <Button onClick={() => signIn("google", { callbackUrl: next })}>Google ile devam et</Button>
      ) : null}
      {!providers.email && !providers.google && providers.demo ? (
        <div role="status" className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
          Gerçek hesap girişi henüz yapılandırılmadı (e-posta bağlantısı için SMTP_URL veya Google OAuth gerekli). Aşağıdaki demo hesapları yalnız örnek veri içerir.
        </div>
      ) : null}
      {providers.demo ? (
        <div className="border-t border-border pt-4">
          <p className="text-sm font-medium">Demo hesapları — yalnız örnek veri</p>
          <p className="mt-0.5 text-xs text-text-secondary">Ayrı, “Örnek veri” etiketli demo çalışma alanlarını açar. Gerçek mağaza bağlanamaz, gerçek alan adı kaydedilemez ve gerçek hesap kimliği sağlamaz.</p>
          <ul className="mt-2 flex flex-col gap-2">
            {DEMO_USERS.map(([e, label]) => (
              <li key={e}>
                <Button className="w-full justify-between" onClick={() => signIn("demo", { email: e, callbackUrl: next })}>
                  <span>{label}</span>
                  <span className="text-xs text-muted">{e}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
