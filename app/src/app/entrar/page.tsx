import type { Metadata } from "next";
import Link from "next/link";
import { loginCodigoConfigurado, loginConfigurado, loginGoogleConfigurado, loginSenhaConfigurado, signIn } from "@/acesso/auth";
import { entrarComCodigo, entrarComSenhaAcao, pedirCodigoAcao } from "@/acesso/entrar-acoes";
import { MolduraPortal } from "@/components/portal/MolduraPortal";
import styles from "@/components/portal/portal.module.css";
import { carregarSite } from "@/site/pagina";
import { metadadosDeAcesso } from "@/site/site";

const OLHO = "Área da equipe e dos proprietários";
const CHAMADA = "Entre para acessar o painel ou o seu portal.";

/** Título e descrição da própria tela (M7.10), não os do painel interno; fora dos buscadores pelo next.config. */
export async function generateMetadata(): Promise<Metadata> {
  const { conteudo } = await carregarSite();
  return metadadosDeAcesso(conteudo, "Entrar", `${OLHO}. ${CHAMADA}`);
}

const MENSAGENS: Record<string, string> = {
  "nao-cadastrado": "Este e-mail não tem acesso. Peça a um administrador para cadastrá-lo.",
  "email-nao-verificado": "O Google não confirmou este e-mail. Use uma conta com e-mail verificado.",
  "sem-acesso": "Sua conta não tem acesso ao painel interno.",
  "email-vazio": "Informe seu e-mail.",
  codigo: "Código incorreto ou vencido. Confira o e-mail mais recente ou peça um novo código.",
  "senha-vazia": "Informe o usuário (ou e-mail) e a senha.",
  senha: "Usuário ou senha não conferem. Confira e tente de novo; se esqueceu, peça à empresa uma senha nova.",
  espere: "Muitas tentativas erradas. Espere 15 minutos e tente de novo, ou peça à empresa uma senha nova.",
  muitas: "Muitas tentativas neste momento. Espere alguns minutos e tente de novo.",
};

export default async function Entrar({ searchParams }: PageProps<"/entrar">) {
  const { erro, etapa, email, login, aviso } = await searchParams;
  const { conteudo } = await carregarSite();
  // O nome da empresa do site (Configurações → Empresa); sem site configurado, a moldura não supõe um nome.
  const empresa = conteudo?.nomeEmpresa.trim() ?? "";
  const mensagem = typeof erro === "string" ? (MENSAGENS[erro] ?? "Não foi possível entrar. Tente novamente.") : null;
  const emailInformado = typeof email === "string" ? email : "";
  const digitarCodigo = etapa === "codigo" && emailInformado && loginCodigoConfigurado;
  const loginInformado = typeof login === "string" ? login.slice(0, 200) : "";

  async function entrarComGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/painel" });
  }

  return (
    <MolduraPortal empresa={empresa} estreito>
      <header>
        <p className={styles.olho}>{OLHO}</p>
        <h1>Entrar</h1>
        <p className={styles.miudo}>{CHAMADA}</p>
      </header>
      {mensagem && (
        <p role="alert" className={styles.alerta}>
          {mensagem}
        </p>
      )}
      {aviso === "senha-trocada" && !mensagem && (
        <p role="status" className={styles.sucesso}>
          Senha trocada. Por segurança, os acessos abertos antes saíram: entre de novo com a senha nova.
        </p>
      )}
      {!loginConfigurado && <p className={styles.miudo}>O login ainda não foi configurado neste ambiente.</p>}

      {digitarCodigo ? (
        <form action={entrarComCodigo} className={styles.caixa} style={{ display: "grid", gap: 14 }} aria-label="Digitar código">
          <p style={{ margin: 0 }}>
            Se <strong>{emailInformado}</strong> tiver acesso, enviamos um código de 6 dígitos para ele. O código vale por 10 minutos. Não
            chegou em alguns minutos? Confira o spam e peça outro (até 5 por hora).
          </p>
          <input type="hidden" name="email" value={emailInformado} />
          <label className={styles.campo}>
            Código
            <input name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus style={{ letterSpacing: "0.3em", fontSize: "1.25rem" }} />
          </label>
          <button type="submit" className={`${styles.botao} ${styles.botaoLargo}`}>
            Entrar
          </button>
          <Link href="/entrar" style={{ fontSize: "0.875rem" }}>
            Usar outro e-mail ou pedir novo código
          </Link>
        </form>
      ) : (
        <div style={{ display: "grid", gap: 24 }}>
          {loginCodigoConfigurado && (
            <form action={pedirCodigoAcao} className={styles.caixa} style={{ display: "grid", gap: 14 }} aria-label="Receber código por e-mail">
              <label className={styles.campo}>
                Seu e-mail
                <input type="email" name="email" autoComplete="email" required defaultValue={emailInformado} />
              </label>
              <button type="submit" className={`${styles.botao} ${styles.botaoLargo}`}>
                Receber código por e-mail
              </button>
            </form>
          )}
          {loginGoogleConfigurado && (
            <form action={entrarComGoogle}>
              <button type="submit" className={`${styles.botao} ${styles.botaoContorno} ${styles.botaoLargo}`}>
                Entrar com Google
              </button>
            </form>
          )}
          {loginSenhaConfigurado && (
            <details className={styles.caixa} open={etapa === "senha"}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Entrar com usuário e senha</summary>
              <form action={entrarComSenhaAcao} style={{ display: "grid", gap: 14, marginTop: 14 }} aria-label="Entrar com usuário e senha">
                <label className={styles.campo}>
                  Usuário ou e-mail
                  <input name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={200} defaultValue={loginInformado} />
                </label>
                <label className={styles.campo}>
                  Senha
                  <input name="senha" type="password" autoComplete="current-password" required maxLength={128} />
                </label>
                <button type="submit" className={`${styles.botao} ${styles.botaoLargo}`}>
                  Entrar
                </button>
                <p className={styles.miudo} style={{ margin: 0 }}>
                  Para quem recebeu da empresa um usuário e uma senha, ou já criou a sua. Esqueceu? Peça à empresa uma senha nova.
                </p>
              </form>
            </details>
          )}
        </div>
      )}
    </MolduraPortal>
  );
}
