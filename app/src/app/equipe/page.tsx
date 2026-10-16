import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import { signOut } from "@/acesso/auth";
import { obterSessao } from "@/acesso/sessao-atual";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { MolduraPortal } from "@/components/portal/MolduraPortal";
import styles from "@/components/portal/portal.module.css";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { getDb } from "@/db/client";
import { MinhaSenha } from "@/components/equipe/MinhaSenha";
import { agendaDaProfissional, situacaoDaSenha } from "@/equipe/acesso";
import { marcarFeitaAcao, trocarMinhaSenhaAcao } from "@/equipe/acoes";
import { limpezasDaProfissional, textoDosHorarios } from "@/equipe/equipe";
import { FRASE_FINAL } from "@/agenda/agenda";
import { hojeISO } from "@/lib/datas";
import { metadadosDeAcesso } from "@/site/site";

/** A sessão e o nome da empresa dela, lidos uma vez por requisição: o título da aba e a moldura usam os mesmos. */
const sessaoDaTela = cache(obterSessao);
const empresaDaTela = cache((organizacaoId: string) => nomeDaEmpresa(getDb(), organizacaoId));

/**
 * Título e descrição da própria tela (M7.10), não os do painel interno; fora dos buscadores pelo next.config. O nome é o
 * da empresa de quem entrou, o mesmo da moldura; sem sessão de limpeza (a tela vai redirecionar), só o nome da tela.
 */
export async function generateMetadata(): Promise<Metadata> {
  const sessao = await sessaoDaTela();
  const nomeEmpresa = sessao?.papel === "limpeza" && sessao.profissionalId ? await empresaDaTela(sessao.organizacaoId) : "";
  return metadadosDeAcesso({ nomeEmpresa }, "Minhas limpezas", "Equipe de limpeza: as limpezas marcadas para você e a agenda da equipe.");
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dia = (d: string) => `${DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.split("-").reverse().slice(0, 2).join("/")}`;

/**
 * Tela da profissional de limpeza pelo celular (M6.6): as limpezas dela e o botão "Feita"; desde o M6.8, também a agenda
 * das cidades escolhidas para ela (só essas) e a senha dela. Sem custo, sem proprietário, sem financeiro.
 */
export default async function Equipe({ searchParams }: PageProps<"/equipe">) {
  const sessao = await sessaoDaTela();
  if (!sessao) redirect("/entrar");
  if (sessao.papel === "proprietario") redirect("/portal");
  if (sessao.papel !== "limpeza" || !sessao.profissionalId) redirect("/painel");
  const params = await searchParams;
  const hoje = hojeISO();
  const db = getDb();
  const [lista, empresa, agenda, senha] = await Promise.all([
    limpezasDaProfissional(db, sessao.organizacaoId, sessao.profissionalId, hoje),
    empresaDaTela(sessao.organizacaoId),
    agendaDaProfissional(db, sessao.organizacaoId, sessao.profissionalId, hojeISO("America/Sao_Paulo")),
    situacaoDaSenha(db, sessao.usuarioId),
  ]);
  const erro = typeof params.erro === "string" ? params.erro : undefined;

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/entrar" });
  }

  return (
    <MolduraPortal empresa={empresa} titulo="Equipe de limpeza" sair={sair}>
      <header className={styles.cabecalho}>
        <div>
          <p className={styles.olho}>Equipe de limpeza</p>
          <h1>Minhas limpezas</h1>
        </div>
      </header>
      {params.salvo === "1" && (
        <p role="status" className={styles.sucesso}>
          Marcada como feita. Obrigado!
        </p>
      )}
      {erro && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      {lista.length === 0 && <p>Nenhuma limpeza marcada para você nos próximos dias.</p>}
      {lista.map((l) => {
        const feita = l.estado === "realizada";
        const podeMarcar = !feita && l.data <= hoje;
        return (
          <section key={l.id} className={styles.cartaoLimpeza} style={{ opacity: feita ? 0.7 : 1 }} aria-label={`Limpeza ${l.imovelCodigo} ${dia(l.data)}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <strong>
                {dia(l.data)}
                {l.data === hoje ? " (hoje)" : ""}
              </strong>
              <span>{feita ? "Feita ✓" : l.estado === "confirmada" ? "Confirmada" : "Pedida"}</span>
            </div>
            <div>
              {l.imovelCodigo} · {l.imovelNome}
            </div>
            {l.endereco && <div className={styles.rotulo}>{l.endereco}</div>}
            <div style={{ fontSize: "0.9375rem" }}>
              {textoDosHorarios(l)}
            </div>
            {l.observacao && <div className={styles.rotulo}>Obs.: {l.observacao}</div>}
            {podeMarcar && (
              <form action={marcarFeitaAcao}>
                <input type="hidden" name="id" value={l.id} />
                <BotaoConfirmar pergunta={`Confirmar que a limpeza do ${l.imovelCodigo} de ${dia(l.data)} foi feita?`} className={`${styles.botao} ${styles.botaoLargo}`}>
                  Marcar como feita
                </BotaoConfirmar>
              </form>
            )}
          </section>
        );
      })}

      <section aria-label="Agenda da equipe" style={{ display: "grid", gap: 12, marginTop: 24 }}>
        <h2>Agenda da equipe</h2>
        {!agenda.cidades.length ? (
          <p className={styles.miudo}>A empresa ainda não escolheu de qual cidade é a sua agenda. Peça para liberar.</p>
        ) : !agenda.secoes.length ? (
          <p className={styles.miudo}>Nenhum imóvel ativo em {agenda.cidades.join(", ")} agora.</p>
        ) : (
          agenda.secoes.map((s) => (
            <div key={s.cidade} className={styles.caixa}>
              <h3 style={{ marginTop: 0 }}>{s.cidade}</h3>
              <div style={{ whiteSpace: "pre-wrap", fontSize: "0.9375rem", lineHeight: 1.5 }}>{s.linhas.join("\n")}</div>
            </div>
          ))
        )}
        {agenda.secoes.length > 0 && <p className={styles.miudo}>{FRASE_FINAL}</p>}
      </section>

      <MinhaSenha temSenha={senha.temSenha} provisoria={senha.provisoria} trocar={trocarMinhaSenhaAcao} />
    </MolduraPortal>
  );
}
