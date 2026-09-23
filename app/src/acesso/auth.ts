import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getDb } from "@/db/client";
import { decidirEntrada, lerAdminEmails } from "./entrada";

/** Login está configurado quando as credenciais do Google existem no ambiente. */
export const loginConfigurado = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.AUTH_SECRET);

const configEntrada = () => ({
  adminEmails: lerAdminEmails(process.env.ADMIN_EMAILS),
  nomeOrganizacao: "Sua Casa Leblon",
});

function emailVerificado(profile: unknown): string | null {
  const p = profile as { email?: unknown; email_verified?: unknown } | undefined;
  return p && typeof p.email === "string" && p.email_verified === true ? p.email : null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/entrar", error: "/entrar" },
  trustHost: true,
  callbacks: {
    async signIn({ profile }) {
      const email = emailVerificado(profile);
      if (!email) return "/entrar?erro=email-nao-verificado";
      const id = await decidirEntrada(getDb(), email, configEntrada());
      return id ? true : "/entrar?erro=nao-cadastrado";
    },
    async jwt({ token, profile }) {
      if (profile) {
        const email = emailVerificado(profile);
        token.uid = email ? ((await decidirEntrada(getDb(), email, configEntrada())) ?? undefined) : undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
  }
}
