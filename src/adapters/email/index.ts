import nodemailer from "nodemailer";
import { config } from "@/lib/config";
import { log } from "@/lib/observability/log";

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

/** SMTP (Mailpit localde) veya Resend. Yapılandırılmamışsa açık not_configured. */
export function getEmailAdapter(): EmailAdapter {
  const cfg = config();
  const from = cfg.EMAIL_FROM ?? "GEO Commerce <no-reply@localhost>";
  if (cfg.EMAIL_PROVIDER === "resend" && cfg.RESEND_API_KEY) {
    return {
      status: () => "ready",
      async send(msg) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${cfg.RESEND_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
        });
        if (!res.ok) throw new Error(`E-posta gönderilemedi (${res.status})`);
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
