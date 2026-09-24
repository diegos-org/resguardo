import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { signOut } from "@/acesso/auth";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { imoveis } from "@/db/schema";
import { nomeDaEmpresa } from "@/configuracoes/empresa";

/** Porta de entrada do proprietário. O portal completo (relatórios, saldos, PDF) é o M5. */
export default async function Portal() {
  const sessao = await obterSessao();
  if (!sessao) redirect("/entrar");
  if (sessao.papel !== "proprietario") redirect("/painel");
  const meus = sessao.imovelIds.length
    ? await getDb().select({ codigo: imoveis.codigo, nome: imoveis.nome }).from(imoveis).where(inArray(imoveis.id, sessao.imovelIds))
    : [];
  const empresa = await nomeDaEmpresa(getDb(), sessao.organizacaoId);
  async function sair() {
    "use server";
    await signOut({ redirectTo: "/entrar" });
  }
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 16px" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: 8 }}>Portal do proprietário</h1>
      <p style={{ color: "var(--scl-texto-2)", marginBottom: 24 }}>Seu acesso está ativo. Os relatórios mensais e o saldo vão aparecer aqui em breve.</p>
      <h2 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Seus imóveis</h2>
      {meus.length ? (
        <ul>
          {meus.map((i) => (
            <li key={i.codigo}>
              {i.codigo} · {i.nome}
            </li>
          ))}
        </ul>
      ) : (
        <p>Nenhum imóvel ligado ao seu cadastro ainda. Fale com a {empresa}.</p>
      )}
      <form action={sair} style={{ marginTop: 32 }}>
        <button type="submit" style={{ font: "inherit", padding: "6px 14px", borderRadius: 6, border: "1px solid #d8d0c0", background: "#fff", cursor: "pointer" }}>
          Sair
        </button>
      </form>
    </main>
  );
}
