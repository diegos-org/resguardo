import { signIn, loginConfigurado } from "@/acesso/auth";

const MENSAGENS: Record<string, string> = {
  "nao-cadastrado": "Este e-mail não tem acesso. Peça a um administrador para cadastrá-lo.",
  "email-nao-verificado": "O Google não confirmou este e-mail. Use uma conta com e-mail verificado.",
  "sem-acesso": "Sua conta não tem acesso ao painel interno.",
};

export default async function Entrar({ searchParams }: PageProps<"/entrar">) {
  const { erro } = await searchParams;
  const mensagem = typeof erro === "string" ? (MENSAGENS[erro] ?? "Não foi possível entrar. Tente novamente.") : null;

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
      {loginConfigurado ? (
        <form action={entrarComGoogle}>
          <button
            type="submit"
            style={{ width: "100%", padding: "12px 16px", fontSize: "1rem", borderRadius: 6, border: "1px solid #d8d0c0", background: "#fff", cursor: "pointer" }}
          >
            Entrar com Google
          </button>
        </form>
      ) : (
        <p style={{ color: "var(--scl-texto-2)" }}>
          O login ainda não foi configurado neste ambiente (faltam as credenciais do Google).
        </p>
      )}
    </main>
  );
}
