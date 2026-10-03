import nodemailer from "nodemailer";
import { config } from "@/lib/config";
import { log } from "@/lib/observability/log";
import { defaultEmailFrom } from "@/lib/brand";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailAdapter {
  status(): "ready" | "not_configured";
  send(msg: EmailMessage): Promise<void>;
}

/** Vercel paneline tırnaklı girilen değerleri ("Ad <a@b.com>") temizler. */
export function normalizeFrom(value: string | undefined): string | undefined {
  const v = value?.trim().replace(/^["']+|["']+$/g, "").trim();
  return v ? v : undefined;
}

/** Resend hata gövdesini okunur, gizli bilgi içermeyen bir mesaja çevirir (Vercel Logs'ta "[auth]" satırında görünür). */
export async function resendErrorMessage(res: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string; name?: string };
    detail = [body.name, body.message].filter(Boolean).join(": ");
  } catch {
    /* gövde yok */
  }
  const hint =
    res.status === 401 || /api key/i.test(detail)
      ? "RESEND_API_KEY geçersiz"
      : res.status === 403 || /verif|testing emails|own email/i.test(detail)
        ? "EMAIL_FROM alan adı Resend'de doğrulanmamış; doğrulanana kadar yalnız Resend hesabınızın e-posta adresine gönderim yapılabilir"
        : res.status === 422 || /from/i.test(detail)
          ? "EMAIL_FROM biçimi geçersiz (örn. Callypso <no-reply@alanadiniz.com>)"
          : res.status === 429
            ? "Resend gönderim limiti aşıldı"
            : "Resend isteği başarısız";
  return `E-posta gönderilemedi (Resend ${res.status}): ${hint}${detail ? ` — ${detail.slice(0, 200)}` : ""}`;
}

/** SMTP (Mailpit localde) veya Resend. Yapılandırılmamışsa açık not_configured. */
export function getEmailAdapter(): EmailAdapter {
  const cfg = config();
  const from = normalizeFrom(cfg.EMAIL_FROM) ?? defaultEmailFrom;
  if (cfg.EMAIL_PROVIDER === "resend" && cfg.RESEND_API_KEY) {
    return {
      status: () => "ready",
      async send(msg) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${cfg.RESEND_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
        });
        if (!res.ok) throw new Error(await resendErrorMessage(res));
      },
    };
  }
  if (cfg.SMTP_URL) {
    const transport = nodemailer.createTransport(cfg.SMTP_URL);
    return {
      status: () => "ready",
      async send(msg) {
        await transport.sendMail({ from, ...msg });
      },
    };
  }
  return {
    status: () => "not_configured",
    async send(msg) {
      log.warn("email.not_configured", { subject: msg.subject });
      throw new Error("E-posta sağlayıcısı yapılandırılmamış");
    },
  };
}
