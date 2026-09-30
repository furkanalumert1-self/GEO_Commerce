import NextAuth, { type NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { config } from "@/lib/config";

/**
 * Auth.js: e-posta bağlantısı + Google OAuth. Kendi parola kripto sistemi yok.
 * Demo girişi yalnız DEMO_MODE ve production dışı ortamda, seed'deki demo kullanıcılar için.
 */
const cfg = config();

const providers: Provider[] = [];
if (cfg.SMTP_URL) {
  providers.push(Nodemailer({ server: cfg.SMTP_URL, from: cfg.EMAIL_FROM ?? "GEO Commerce <no-reply@localhost>", maxAge: 15 * 60 }));
}
if (cfg.AUTH_GOOGLE_ID && cfg.AUTH_GOOGLE_SECRET) {
  providers.push(Google({ clientId: cfg.AUTH_GOOGLE_ID, clientSecret: cfg.AUTH_GOOGLE_SECRET }));
}
export const demoLoginEnabled = cfg.DEMO_MODE && cfg.NODE_ENV !== "production";
if (demoLoginEnabled) {
  providers.push(
    Credentials({
      id: "demo",
      name: "Demo hesabı",
      credentials: { email: { label: "E-posta", type: "email" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "").toLowerCase();
        if (!email.endsWith("@demo.example")) return null;
        const user = await db.user.findUnique({ where: { email } });
        return user ? { id: user.id, email: user.email, name: user.name } : null;
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
  email: Boolean(cfg.SMTP_URL),
  google: Boolean(cfg.AUTH_GOOGLE_ID && cfg.AUTH_GOOGLE_SECRET),
  demo: demoLoginEnabled,
};
