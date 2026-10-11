import type { ReactNode } from "react";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import styles from "@/components/formularios.module.css";
import { hojeISO } from "@/lib/datas";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import {
  atualizarValorSeguradoAcao,
  cancelarReservaContestadaAcao,
  conferirAvisoAcao,
  confirmarDebitoAcao,
  confirmarOutraDisputaAcao,
  confirmarResultadoAcao,
  encerrarSemEfeitoAcao,
  informarPrazoAcao,
  marcarDocumentosEnviadosAcao,
  mudarDecisaoAcao,
  previaDoCancelamentoContestadoAcao,
  registrarDecisaoAcao,
  registrarDisputaAcao,
} from "@/pagamentos/acoes-contestacao";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";
import type { ContestacaoDaEquipe, ContestacaoNaTela } from "@/pagamentos/contestacao-tela";
import { comDinheiro } from "@/pagamentos/situacoes";
import { ancoraDaLiberacao } from "./ancoras";
import { FormAcaoContestacao } from "./FormAcaoContestacao";
import { FormCancelarContestada } from "./FormCancelarContestada";
import { FormDecisaoContestacao } from "./FormDecisaoContestacao";
import { FormRegistrarContestacao } from "./FormRegistrarContestacao";
import { FormResultadoContestacao } from "./FormResultadoContestacao";

const FUSO = "America/Sao_Paulo";
const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" });
const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;
const caixa = { border: "1px dashed var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", padding: 10, display: "flex", flexDirection: "column", gap: 8 } as const;

function Linhas({ linhas }: { linhas: [string, ReactNode][] }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "4px 16px", margin: 0, fontSize: "0.875rem" }}>
      {linhas.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt style={{ color: "var(--scl-texto-2)" }}>{k}</dt>
          <dd style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Lista({ titulo, itens }: { titulo: string; itens: readonly string[] }) {
  if (!itens.length) return null;
  return (
    <div style={{ fontSize: "0.875rem" }}>
      {titulo && <strong>{titulo}</strong>}
      <ul style={{ margin: titulo ? "2px 0 0" : 0, paddingLeft: 18 }}>
        {itens.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

/** O número do caso com o botão de copiar (como os ids da linha "No Mercado Pago"): é por ele que se acha a disputa lá. */
function Caso({ id }: { id: string | null }) {
  if (!id) return <>não informado</>;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <code>{id}</code>
      <BotaoCopiar texto={id} rotulo="Copiar" className={styles.pequeno} />
    </span>
  );
}

/** "Documentos enviados no painel do Mercado Pago" (reserva:editar ou financeiro:editar), com a data. */
function FormDocumentos({ id, desde, hoje }: { id: string; desde: string; hoje: string }) {
  return (
    <FormAcaoContestacao
      acao={marcarDocumentosEnviadosAcao}
      contestacaoId={id}
      rotulo="Documentos enviados no painel do Mercado Pago"
      nome="Documentos enviados no painel do Mercado Pago"
      discreto
      pergunta="Marcar que os documentos da defesa foram enviados pelo painel do Mercado Pago em {data}? A marca fica registrada e o aviso do prazo sai do Início."
      dataNaPergunta="data"
    >
      <label style={{ flex: "0 1 180px" }}>
        Enviados em
        <input type="date" name="data" min={desde} max={hoje} defaultValue={hoje} required />
      </label>
    </FormAcaoContestacao>
  );
}

/** A caixa da nota reforçada do "Encerrar sem efeito" (a leitura de agora pode mostrar a disputa em andamento). */
function CaixaReforcadaSemEfeito() {
  return (
    <label className={styles.check} style={{ flex: "1 1 100%" }}>
      <input type="checkbox" name="notaReforcada" value="sim" /> O painel do Mercado Pago já mostra a disputa encerrada (a leitura daqui ainda não mostra o encerramento)
    </label>
  );
}

/** O bloco de uma disputa para quem lê a reserva sem o financeiro: a frase, a situação e o prazo, e as ações de documentos. */
function DisputaResumida({ d, reservaId, hoje, defesa }: { d: ContestacaoNaTela; reservaId: string; hoje: string; defesa: boolean }) {
  return (
    <section aria-label={`Disputa: ${d.cabecalho}`} style={caixa}>
      <strong>{d.cabecalho}</strong>
      <p style={{ margin: 0, fontSize: "0.875rem" }}>{d.frase}</p>
      <Linhas
        linhas={[
          ["Situação", d.situacaoTexto],
          ...(d.prazo ? ([["Documentos", d.prazo.texto]] as [string, ReactNode][]) : []),
          ...(d.idCaso ? ([["Número do caso", <Caso key="caso" id={d.idCaso} />]] as [string, ReactNode][]) : []),
        ]}
      />
      {defesa && <DefesaLink reservaId={reservaId} />}
      {d.podeMarcarDocumentos && <FormDocumentos id={d.id} desde={d.desde} hoje={hoje} />}
    </section>
  );
}

function DefesaLink({ reservaId }: { reservaId: string }) {
  return (
    <a href={`/painel/reservas/${reservaId}/defesa`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem" }}>
      Documentos para a defesa (página para imprimir)
    </a>
  );
}

/** O bloco **Disputa** de uma linha para a equipe que lê o financeiro (desenho "Painel"). */
function DisputaDaEquipe({ d, reservaId, hoje, defesa, atalhoLiberacao }: { d: ContestacaoDaEquipe; reservaId: string; hoje: string; defesa: boolean; atalhoLiberacao: string | null }) {
  const a = d.acoes;
  const linhas: [string, ReactNode][] = [
    ["Situação", d.situacaoTexto],
    ["Valor em disputa", d.valor],
    ["Valor em risco", `${d.valorEmRisco} — ${d.contaDoValorEmRisco}`],
    ["Número do caso", <Caso key="caso" id={d.idCaso} />],
  ];
  if (d.idContestacao) linhas.push(["Contestação no Mercado Pago", <Caso key="cbk" id={d.idContestacao} />]);
  if (d.idTransacao) linhas.push(["Transação (só referência)", <code key="tr">{d.idTransacao}</code>]);
  linhas.push(["No Mercado Pago", <Lista key="mp" titulo="" itens={d.mercadoPago} />]);
  linhas.push(["Verificação do banco", d.verificacao]);
  if (d.prazo) linhas.push(["Documentos", d.prazo.texto]);
  if (d.notaRegistro) linhas.push(["Nota do registro", d.notaRegistro]);
  if (d.notaDebito) linhas.push(["Nota do débito (só a equipe)", d.notaDebito]);
  if (d.decisao) {
    linhas.push(...d.decisao.linhas);
    if (d.decisao.nota) linhas.push(["Nota da decisão (só a equipe)", d.decisao.nota]);
    if (d.decisao.notaMudanca) linhas.push(["Por que a decisão mudou (só a equipe)", d.decisao.notaMudanca]);
    if (d.decisao.explicacao) linhas.push(["Explicação ao proprietário", d.decisao.explicacao]);
  }
  if (d.resultado) {
    linhas.push(...d.resultado.linhas);
    if (d.resultado.nota) linhas.push(["Nota do resultado", d.resultado.nota]);
  }
  return (
    <section aria-label={`Disputa: ${d.cabecalho}`} style={caixa}>
      <div className={styles.linha} style={{ alignItems: "center", gap: 8 }}>
        <strong>{d.cabecalho}</strong>
        <span className={styles.etiqueta}>{d.situacaoTexto.split(" (")[0]}</span>
        {d.duplicataPossivel && <span className={styles.etiqueta}>possível duplicata</span>}
      </div>
      <p style={nota}>{d.origemTexto}</p>
      <Linhas linhas={linhas} />
      {d.divisaoMudou && (
        <p role="note" className={styles.alerta} style={{ margin: 0 }}>
          A divisão da reserva mudou depois da decisão: mude a decisão se quiser.
        </p>
      )}
      {d.semDecisao && <p style={nota}>{d.semDecisao}</p>}
      <Lista titulo="Proprietário" itens={d.lancamentos.proprietario} />
      <Lista titulo="SCL" itens={d.lancamentos.scl} />
      <Lista titulo="Caixa" itens={d.lancamentos.caixa} />
      <Lista titulo="Devolução substituída pela disputa" itens={d.substituidas} />
      {d.avisos.length > 0 && (
        <ul role="note" className={styles.alerta} style={{ margin: 0, paddingLeft: 28, fontSize: "0.875rem" }}>
          {d.avisos.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {d.decisao?.textoParaProprietario && (
        <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <BotaoCopiar texto={d.decisao.textoParaProprietario} rotulo="Copiar texto para o proprietário" className={styles.pequeno} />
          <span style={nota}>pronto para enviar a ele (nada é enviado sozinho)</span>
        </span>
      )}
      {defesa && <DefesaLink reservaId={reservaId} />}
      {d.eventos.length > 0 && (
        <details style={{ fontSize: "0.875rem" }}>
          <summary>Linha do tempo ({d.eventos.length})</summary>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {d.eventos.map((e, i) => (
              <li key={`${e.em.toISOString()}-${i}`}>
                {quando(e.em)} — {e.texto} ({e.quem})
              </li>
            ))}
          </ul>
        </details>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {a.outraDisputa && (
          <FormAcaoContestacao
            acao={confirmarOutraDisputaAcao}
            contestacaoId={d.id}
            rotulo="Confirmar que é outra disputa"
            nome="Confirmar que é outra disputa"
            pergunta="Confirmar que esta é outra disputa, e não a mesma de outra do quadro? Ela passa a segurar o valor dela (o retido e o valor em risco), sem passar do pago com as outras."
          />
        )}
        {a.debito && (
          <FormAcaoContestacao
            acao={confirmarDebitoAcao}
            contestacaoId={d.id}
            rotulo="Confirmar o débito do Mercado Pago"
            nome="Confirmar o débito do Mercado Pago"
            discreto
            pergunta="Confirmar que o Mercado Pago debitou {valor} em {data} por esta disputa? O retido passa a saída de caixa realizada nessa data. Confira no painel dele."
            valorNaPergunta="valor"
            dataNaPergunta="data"
          >
            <label style={{ flex: "0 1 180px" }}>
              Dia do débito
              <input type="date" name="data" min={a.debito.desde} max={hoje} defaultValue={hoje} required />
            </label>
            <label style={{ flex: "0 1 160px" }}>
              Valor debitado (R$)
              <input name="valor" inputMode="decimal" defaultValue={centavosParaCampo(a.debito.valor)} required />
            </label>
            <label style={{ flex: "1 1 220px" }}>
              Nota (obrigatória quando o valor difere do valor em risco)
              <input name="nota" maxLength={300} placeholder="ex.: painel do Mercado Pago mostra o débito de 16/12" />
            </label>
          </FormAcaoContestacao>
        )}
        {a.decidir && (
          <FormDecisaoContestacao contestacaoId={d.id} decisao={a.decidir} acao={a.decidir.modo === "mudar" ? mudarDecisaoAcao : registrarDecisaoAcao} perdida={d.situacao === "perdida"} />
        )}
        {a.decidir?.atualizacao && (
          <FormAcaoContestacao acao={atualizarValorSeguradoAcao} contestacaoId={d.id} rotulo="Atualizar o valor segurado" nome="Atualizar o valor segurado" pergunta={a.decidir.atualizacao.pergunta}>
            <input type="hidden" name="versao" value={a.decidir.atualizacao.versao} />
            <input type="hidden" name="assinatura" value={a.decidir.atualizacao.assinatura} />
          </FormAcaoContestacao>
        )}
        {a.prazo && (
          <FormAcaoContestacao
            acao={informarPrazoAcao}
            contestacaoId={d.id}
            rotulo="Informar o prazo dos documentos"
            nome="Informar o prazo dos documentos"
            discreto
            pergunta="Informar {data} como o prazo dos documentos desta disputa (confira no painel do Mercado Pago)? O Início passa a avisar pelo prazo."
            dataNaPergunta="prazo"
          >
            <label style={{ flex: "0 1 200px" }}>
              Prazo dos documentos
              <input type="date" name="prazo" min={a.prazo.desde} required />
            </label>
          </FormAcaoContestacao>
        )}
        {d.podeMarcarDocumentos && <FormDocumentos id={d.id} desde={d.desde} hoje={hoje} />}
        {a.resultado && <FormResultadoContestacao contestacaoId={d.id} resultado={a.resultado} acao={confirmarResultadoAcao} hoje={hoje} atalhoLiberacao={atalhoLiberacao} />}
        {a.semEfeito && (
          <FormAcaoContestacao
            acao={encerrarSemEfeitoAcao}
            contestacaoId={d.id}
            rotulo="Encerrar sem efeito"
            nome="Encerrar sem efeito"
            discreto
            aposRecusa={a.semEfeito.emAndamento ? undefined : { codigo: "nota_reforcada", campos: <CaixaReforcadaSemEfeito /> }}
            pergunta="Encerrar esta disputa sem efeito (registrada por engano, duplicata, ou reclamação resolvida sem dinheiro)? Os lançamentos previstos dela são desfeitos no mês corrente, a devolução que ela substituía volta a ser devida e o pagamento volta à situação de antes. Não se desfaz."
          >
            {a.semEfeito.pedeVolta && (
              <label style={{ flex: "0 1 220px" }}>
                Dia em que o dinheiro debitado voltou
                <input type="date" name="voltaEm" max={hoje} required />
              </label>
            )}
            {a.semEfeito.emAndamento && <CaixaReforcadaSemEfeito />}
            <label style={{ flex: "1 1 260px" }}>
              Por que fica sem efeito (obrigatória, sem dados pessoais)
              <input name="nota" required maxLength={300} />
            </label>
          </FormAcaoContestacao>
        )}
        {a.conferirAviso && (
          <FormAcaoContestacao
            acao={conferirAvisoAcao}
            contestacaoId={d.id}
            rotulo="Conferir o aviso"
            nome="Conferir o aviso"
            pergunta="Registrar o que o painel do Mercado Pago mostra: {opcao}?"
            opcaoNaPergunta={{
              campo: "como",
              textos: { continua_encerrada: "a disputa continua encerrada (o aviso sai)", reaberta: "a disputa foi reaberta (nasce a rodada seguinte, que segue o fluxo inteiro)" },
            }}
          >
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4, flex: "1 1 100%" }}>
              <legend style={{ fontSize: "0.875rem" }}>O que o painel do Mercado Pago mostra</legend>
              <label className={styles.check}>
                <input type="radio" name="como" value="continua_encerrada" required /> A disputa continua encerrada no painel do Mercado Pago
              </label>
              {a.conferirAviso.reabre && (
                <label className={styles.check}>
                  <input type="radio" name="como" value="reaberta" /> A disputa foi reaberta (reapresentação ou arbitragem)
                </label>
              )}
            </fieldset>
            <label style={{ flex: "1 1 260px" }}>
              Nota (obrigatória, sem dados pessoais)
              <input name="nota" required maxLength={300} />
            </label>
          </FormAcaoContestacao>
        )}
      </div>
    </section>
  );
}

export type PropsContestacaoSite = {
  reservaId: string;
  pagamento: PagamentoDoPainel;
  /** As disputas deste pagamento para a equipe que lê o financeiro (`lerContestacoesDaEquipe`); null sem financeiro:ler. */
  equipe: readonly ContestacaoDaEquipe[] | null;
  /** As disputas deste pagamento para quem só lê a reserva (`lerContestacoesDaOperacao`). */
  operacao: readonly ContestacaoNaTela[];
  /** financeiro:editar — registrar a disputa vista no painel do Mercado Pago (as outras ações vêm em `acoes`, já filtradas). */
  editarFinanceiro: boolean;
  /** reserva:editar ou financeiro:editar — a página "Documentos para a defesa". */
  defesa: boolean;
  hoje: string;
};

/**
 * Ficha da reserva → quadro "Pagamento no site" → as disputas de um pagamento (M8.2e; desenho "Painel"): um bloco
 * **Disputa** por linha (a mais antiga primeiro), com cada ação só quando o domínio permite e com `BotaoConfirmar`, e o
 * resultado voltando pela chave fixa `?contestacao=`. Sem financeiro:ler, só a frase, a situação e o prazo, e as ações de
 * documentos. "Registrar disputa vista no painel do Mercado Pago" fica aqui, no quadro do pagamento.
 */
export function ContestacaoSite({ reservaId, pagamento: p, equipe, operacao, editarFinanceiro, defesa, hoje }: PropsContestacaoSite) {
  const registrar = editarFinanceiro && equipe !== null && comDinheiro(p.situacao);
  if (!registrar && !(equipe?.length ?? operacao.length)) return null;
  const desde = hojeISO(FUSO, p.aprovadoEm ?? p.criadoEm);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {equipe
        ? equipe.map((d) => <DisputaDaEquipe key={d.id} d={d} reservaId={reservaId} hoje={hoje} defesa={defesa} atalhoLiberacao={p.acoes.registrarLiberacao ? `#${ancoraDaLiberacao(p.id)}` : null} />)
        : operacao.map((d) => <DisputaResumida key={d.id} d={d} reservaId={reservaId} hoje={hoje} defesa={defesa} />)}
      {registrar && (
        <FormRegistrarContestacao
          pagamentoId={p.id}
          acao={registrarDisputaAcao}
          pix={p.forma === "pix"}
          desde={desde}
          hoje={hoje}
          valorPadrao={centavosParaCampo(p.valorPago ?? p.valor)}
        />
      )}
    </div>
  );
}

/**
 * "Cancelar a reserva contestada" no quadro "Pagamento no site" (antes da entrada; reserva:editar e financeiro:editar): só
 * quando uma disputa não final, não duplicada e com valor em risco está num pagamento da reserva confirmada. O resto das
 * recusas (a entrada, um repasse a pagar, uma devolução em voo) o servidor confere na prévia.
 */
export function CancelarContestada({ reservaId, mostrar }: { reservaId: string; mostrar: boolean }) {
  if (!mostrar) return null;
  return (
    <section aria-label="Cancelar a reserva contestada" style={caixa}>
      <FormCancelarContestada reservaId={reservaId} calcular={previaDoCancelamentoContestadoAcao} cancelar={cancelarReservaContestadaAcao} />
    </section>
  );
}
