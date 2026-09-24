import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { aceitarConviteDoCookie } from "@/convites/cookie";
import { verificarCodigo } from "./codigo-email";
import { decidirEntrada, lerAdminEmails } from "./entrada";

/** Entrar com Google: precisa das credenciais do Google e do segredo. */
export const loginGoogleConfigurado = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.AUTH_SECRET);
/** Entrar com código por e-mail: precisa do segredo e de um jeito de enviar e-mail. */
export const loginCodigoConfigurado = Boolean(process.env.AUTH_SECRET && correioDoAmbiente());
export const loginConfigurado = loginGoogleConfigurado || loginCodigoConfigurado;

const configEntrada = () => ({
  adminEmails: lerAdminEmails(process.env.ADMIN_EMAILS),
  nomeOrganizacao: "Sua Casa Leblon",
});

/**
 * E-mail já verificado → id do usuário. Se a pessoa veio de um link de convite (M1.4),
 * aceita o convite (cria o acesso de proprietário ou liga a mais um proprietário).
 */
async function entrarOuAceitarConvite(db: ReturnType<typeof getDb>, email: string): Promise<string | null> {
  const id = await decidirEntrada(db, email, configEntrada());
  const aceito = await aceitarConviteDoCookie(db, email);
  return id ?? aceito;
}

function emailVerificado(profile: unknown): string | null {
  const p = profile as { email?: unknown; email_verified?: unknown } | undefined;
  return p && typeof p.email === "string" && p.email_verified === true ? p.email : null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    ...(loginGoogleConfigurado ? [Google] : []),
    Credentials({
      id: "codigo",
      name: "Código por e-mail",
      credentials: { email: {}, codigo: {} },
      async authorize(c) {
        if (!loginCodigoConfigurado || typeof c?.email !== "string" || typeof c?.codigo !== "string") return null;
        const db = getDb();
        const r = await verificarCodigo(db, c.email, c.codigo, { segredo: process.env.AUTH_SECRET! });
        if (!r.ok) return null;
        return entrarOuAceitarConvite(db, r.email).then((id) => (id ? { id, email: r.email } : null));
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/entrar", error: "/entrar" },
  trustHost: true,
  callbacks: {
    async signIn({ account, profile, user }) {
      // Código por e-mail: o authorize já conferiu o código e o acesso.
      if (account?.provider === "codigo") return Boolean(user?.id);
      const email = emailVerificado(profile);
      if (!email) return "/entrar?erro=email-nao-verificado";
      const id = await entrarOuAceitarConvite(getDb(), email);
      return id ? true : "/entrar?erro=nao-cadastrado";
    },
    async jwt({ token, profile, account, user }) {
      if (account?.provider === "codigo") {
        token.uid = user?.id;
      } else if (profile) {
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
