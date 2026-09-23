import Link from "next/link";
import { loginCodigoConfigurado, loginConfigurado, loginGoogleConfigurado, signIn } from "@/acesso/auth";
import { entrarComCodigo, pedirCodigoAcao } from "@/acesso/entrar-acoes";

const MENSAGENS: Record<string, string> = {
  "nao-cadastrado": "Este e-mail não tem acesso. Peça a um administrador para cadastrá-lo.",
  "email-nao-verificado": "O Google não confirmou este e-mail. Use uma conta com e-mail verificado.",
  "sem-acesso": "Sua conta não tem acesso ao painel interno.",
  "email-vazio": "Informe seu e-mail.",
  limite: "Muitos pedidos de código para este e-mail. Espere um pouco e tente de novo.",
  envio: "Não conseguimos enviar o e-mail agora. Tente de novo em instantes.",
  codigo: "Código incorreto ou vencido. Confira o e-mail mais recente ou peça um novo código.",
};

const campo = { width: "100%", padding: "12px 14px", fontSize: "1rem", borderRadius: 6, border: "1px solid #d8d0c0", boxSizing: "border-box" as const };
const botaoPrincipal = { width: "100%", padding: "12px 16px", fontSize: "1rem", borderRadius: 6, border: 0, background: "var(--scl-salvia)", color: "#fff", cursor: "pointer" };
const botaoSecundario = { ...botaoPrincipal, border: "1px solid #d8d0c0", background: "#fff", color: "var(--scl-texto)" };

export default async function Entrar({ searchParams }: PageProps<"/entrar">) {
  const { erro, etapa, email } = await searchParams;
  const mensagem = typeof erro === "string" ? (MENSAGENS[erro] ?? "Não foi possível entrar. Tente novamente.") : null;
  const emailInformado = typeof email === "string" ? email : "";
  const digitarCodigo = etapa === "codigo" && emailInformado && loginCodigoConfigurado;

  async function entrarComGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/painel" });
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "80px 16px" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: 8 }}>Sua Casa Leblon</h1>
      <p style={{ color: "var(--scl-texto-2)", marginBottom: 32 }}>Entre para acessar o painel.</p>
      {mensagem && (
        <p role="alert" style={{ background: "#fbeaea", color: "#7a2020", padding: 12, borderRadius: 6, marginBottom: 20 }}>
          {mensagem}
        </p>
      )}
      {!loginConfigurado && <p style={{ color: "var(--scl-texto-2)" }}>O login ainda não foi configurado neste ambiente.</p>}

      {digitarCodigo ? (
        <form action={entrarComCodigo} style={{ display: "grid", gap: 12 }} aria-label="Digitar código">
          <p style={{ margin: 0 }}>
            Se <strong>{emailInformado}</strong> tiver acesso, enviamos um código de 6 dígitos para ele. O código vale por 10 minutos.
          </p>
          <input type="hidden" name="email" value={emailInformado} />
          <label style={{ display: "grid", gap: 4 }}>
            Código
            <input name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus style={{ ...campo, letterSpacing: "0.3em", fontSize: "1.25rem" }} />
          </label>
          <button type="submit" style={botaoPrincipal}>
            Entrar
          </button>
          <Link href="/entrar" style={{ fontSize: "0.875rem" }}>
            Usar outro e-mail ou pedir novo código
          </Link>
        </form>
      ) : (
        <div style={{ display: "grid", gap: 24 }}>
          {loginCodigoConfigurado && (
            <form action={pedirCodigoAcao} style={{ display: "grid", gap: 12 }} aria-label="Receber código por e-mail">
              <label style={{ display: "grid", gap: 4 }}>
                Seu e-mail
                <input type="email" name="email" autoComplete="email" required defaultValue={emailInformado} style={campo} />
              </label>
              <button type="submit" style={botaoPrincipal}>
                Receber código por e-mail
              </button>
            </form>
          )}
          {loginGoogleConfigurado && (
            <form action={entrarComGoogle}>
              <button type="submit" style={botaoSecundario}>
                Entrar com Google
              </button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
