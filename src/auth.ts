import NextAuth, { type NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import Resend from "next-auth/providers/resend";
import { getEmailAdapter, normalizeFrom } from "@/adapters/email";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { log } from "@/lib/observability/log";
import { APP_NAME, defaultEmailFrom } from "@/lib/brand";

/**
 * Auth.js: e-posta bağlantısı + Google OAuth. Kendi parola kripto sistemi yok.
 * Demo girişi yalnız DEMO_MODE ve production dışı ortamda, seed'deki demo kullanıcılar için.
 */
const cfg = config();

const providers: Provider[] = [];
/** Giriş bağlantısı e-postası (Türkçe); gönderim ortak e-posta adapter'ı ile (Resend veya SMTP). */
async function sendLoginLink({ identifier, url }: { identifier: string; url: string }) {
  const host = new URL(url).host;
  try {
    await getEmailAdapter().send({
    to: identifier,
    subject: `${APP_NAME} giriş bağlantınız`,
    text: `${APP_NAME} hesabınıza giriş yapmak için bağlantı (15 dakika geçerli):\n${url}\n\nBu isteği siz yapmadıysanız e-postayı yok sayın. (${host})`,
    html: `<p>${APP_NAME} hesabınıza giriş yapmak için aşağıdaki bağlantıyı kullanın (15 dakika geçerli):</p><p><a href="${url}">Giriş yap</a></p><p style="color:#596057;font-size:13px">Bu isteği siz yapmadıysanız e-postayı yok sayın.</p>`,
    });
  } catch (e) {
    // Auth.js istemciye yalnız "Configuration" döner; gerçek sebep (gizli bilgi olmadan) burada loglanır.
    log.error("[auth] email.send_failed", { error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

// E-posta ile giriş: EMAIL_PROVIDER=resend + RESEND_API_KEY veya SMTP_URL. Sağlayıcı kimliği her iki durumda "email".
const resendLogin = cfg.EMAIL_PROVIDER === "resend" && Boolean(cfg.RESEND_API_KEY);
if (resendLogin) {
  providers.push(Resend({ id: "email", apiKey: cfg.RESEND_API_KEY, from: normalizeFrom(cfg.EMAIL_FROM) ?? defaultEmailFrom, maxAge: 15 * 60, sendVerificationRequest: sendLoginLink }));
} else if (cfg.SMTP_URL) {
  providers.push(Nodemailer({ id: "email", server: cfg.SMTP_URL, from: normalizeFrom(cfg.EMAIL_FROM) ?? defaultEmailFrom, maxAge: 15 * 60, sendVerificationRequest: sendLoginLink }));
}
if (cfg.AUTH_GOOGLE_ID && cfg.AUTH_GOOGLE_SECRET) {
  providers.push(Google({ clientId: cfg.AUTH_GOOGLE_ID, clientSecret: cfg.AUTH_GOOGLE_SECRET }));
}
// Production build'de (next start / E2E) yalnız açık DEMO_LOGIN=true ile; canlı anahtarlarla birlikte DEMO_MODE zaten reddedilir.
export const demoLoginEnabled = cfg.DEMO_MODE && (cfg.NODE_ENV !== "production" || process.env.DEMO_LOGIN === "true");
if (demoLoginEnabled) {
  providers.push(
    Credentials({
      id: "demo",
      name: "Demo hesabı",
      credentials: { email: { label: "E-posta", type: "email" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "").toLowerCase();
        if (!email.endsWith("@demo.example")) return null;
        try {
          const user = await db.user.findUnique({ where: { email } });
          if (!user) log.warn("auth.demo_user_missing", { hint: "Demo seed çalıştırılmamış olabilir" });
          return user ? { id: user.id, email: user.email, name: user.name } : null;
        } catch (e) {
          // Genellikle DATABASE_URL / tablo eksikliği; Vercel Runtime Logs'ta görünür.
          log.error("auth.demo_db_error", { error: e });
          throw e;
        }
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  // Üretilen Prisma client tipi adapter'ın beklediği ile yapısal olarak uyumlu.
  adapter: PrismaAdapter(db as never),
  providers,
  secret: cfg.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 7 * 24 * 3600 },
  pages: { signIn: "/login", verifyRequest: "/verify", error: "/login" },
  trustHost: true,
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) session.user.id = String(token.uid);
      return session;
    },
    // Yalnız uygulama içi (aynı origin) yönlendirme; açık redirect yok.
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        /* geçersiz */
      }
      return baseUrl;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export const authProviders = {
  email: resendLogin || Boolean(cfg.SMTP_URL),
  google: Boolean(cfg.AUTH_GOOGLE_ID && cfg.AUTH_GOOGLE_SECRET),
  demo: demoLoginEnabled,
};
