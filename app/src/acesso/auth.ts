import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { aceitarConviteDoCookie } from "@/convites/cookie";
import { verificarCodigo } from "./codigo-email";
import { decidirEntrada, lerAdminEmails } from "./entrada";
import { entrarComSenha, origemDoPedido } from "./senha";

/** Entrar com Google: precisa das credenciais do Google e do segredo. */
export const loginGoogleConfigurado = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.AUTH_SECRET);
/** Entrar com código por e-mail: precisa do segredo e de um jeito de enviar e-mail. */
export const loginCodigoConfigurado = Boolean(process.env.AUTH_SECRET && correioDoAmbiente());
/** Entrar com usuário (ou e-mail) e senha (M6.8): só precisa do segredo. */
export const loginSenhaConfigurado = Boolean(process.env.AUTH_SECRET);
export const loginConfigurado = loginGoogleConfigurado || loginCodigoConfigurado || loginSenhaConfigurado;

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
    // Usuário (ou e-mail) e senha (M6.8): só precisa do segredo; quem não tem senha cadastrada não entra por aqui.
    Credentials({
      id: "senha",
      name: "Usuário e senha",
      credentials: { login: {}, senha: {} },
      async authorize(c, pedido) {
        if (!process.env.AUTH_SECRET || typeof c?.login !== "string" || typeof c?.senha !== "string") return null;
        const r = await entrarComSenha(getDb(), c.login, c.senha, new Date(), origemDoPedido(pedido?.headers));
        return r.ok ? { id: r.usuarioId, conferidaEm: r.conferidaEm } : null;
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/entrar", error: "/entrar" },
  trustHost: true,
  callbacks: {
    async signIn({ account, profile, user }) {
      // Código por e-mail ou senha: o authorize já conferiu e achou o usuário ativo.
      if (account?.provider === "codigo" || account?.provider === "senha") return Boolean(user?.id);
      const email = emailVerificado(profile);
      if (!email) return "/entrar?erro=email-nao-verificado";
      const id = await entrarOuAceitarConvite(getDb(), email);
      return id ? true : "/entrar?erro=nao-cadastrado";
    },
    async jwt({ token, profile, account, user }) {
      // Hora do login (fica no token enquanto a sessão durar): acesso mudado depois derruba a sessão. Na senha, é a hora
      // da conferência: uma entrada com a senha antiga que termina durante a troca pela empresa cai junto.
      if (account) token.desde = account.provider === "senha" && typeof user?.conferidaEm === "number" ? user.conferidaEm : Date.now();
      if (account?.provider === "codigo" || account?.provider === "senha") {
        token.uid = user?.id;
      } else if (profile) {
        const email = emailVerificado(profile);
        token.uid = email ? ((await decidirEntrada(getDb(), email, configEntrada())) ?? undefined) : undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      if (typeof token.desde === "number") session.desde = token.desde;
      return session;
    },
  },
});

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    desde?: number;
  }
}

declare module "next-auth" {
  interface Session {
    desde?: number;
  }
  interface User {
    conferidaEm?: number;
  }
}
