import type { ReactNode } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import styles from "@/components/formularios.module.css";
import { CANAIS_PEDIDO_ALTERACAO, type EstadoReserva, MOTIVOS_CANCELAMENTO_EMPRESA, MOTIVOS_EXCECAO, MOTIVOS_VALOR_ALTERACAO, type MotivoCancelamentoEmpresa, type ResultadoDaAlteracao } from "@/db/schema";
import { diaMesBr, hojeISO, horaNoFuso } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import type { MensagemPronta } from "@/mensagens/hospede";
import {
  aplicarAlteracaoAcao,
  calcularAlteracaoAcao,
  desistirDaAlteracaoAcao,
  marcarHospedeAvisadoAlteracaoAcao,
  marcarOtaAtualizadaAcao,
  previaDaAplicacaoAcao,
  segurarAlteracaoAcao,
} from "@/pagamentos/acoes-alteracao";
import { estadiaEmTexto, NOMES_MOTIVO_VALOR, NOMES_ORIGEM_VALOR } from "@/pagamentos/alteracao";
import type { AlteracaoDoPainel } from "@/pagamentos/alteracao-painel";
import { diaBr, diaHoraBr, NOMES_BASE_CANCELAMENTO, NOMES_CANAL_PEDIDO, NOMES_MOTIVO_EMPRESA, NOMES_MOTIVO_EXCECAO } from "@/pagamentos/cancelamento";
import { NOMES_SITUACAO_PAGAMENTO } from "@/pagamentos/situacoes";
import { FormAlteracaoSite, FormAplicarAlteracao, FormDesistirAlteracao, type OpcaoAlteracao } from "./FormAlteracaoSite";

const FUSO = "America/Sao_Paulo";
const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;
const botaoDiscreto = { font: "inherit", fontSize: "0.8125rem", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--scl-borda)", background: "var(--scl-papel)", cursor: "pointer" } as const;

/** As opções dos formulários (as listas fechadas do domínio, com nomes simples). */
const CANAIS: OpcaoAlteracao[] = CANAIS_PEDIDO_ALTERACAO.map((c) => ({ valor: c, texto: NOMES_CANAL_PEDIDO[c] }));
const NOMES_OPCAO_EMPRESA: Record<MotivoCancelamentoEmpresa, string> = { imovel_sem_condicoes: "Apartamento sem condições de receber o hóspede", forca_maior: "Força maior", outro: "Outro motivo" };
const MOTIVOS_DA_EMPRESA: OpcaoAlteracao[] = MOTIVOS_CANCELAMENTO_EMPRESA.map((m) => ({ valor: m, texto: NOMES_OPCAO_EMPRESA[m] }));
const MOTIVOS_DO_VALOR: OpcaoAlteracao[] = MOTIVOS_VALOR_ALTERACAO.map((m) => ({ valor: m, texto: NOMES_MOTIVO_VALOR[m] }));
const MOTIVOS_DA_EXCECAO: OpcaoAlteracao[] = MOTIVOS_EXCECAO.map((m) => ({ valor: m, texto: NOMES_MOTIVO_EXCECAO[m] }));
const COMPONENTES: [keyof ResultadoDaAlteracao["meses"][number]["antes"], string][] = [
  ["bruto", "Valor bruto"],
  ["taxa", "Taxa do Mercado Pago"],
  ["comissao", "Comissão da SCL"],
  ["parte", "Parte do proprietário"],
];

export type PropsAlteracaoSite = {
  reserva: { id: string; codigo: string; estado: EstadoReserva; checkin: string; checkout: string; hospedes: number | null; valorBruto: number | null };
  /** Até quantas pessoas o apartamento recebe; null = não cadastrada. */
  capacidade: number | null;
  /** As alterações da reserva, da mais nova para a mais antiga (`alteracoesDaReserva`). */
  alteracoes: readonly AlteracaoDoPainel[];
  /** Há um pedido ou cancelamento ativo: a alteração espera. */
  comCancelamento: boolean;
  /** O instante da entrada (D1): a partir dele, nada se altera pelo sistema; null = ainda não lido (sem o formulário). */
  entradaEm: Date | null;
  /** reserva:editar — "Datas atualizadas nas OTAs" e "Mensagem enviada ao hóspede". */
  editarReserva: boolean;
  /** financeiro:editar (com reserva:editar) — calcular, segurar, aplicar e desistir. */
  editarFinanceiro: boolean;
  /** financeiro:ler — valores, o financeiro da alteração, o motivo da desistência e as mensagens com valor. */
  verValores: boolean;
  agora: Date;
};

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

/** "De dd/mm–dd/mm (N noites, P pessoas) para dd/mm–dd/mm (N noites, P pessoas)" — datas e pessoas, nunca valores. */
const deParaEmTexto = (a: AlteracaoDoPainel) => `de ${estadiaEmTexto(a.antes)} para ${estadiaEmTexto(a.depois)}`;

/** Quem pediu, quando e por onde (sem notas: elas ficam com o financeiro). */
function pedidoEmTexto(a: AlteracaoDoPainel): string {
  const quem = a.quemPede === "empresa" ? `a SCL propôs${a.motivoEmpresa ? ` (${NOMES_MOTIVO_EMPRESA[a.motivoEmpresa]})` : ""}` : `o hóspede pediu em ${diaHoraBr(a.pedidoRecebidoEm)}${a.canal ? ` (${NOMES_CANAL_PEDIDO[a.canal]})` : ""}`;
  return `${quem} · preparada em ${diaHoraBr(a.criadaEm)}${a.criadaPor ? ` por ${a.criadaPor}` : ""}`;
}

/** O valor de antes e de depois e o que a política decidiu da diferença (só para quem lê o financeiro). */
function valorEmTexto(a: AlteracaoDoPainel): string {
  const origem = `${NOMES_ORIGEM_VALOR[a.origemValor]}${a.motivoValor ? `: ${NOMES_MOTIVO_VALOR[a.motivoValor]}` : ""}`;
  if (a.diferenca > 0) return `de ${formatBRL(a.antes.valor)} para ${formatBRL(a.depois.valor)} (${origem}): o hóspede paga a diferença de ${formatBRL(a.diferenca)}`;
  if (a.diferenca === 0) return `o mesmo (${formatBRL(a.antes.valor)})`;
  const base = a.base ? NOMES_BASE_CANCELAMENTO[a.base] : "decisão da equipe";
  if (a.direito === "integral") return `de ${formatBRL(a.antes.valor)} para ${formatBRL(a.depois.valor)} (${origem}): devolução de ${formatBRL(a.valorADevolver ?? -a.diferenca)} pela política (${base})`;
  return `continua ${formatBRL(a.antes.valor)}: pela política, a diferença de ${formatBRL(-a.diferenca)} não é devolvida (${base}); preço das novas datas ${formatBRL(a.depois.valor)} (${origem})`;
}

/** A devolução da diferença (as da alteração juntas, como a página do hóspede): a situação e o valor (só com `financeiro:ler`). */
function devolucaoEmTexto(a: AlteracaoDoPainel, verValores: boolean): string | null {
  if (a.diferenca >= 0) return null;
  if (a.direito !== "integral") return "sem devolução pela política";
  const d = a.devolucao;
  if (!d) return "ainda não registrada (veja o quadro do pagamento)";
  const valor = verValores ? ` de ${formatBRL(d.valorConfirmado ?? d.valor)}` : "";
  const estados: Record<NonNullable<AlteracaoDoPainel["devolucao"]>["estado"], string> = {
    aguardando_liberacao: `esperando o Mercado Pago liberar o pagamento${d.previstaEm ? ` (previsto para ${diaMesBr(d.previstaEm)})` : ""}: nada foi pedido ainda`,
    pedida: "pedida ao Mercado Pago",
    feita: `feita${d.em ? ` em ${diaBr(d.em)}` : ""}${d.porFora ? " (por fora)" : d.algumaPorFora ? " (uma parte por fora)" : ""}`,
    com_a_equipe: "com a equipe: o Mercado Pago não devolveu (veja o quadro do pagamento)",
    em_conferencia: "em conferência (veja o quadro do pagamento)",
  };
  return `Devolução${valor}: ${estados[d.estado]}`;
}

/** O financeiro da alteração, por mês e componente: antes, depois e a diferença (o que o motor lançou ao aplicar). */
function TabelaDoResultado({ resultado }: { resultado: ResultadoDaAlteracao }) {
  const sinal = (n: number) => (n > 0 ? `+${formatBRL(n)}` : formatBRL(n));
  return (
    <div className={styles.rolagem}>
      <table className={styles.tabela} aria-label="Financeiro da alteração">
        <thead>
          <tr>
            <th>Mês</th>
            <th>Componente</th>
            <th>Antes</th>
            <th>Depois</th>
            <th>Diferença</th>
          </tr>
        </thead>
        <tbody>
          {resultado.meses.flatMap((m) =>
            COMPONENTES.map(([k, rotulo]) => (
              <tr key={`${m.mes}-${k}`}>
                <td>{`${m.mes.slice(5, 7)}/${m.mes.slice(0, 4)}`}</td>
                <td>{rotulo}</td>
                <td className={styles.numero}>{formatBRL(m.antes[k])}</td>
                <td className={styles.numero}>{formatBRL(m.depois[k])}</td>
                <td className={styles.numero}>{sinal(m.depois[k] - m.antes[k])}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** O botão de copiar uma mensagem ao hóspede (montada agora, nunca gravada), ou o que falta para ela sair. */
function Copiar({ m, rotulo }: { m: MensagemPronta; rotulo: string }) {
  if (!m.texto)
    return (
      <p role="note" style={nota}>
        {rotulo}: falta {m.falta.map((v) => `{${v}}`).join(", ")} na reserva: complete antes de copiar.{m.falta.includes("link") ? " O endereço do site fica em Configurações → Empresa." : ""}
      </p>
    );
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <BotaoCopiar texto={m.texto} rotulo={rotulo} className={styles.pequeno} />
      {m.textoBase && (
        <span style={nota}>{m.modeloRecusado ? `texto-base: o modelo escolhido não serve para esta mensagem (${m.modeloRecusado})` : "texto-base"} — edite em Configurações → Mensagens ao hóspede</span>
      )}
    </span>
  );
}

/**
 * "Mensagem enviada ao hóspede": a marca (quando e quem) ou o botão (reserva:editar), com confirmação — a marca não se
 * desfaz, e com ela o sistema não envia mais a mensagem e o aviso do Início some. As mensagens da alteração levam valores:
 * só quem lê o financeiro as copia; sem isso, o botão fica com quem pode enviá-las.
 */
function Avisado({ alteracaoId, qual, marca, editar, podeCopiar }: { alteracaoId: string; qual: "proposta" | "confirmacao" | "devolucao"; marca: AlteracaoDoPainel["avisados"]["proposta"]; editar: boolean; podeCopiar: boolean }) {
  if (marca) return <>enviada em {diaBr(marca.em)} por {marca.por ?? "o sistema"}</>;
  if (!editar) return <>ainda não enviada</>;
  if (!podeCopiar) return <>ainda não enviada (quem cuida do financeiro copia e envia esta mensagem)</>;
  return (
    <form action={marcarHospedeAvisadoAlteracaoAcao} style={{ display: "inline" }}>
      <input type="hidden" name="alteracaoId" value={alteracaoId} />
      <input type="hidden" name="qual" value={qual} />
      ainda não enviada{" "}
      <BotaoConfirmar pergunta="Confirmar que esta mensagem já foi enviada ao hóspede? A marca não se desfaz: o sistema não a envia mais e o aviso some do Início." style={botaoDiscreto}>
        Mensagem enviada ao hóspede
      </BotaoConfirmar>
    </form>
  );
}

/** A alteração mudou as datas (só as pessoas ou o valor não mexem no bloqueio das OTAs). */
const mudouDatas = (a: Pick<AlteracaoDoPainel, "antes" | "depois">) => a.antes.checkin !== a.depois.checkin || a.antes.checkout !== a.depois.checkout;

/** "Datas atualizadas nas OTAs" (reserva:editar) de uma alteração aplicada; o M8.3 vai gravar sozinho quando chegar. */
function Otas({ a, editar }: { a: AlteracaoDoPainel; editar: boolean }) {
  if (a.ota) return <>bloqueio mudado em {diaBr(a.ota.em)} por {a.ota.por ?? "o sistema"}</>;
  if (!editar) return <>bloqueio ainda não marcado como mudado nas OTAs</>;
  return (
    <form action={marcarOtaAtualizadaAcao} style={{ display: "inline" }}>
      <input type="hidden" name="alteracaoId" value={a.id} />
      mude o bloqueio nas OTAs (no Beds24, feche as novas datas e reabra as antigas){" "}
      <BotaoConfirmar pergunta="Confirmar que o bloqueio desta reserva já foi mudado nas OTAs (no Beds24: novas datas fechadas, antigas reabertas)?" style={botaoDiscreto}>
        Datas atualizadas nas OTAs
      </BotaoConfirmar>
    </form>
  );
}

/** O que a alteração segurada espera: o pagamento da diferença ou a confirmação do hóspede (e até quando). */
function esperaEmTexto(a: AlteracaoDoPainel): string {
  const espera = a.diferenca > 0 ? "esperando o pagamento da diferença" : "esperando a confirmação do hóspede";
  if (a.emCarencia && a.holdAte) return `o prazo das datas acabou às ${horaNoFuso(a.holdAte, FUSO)}, mas um pagamento da diferença ainda está em andamento (${espera})`;
  return `datas seguradas até ${a.holdAte ? diaHoraBr(a.holdAte) : "—"} (${espera})`;
}

/** A pergunta do "Desistir da alteração" (§9.2), com o cancelamento do Pix da diferença ainda não pago, quando há. */
function perguntaDaDesistencia(a: AlteracaoDoPainel): string {
  const pixPendente = a.tentativas.some((t) => t.forma === "pix" && t.situacao === "pendente");
  return `Desistir da alteração preparada em ${diaBr(a.criadaEm)} (novas datas ${diaMesBr(a.depois.checkin)} a ${diaMesBr(a.depois.checkout)})? As novas datas voltam à venda e a reserva continua como está.${pixPendente ? " O Pix da diferença ainda não pago é cancelado no Mercado Pago." : ""}`;
}

/** As tentativas de pagamento da diferença, em palavras (os valores ficam no quadro de cada pagamento). */
const tentativasEmTexto = (a: AlteracaoDoPainel) =>
  a.tentativas.length ? a.tentativas.map((t) => `${t.forma === "cartao" ? "Cartão" : "Pix"} de ${diaHoraBr(t.criadoEm)}: ${NOMES_SITUACAO_PAGAMENTO[t.situacao].toLowerCase()}`).join("; ") : "nenhuma ainda";

/** O bloco da alteração com as datas seguradas agora: o que espera, as datas, a proposta, aplicar (sem aumento) e desistir. */
function Segurada({ a, editarReserva, editarFinanceiro, verValores }: { a: AlteracaoDoPainel; editarReserva: boolean; editarFinanceiro: boolean; verValores: boolean }) {
  const editar = editarReserva && editarFinanceiro;
  const linhas: [string, ReactNode][] = [
    ["Situação", esperaEmTexto(a)],
    ["Pedido", pedidoEmTexto(a)],
    ["Datas e pessoas", deParaEmTexto(a)],
    ...(verValores ? ([["Valor", valorEmTexto(a)]] as [string, ReactNode][]) : []),
    ["Novas noites seguradas", a.noitesNovas ? `${diaMesBr(a.noitesNovas.inicio)}–${diaMesBr(a.noitesNovas.fim)}` : "nenhuma (as novas datas cabem nas de agora)"],
    ...(a.diferenca > 0 ? ([["Pagamento da diferença", tentativasEmTexto(a)]] as [string, ReactNode][]) : []),
    ["Hóspede avisado: proposta", <Avisado key="proposta" alteracaoId={a.id} qual="proposta" marca={a.avisados.proposta} editar={editarReserva} podeCopiar={verValores} />],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-label="Alteração com as datas seguradas">
      <strong>Alteração com as novas datas seguradas</strong>
      <Linhas linhas={linhas} />
      {verValores && a.mensagens.proposta && <Copiar m={a.mensagens.proposta} rotulo="Copiar a proposta" />}
      {editar && a.diferenca <= 0 && <FormAplicarAlteracao alteracaoId={a.id} previaDaAplicacao={previaDaAplicacaoAcao} aplicar={aplicarAlteracaoAcao} />}
      {editar && <FormDesistirAlteracao alteracaoId={a.id} acao={desistirDaAlteracaoAcao} pergunta={perguntaDaDesistencia(a)} />}
    </div>
  );
}

/** Uma alteração aplicada: quando e por quem, as datas, o valor, a devolução, o financeiro, as OTAs e as mensagens. */
function Aplicada({ a, editarReserva, verValores }: { a: AlteracaoDoPainel; editarReserva: boolean; verValores: boolean }) {
  const quem = a.aplicadaPor ? `por ${a.aplicadaPor}` : `pelo pagamento da diferença${a.aplicadaTardia ? " (aprovado depois do prazo das datas, com as noites ainda livres)" : ""}`;
  const devolucao = devolucaoEmTexto(a, verValores);
  const linhas: [string, ReactNode][] = [
    ["Aplicada em", a.aplicadaEm ? `${diaHoraBr(a.aplicadaEm)} ${quem}` : quem],
    ["Pedido", pedidoEmTexto(a)],
    ["Datas e pessoas", deParaEmTexto(a)],
    ...(verValores ? ([["Valor", valorEmTexto(a)]] as [string, ReactNode][]) : []),
    ...(devolucao ? ([["Devolução da diferença", devolucao]] as [string, ReactNode][]) : []),
    ...(mudouDatas(a) ? ([["OTAs", <Otas key="ota" a={a} editar={editarReserva} />]] as [string, ReactNode][]) : []),
    ...(a.mensagens.confirmada || a.avisados.confirmacao
      ? ([["Hóspede avisado: alteração confirmada", <Avisado key="confirmacao" alteracaoId={a.id} qual="confirmacao" marca={a.avisados.confirmacao} editar={editarReserva} podeCopiar={verValores} />]] as [string, ReactNode][])
      : []),
    ...(a.mensagens.devolvida || a.avisados.devolucao
      ? ([["Hóspede avisado: devolução feita", <Avisado key="devolucao" alteracaoId={a.id} qual="devolucao" marca={a.avisados.devolucao} editar={editarReserva} podeCopiar={verValores} />]] as [string, ReactNode][])
      : []),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-label="Alteração aplicada">
      <strong>Alteração aplicada</strong>
      <Linhas linhas={linhas} />
      {verValores && a.resultado && a.resultado.meses.length > 0 && <TabelaDoResultado resultado={a.resultado} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {verValores && a.mensagens.confirmada && <Copiar m={a.mensagens.confirmada} rotulo="Copiar mensagem: alteração confirmada" />}
        {verValores && a.mensagens.devolvida && <Copiar m={a.mensagens.devolvida} rotulo="Copiar mensagem: devolução feita" />}
      </div>
    </div>
  );
}

/** O histórico (nunca apagado): as que venceram, as desistidas e as aplicadas mais antigas. Valores só com `financeiro:ler`. */
function Historico({ lista, verValores }: { lista: readonly AlteracaoDoPainel[]; verValores: boolean }) {
  if (!lista.length) return null;
  const desfecho = (a: AlteracaoDoPainel) => {
    if (a.situacao === "aplicada") return `aplicada em ${a.aplicadaEm ? diaBr(a.aplicadaEm) : "—"}${a.ota || !mudouDatas(a) ? "" : " (bloqueio nas OTAs ainda não marcado)"}`;
    if (a.situacao === "desistida") return `desistida${a.desistidaEm ? ` em ${diaBr(a.desistidaEm)}` : ""}${a.desistidaPor ? ` por ${a.desistidaPor}` : ""}${verValores && a.desistenciaMotivo ? `: ${a.desistenciaMotivo}` : ""}`;
    return "o prazo das datas acabou (as novas datas voltaram à venda)";
  };
  return (
    <div style={{ fontSize: "0.875rem" }}>
      <strong>Histórico das alterações</strong>
      <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
        {lista.map((a) => (
          <li key={a.id}>
            {diaBr(a.criadaEm)}: {deParaEmTexto(a)}
            {verValores && a.diferenca !== 0 ? ` (diferença de ${formatBRL(Math.abs(a.diferenca))}${a.diferenca > 0 ? " a pagar" : ""})` : ""} — {desfecho(a)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A alteração de reserva paga pelo site no quadro "Pagamento no site" da ficha (M8.2d; desenho §9.2). Antes: para quem cuida
 * do financeiro, o formulário do cálculo e da alteração (só com a reserva confirmada, sem cancelamento e antes da entrada).
 * Com as datas seguradas: o que espera, a proposta, aplicar (sem aumento) e desistir. Depois de aplicada: a devolução da
 * diferença, o financeiro por mês, as OTAs e as mensagens ao hóspede. E o histórico. Sem `financeiro:editar`, a alteração
 * segurada aparece sem valores, e o formulário não aparece. Valores, o financeiro e as mensagens com valor só com
 * `financeiro:ler`; as ações só com a permissão de cada uma (o servidor confere de novo).
 */
export function AlteracaoSite({ reserva, capacidade, alteracoes, comCancelamento, entradaEm, editarReserva, editarFinanceiro, verValores, agora }: PropsAlteracaoSite) {
  const confirmada = reserva.estado === "confirmada";
  if (!confirmada && !alteracoes.length) return null;
  const segurada = alteracoes.find((a) => a.situacao === "segurada") ?? null;
  const aplicadas = alteracoes.filter((a) => a.situacao === "aplicada");
  // Em destaque: a última aplicada e as que ainda esperam o bloqueio nas OTAs; o resto vai ao histórico.
  const destaque = aplicadas.filter((a, i) => i === 0 || !a.ota);
  const historico = alteracoes.filter((a) => a !== segurada && !destaque.includes(a));
  const iniciou = !!entradaEm && agora.getTime() >= entradaEm.getTime();
  const podeAlterar = confirmada && !segurada && !comCancelamento && !!entradaEm && !iniciou;
  const agoraSP = { data: hojeISO(FUSO, agora), hora: horaNoFuso(agora, FUSO) };
  return (
    <section aria-label="Alteração da reserva" style={{ border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>Alteração da reserva</strong>
      {confirmada && !editarFinanceiro && <p style={nota}>Esta reserva foi paga pelo site: a alteração é feita por quem cuida do financeiro.</p>}
      {segurada && <Segurada a={segurada} editarReserva={editarReserva} editarFinanceiro={editarFinanceiro} verValores={verValores} />}
      {confirmada && editarFinanceiro && !segurada && comCancelamento && <p style={nota}>Há um pedido de cancelamento desta reserva: decida ou descarte o pedido antes de alterar.</p>}
      {confirmada && editarFinanceiro && iniciou && (
        <p style={nota}>
          A estadia já começou: a alteração pelo sistema vale só antes da entrada. Para mais noites, faça uma nova reserva; a saída antecipada não tem devolução pela política e a reserva fica como está.
        </p>
      )}
      {podeAlterar && editarReserva && editarFinanceiro && (
        <FormAlteracaoSite
          reservaId={reserva.id}
          calcular={calcularAlteracaoAcao}
          segurar={segurarAlteracaoAcao}
          atual={{ checkin: reserva.checkin, checkout: reserva.checkout, hospedes: reserva.hospedes, valor: reserva.valorBruto === null ? "valor não informado" : formatBRL(reserva.valorBruto) }}
          capacidade={capacidade}
          agora={agoraSP}
          canais={CANAIS}
          motivosEmpresa={MOTIVOS_DA_EMPRESA}
          motivosValor={MOTIVOS_DO_VALOR}
          motivosExcecao={MOTIVOS_DA_EXCECAO}
        />
      )}
      {destaque.map((a) => (
        <Aplicada key={a.id} a={a} editarReserva={editarReserva} verValores={verValores} />
      ))}
      <Historico lista={historico} verValores={verValores} />
    </section>
  );
}
