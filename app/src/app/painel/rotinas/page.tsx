import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { FREQUENCIAS_ROTINA } from "@/db/schema";
import { hojeISO } from "@/lib/datas";
import { arquivarAcao, criarAcao, editarAcao, execucaoAcao } from "@/rotinas/acoes";
import { garantirRotinasIniciais, type LinhaRotina, listarRotinas, NOMES_FREQUENCIA, type SituacaoRotina } from "@/rotinas/rotinas";

const dataBr = (d: string) => d.split("-").reverse().join("/");
const SITUACAO: Record<SituacaoRotina, [string, string]> = {
  atrasada: ["Atrasada", "#b3261e"],
  hoje: ["Vence hoje", "#8a6d1c"],
  esta_semana: ["Esta semana", "#2f5d8a"],
  em_dia: ["Em dia", "#2e6b3f"],
  arquivada: ["Arquivada", "#777"],
};

function Campos({ r, hoje }: { r?: LinhaRotina; hoje: string }) {
  return (
    <div className={styles.linha}>
      <label className={styles.largo}>
        Nome
        <input name="titulo" required maxLength={120} defaultValue={r?.titulo} placeholder="ex.: Conferência das faxinas" />
      </label>
      <label>
        Frequência
        <select name="frequencia" defaultValue={r?.frequencia ?? "semanal"}>
          {FREQUENCIAS_ROTINA.map((f) => (
            <option key={f} value={f}>
              {NOMES_FREQUENCIA[f]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Próxima data
        <input type="date" name="proximaData" required defaultValue={r?.proximaData ?? hoje} />
      </label>
      <label className={styles.largo}>
        O que fazer
        <input name="descricao" maxLength={1000} defaultValue={r?.descricao} />
      </label>
    </div>
  );
}

function Cartao({ r, hoje, registrar, configurar }: { r: LinhaRotina; hoje: string; registrar: boolean; configurar: boolean }) {
  const [rotulo, cor] = SITUACAO[r.situacao];
  return (
    <section className={styles.form} aria-label={`Rotina ${r.titulo}`} style={{ gap: 8 }}>
      <div className={styles.linha} style={{ alignItems: "baseline", justifyContent: "space-between" }}>
        <strong>{r.titulo}</strong>
        <span className={styles.etiqueta} style={{ color: cor }}>
          {rotulo} · {NOMES_FREQUENCIA[r.frequencia]} · {r.ativa ? `vence ${dataBr(r.proximaData)}` : "arquivada"}
        </span>
      </div>
      {r.descricao && <p style={{ margin: 0, fontSize: "0.9375rem" }}>{r.descricao}</p>}
      {r.ultimas.length > 0 && (
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>
          Últimas:{" "}
          {r.ultimas
            .map((e) => `${dataBr(e.prevista)} ${e.pulada ? "pulada" : `feita em ${dataBr(e.feitaEm)}`}${e.observacao ? ` (${e.observacao})` : ""}`)
            .join(" · ")}
        </p>
      )}
      {registrar && r.ativa && (
        <form action={execucaoAcao} className={styles.linha} style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="prevista" value={r.proximaData} />
          <label style={{ flex: "0 1 170px" }}>
            Feita em
            <input type="date" name="feitaEm" defaultValue={hoje} max={hoje} required />
          </label>
          <label className={styles.largo}>
            Observação (obrigatória para pular)
            <input name="observacao" maxLength={500} />
          </label>
          <div className={styles.acoes}>
            <button type="submit">Marcar como feita</button>
            <button type="submit" name="pulada" value="sim" style={{ background: "#fff", color: "var(--scl-salvia)", border: "1px solid currentColor" }}>
              Pular desta vez
            </button>
          </div>
        </form>
      )}
      {configurar && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>Editar ou arquivar</summary>
          <form action={editarAcao} className={styles.form} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={r.id} />
            <Campos r={r} hoje={hoje} />
            <div className={styles.acoes}>
              <button type="submit">Salvar</button>
            </div>
          </form>
          <form action={arquivarAcao} className={styles.acoes} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="ativa" value={r.ativa ? "nao" : "sim"} />
            {r.ativa ? (
              <BotaoConfirmar pergunta="Arquivar esta rotina? Ela sai das pendências; o histórico fica." style={{ background: "#b3261e" }}>
                Arquivar
              </BotaoConfirmar>
            ) : (
              <button type="submit">Reativar</button>
            )}
          </form>
        </details>
      )}
    </section>
  );
}

export default async function Rotinas({ searchParams }: PageProps<"/painel/rotinas">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "rotina:ler")) redirect("/painel");
  const params = await searchParams;
  const db = getDb();
  const hoje = hojeISO();
  const configurar = podeFazer(sessao.papel, "configuracao:editar");
  const registrar = podeFazer(sessao.papel, "rotina:editar");
  // As rotinas que já existiam na operação nascem na primeira vez (editáveis; arquivadas não voltam).
  if (configurar) await garantirRotinasIniciais(db, sessao.organizacaoId, hoje);
  const arquivadas = params.arquivadas === "1";
  const lista = await listarRotinas(db, sessao.organizacaoId, hoje, { incluirArquivadas: arquivadas && configurar });
  const atrasadas = lista.filter((r) => r.situacao === "atrasada").length;
  const salvo = params.salvo === "1";
  const erro = typeof params.erro === "string" ? params.erro : undefined;

  return (
    <>
      <h1>Rotinas</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Tarefas que se repetem. Ao marcar como feita, a próxima data vai para o vencimento seguinte depois do dia informado (quem atrasou não acumula
        várias). Nada fica “feito” sozinho: vencida e não registrada, a rotina aparece como atrasada.
      </p>
      {salvo && (
        <p role="status" className={styles.sucesso}>
          Salvo.
        </p>
      )}
      {erro && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      {atrasadas > 0 && (
        <p role="note" className={styles.alerta}>
          {atrasadas} rotina(s) atrasada(s).
        </p>
      )}
      {lista.length === 0 && <p>Nenhuma rotina{configurar ? ": cadastre abaixo." : "."}</p>}
      {lista.map((r) => (
        <Cartao key={r.id} r={r} hoje={hoje} registrar={registrar} configurar={configurar} />
      ))}
      {configurar && (
        <>
          <details>
            <summary style={{ cursor: "pointer" }}>Nova rotina</summary>
            <form action={criarAcao} className={styles.form} style={{ marginTop: 8 }}>
              <Campos hoje={hoje} />
              <div className={styles.acoes}>
                <button type="submit">Criar rotina</button>
              </div>
            </form>
          </details>
          <p style={{ margin: 0, fontSize: "0.875rem" }}>
            <a href={arquivadas ? "/painel/rotinas" : "/painel/rotinas?arquivadas=1"}>{arquivadas ? "Esconder arquivadas" : "Mostrar arquivadas"}</a>
          </p>
        </>
      )}
    </>
  );
}
