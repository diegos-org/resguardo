import { redirect } from "next/navigation";
import { signOut } from "@/acesso/auth";
import { obterSessao } from "@/acesso/sessao-atual";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { getDb } from "@/db/client";
import { marcarFeitaAcao } from "@/equipe/acoes";
import { limpezasDaProfissional } from "@/equipe/equipe";
import { lerConfigAgenda } from "@/agenda/agenda";
import { hojeISO } from "@/lib/datas";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dia = (d: string) => `${DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.split("-").reverse().slice(0, 2).join("/")}`;

/**
 * Tela da profissional de limpeza pelo celular (M6.6): as limpezas dela e o botão "Feita". Sem custo,
 * sem proprietário, sem financeiro.
 */
export default async function Equipe({ searchParams }: PageProps<"/equipe">) {
  const sessao = await obterSessao();
  if (!sessao) redirect("/entrar");
  if (sessao.papel === "proprietario") redirect("/portal");
  if (sessao.papel !== "limpeza" || !sessao.profissionalId) redirect("/painel");
  const params = await searchParams;
  const hoje = hojeISO();
  const db = getDb();
  const [lista, config] = await Promise.all([limpezasDaProfissional(db, sessao.organizacaoId, sessao.profissionalId, hoje), lerConfigAgenda(db, sessao.organizacaoId)]);
  const erro = typeof params.erro === "string" ? params.erro : undefined;

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/entrar" });
  }

  const cartao = { border: "1px solid #d8d0c0", borderRadius: 10, padding: 14, background: "#fff", display: "flex", flexDirection: "column" as const, gap: 6 };
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 48px", display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Minhas limpezas</h1>
        <form action={sair}>
          <button type="submit" style={{ font: "inherit", padding: "6px 14px", borderRadius: 6, border: "1px solid #d8d0c0", background: "#fff" }}>
            Sair
          </button>
        </form>
      </header>
      {params.salvo === "1" && <p role="status">Marcada como feita. Obrigado!</p>}
      {erro && <p role="alert">{erro}</p>}
      {lista.length === 0 && <p>Nenhuma limpeza marcada para você nos próximos dias.</p>}
      {lista.map((l) => {
        const feita = l.estado === "realizada";
        const podeMarcar = !feita && l.data <= hoje;
        return (
          <section key={l.id} style={{ ...cartao, opacity: feita ? 0.7 : 1 }} aria-label={`Limpeza ${l.imovelCodigo} ${dia(l.data)}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <strong style={{ fontSize: "1.125rem" }}>
                {dia(l.data)}
                {l.data === hoje ? " (hoje)" : ""}
              </strong>
              <span>{feita ? "Feita ✓" : l.estado === "confirmada" ? "Confirmada" : "Pedida"}</span>
            </div>
            <div>
              {l.imovelCodigo} · {l.imovelNome}
            </div>
            {l.endereco && <div style={{ color: "#555", fontSize: "0.9375rem" }}>{l.endereco}</div>}
            <div style={{ fontSize: "0.9375rem" }}>
              Saída do hóspede até {config.horaSaida}.{l.entraNoDia ? ` Entra outro hóspede no mesmo dia: deixar pronto até ${config.horaEntrada}.` : ""}
            </div>
            {l.observacao && <div style={{ fontSize: "0.9375rem", color: "#555" }}>Obs.: {l.observacao}</div>}
            {podeMarcar && (
              <form action={marcarFeitaAcao}>
                <input type="hidden" name="id" value={l.id} />
                <BotaoConfirmar pergunta={`Confirmar que a limpeza do ${l.imovelCodigo} de ${dia(l.data)} foi feita?`} style={{ width: "100%", padding: "12px", fontSize: "1rem" }}>
                  Marcar como feita
                </BotaoConfirmar>
              </form>
            )}
          </section>
        );
      })}
    </main>
  );
}
