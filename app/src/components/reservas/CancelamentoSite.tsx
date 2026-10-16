import type { ReactNode } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import styles from "@/components/formularios.module.css";
import { textoDaFaltaNoCancelamento, VARIAVEIS_DO_CANCELAMENTO } from "@/configuracoes/modelos-texto";
import { HORA_LIMITE_DO_DIA } from "@/configuracoes/politica-cancelamento";
import { CANAIS_PEDIDO_CANCELAMENTO, type EstadoReserva, MOTIVOS_CANCELAMENTO_EMPRESA, MOTIVOS_EXCECAO, type MotivoCancelamentoEmpresa } from "@/db/schema";
import { diaMesBr, hojeISO, horaNoFuso } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import type { MensagemPronta } from "@/mensagens/hospede";
import {
  calcularCancelamentoAcao,
  cancelarReservaPagaAcao,
  descartarPedidoCancelamentoAcao,
  marcarHospedeAvisadoAcao,
  marcarOtaLiberadaAcao,
  registrarPedidoCancelamentoAcao,
} from "@/pagamentos/acoes-cancelamento";
import { diaBr, diaHoraBr, NOMES_BASE_CANCELAMENTO, NOMES_CANAL_PEDIDO, NOMES_MOTIVO_EMPRESA, NOMES_MOTIVO_EXCECAO } from "@/pagamentos/cancelamento";
import type { CancelamentoDoPainel } from "@/pagamentos/cancelamento-painel";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";
import { FormCancelamentoSite, FormDescartarPedido, FormRegistrarPedido, type OpcaoCancelamento } from "./FormCancelamentoSite";
import { devolucoesDoCancelamento, linhaDaDevolucao } from "./PagamentoNoSite";

const FUSO = "America/Sao_Paulo";
const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;
const botaoDiscreto = { font: "inherit", fontSize: "0.8125rem", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--scl-borda)", background: "var(--scl-papel)", cursor: "pointer" } as const;

/** As opções dos formulários (as listas fechadas do domínio, com nomes simples). */
const CANAIS_DA_EQUIPE: OpcaoCancelamento[] = CANAIS_PEDIDO_CANCELAMENTO.filter((c) => c !== "site").map((c) => ({ valor: c, texto: NOMES_CANAL_PEDIDO[c] }));
const CANAIS_DA_DESISTENCIA: OpcaoCancelamento[] = CANAIS_PEDIDO_CANCELAMENTO.map((c) => ({ valor: c, texto: c === "site" ? "Site (Minha reserva)" : NOMES_CANAL_PEDIDO[c] }));
const NOMES_OPCAO_EMPRESA: Record<MotivoCancelamentoEmpresa, string> = { imovel_sem_condicoes: "Apartamento sem condições de receber o hóspede", forca_maior: "Força maior", outro: "Outro motivo" };
const MOTIVOS_DA_EMPRESA: OpcaoCancelamento[] = MOTIVOS_CANCELAMENTO_EMPRESA.map((m) => ({ valor: m, texto: NOMES_OPCAO_EMPRESA[m] }));
const MOTIVOS_DA_EXCECAO: OpcaoCancelamento[] = MOTIVOS_EXCECAO.map((m) => ({ valor: m, texto: NOMES_MOTIVO_EXCECAO[m] }));

export type PropsCancelamentoSite = {
  reserva: { id: string; codigo: string; estado: EstadoReserva; checkin: string };
  /** O pagamento que confirmou a reserva (desfecho "reserva"). */
  pagamento: PagamentoDoPainel;
  /**
   * M8.2d: todos os pagamentos da reserva (o da diferença de uma alteração também): o cancelamento tem uma devolução por
   * pagamento que conta, e a linha "Devolução" mostra cada uma. Sem eles, só a do pagamento que confirmou.
   */
  pagamentos?: readonly PagamentoDoPainel[];
  /** O pedido ou o cancelamento ativo, com o histórico de descartados; null = nenhum. */
  cancelamento: CancelamentoDoPainel | null;
  /** O horário de entrada e a partir de quando o não comparecimento é aceito (null = reserva não encontrada). */
  momentos: { entradaEm: Date; naoComparecimentoApos: Date; fuso: string } | null;
  /** reserva:editar — registrar e descartar o pedido, OTAs, "mensagem enviada", a mensagem do pedido recebido. */
  editarReserva: boolean;
  /** financeiro:editar (com reserva:editar) — calcular e cancelar; descartar o pedido feito pelo hóspede no site. */
  editarFinanceiro: boolean;
  /** financeiro:ler — valores, a nota da decisão e as mensagens com valor. */
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

/** "Pedido recebido em": quando, por onde e quem registrou (e a correção do horário, quando houve). */
function momentoDoPedido(c: CancelamentoDoPainel): string {
  const partes = [diaHoraBr(c.pedidoRecebidoEm)];
  if (c.canal) partes.push(NOMES_CANAL_PEDIDO[c.canal]);
  if (c.canal && c.canal !== "site") partes.push(`registrado por ${c.pedidoPor ?? "a equipe"}`);
  if (!c.canal) partes.push(c.quemCancela === "empresa" ? "a SCL cancelou (sem pedido do hóspede)" : "não comparecimento (sem pedido do hóspede)");
  const texto = partes.join(" · ");
  return c.pedidoRegistradoOriginalEm ? `${texto} (corrigido de ${diaHoraBr(c.pedidoRegistradoOriginalEm).replace(" às ", " ")}: ${c.motivoMomento})` : texto;
}

function quemCancelou(c: CancelamentoDoPainel): string {
  if (c.quemCancela === "empresa") return `A SCL cancelou${c.motivoEmpresa ? ` (${NOMES_MOTIVO_EMPRESA[c.motivoEmpresa]})` : ""}`;
  if (c.quemCancela === "nao_comparecimento") return "Não comparecimento (o hóspede não chegou e não avisou)";
  return "O hóspede pediu";
}

function politica(c: CancelamentoDoPainel): string {
  if (c.politicaVersao === null) return "sem política aceita (pagamento anterior às páginas legais do site): decisão da equipe";
  const partes = [`versão ${c.politicaVersao}`];
  if (c.integralAte) partes.push(`reembolso integral para pedidos até ${diaMesBr(c.integralAte)} (${HORA_LIMITE_DO_DIA})`);
  if (c.arrependimentoAte) partes.push(`arrependimento até ${diaMesBr(c.arrependimentoAte)}${c.arrependimentoAteEntrada ? ", ou até a entrada" : ""}`);
  return partes.join(" — ");
}

function decisao(c: CancelamentoDoPainel, verValores: boolean): string {
  const base = c.base ? NOMES_BASE_CANCELAMENTO[c.base] : "";
  const motivo = verValores && c.motivoDecisao ? `: ${c.motivoDecisao}` : "";
  if (c.base === "excecao") return `Devolução integral por exceção (${c.motivoExcecao ? NOMES_MOTIVO_EXCECAO[c.motivoExcecao] : "motivo não informado"})${motivo}`;
  if (c.base === "sem_politica") return `${c.direito === "integral" ? "Devolução integral" : "Sem devolução"} — decisão da equipe, sem política aceita${motivo}`;
  return `${c.direito === "integral" ? "Devolução integral" : "Sem devolução"} — ${base}`;
}

function financeiro(c: CancelamentoDoPainel): string {
  const partes: string[] = [];
  if (c.resultadoLancadoEm) partes.push(`resultado lançado em ${diaBr(c.resultadoLancadoEm)}${c.espelhado ? " (no mês do cancelamento: a parte já tinha movimentado dinheiro)" : ""}`);
  if (c.caixaLancadoEm) partes.push(c.direito === "integral" ? `caixa lançado em ${diaBr(c.caixaLancadoEm)}` : "nada a lançar no caixa (o valor fica retido)");
  else if (c.direito === "integral") partes.push("aguardando a devolução ser realizada");
  return partes.join(" · ");
}

function parteDoProprietario(c: CancelamentoDoPainel, checkin: string, verValores: boolean): string {
  if (c.direito === "nenhum") return `retida: dividida como uma reserva normal; disponível depois de ${diaMesBr(checkin)} e da liberação do Mercado Pago`;
  if (!c.descontos.length) return "saiu do financeiro (não tinha sido repassada)";
  return c.descontos
    .map(
      (d) =>
        `já repassada: ${verValores ? `${formatBRL(d.valor)} de ` : ""}desconto lançado${c.resultadoLancadoEm ? ` em ${diaBr(c.resultadoLancadoEm)}` : ""} — ${d.situacao.tipo === "descontado" ? `descontado no repasse de ${diaMesBr(d.situacao.data)}` : "a descontar no próximo repasse"}`,
    )
    .join("; ");
}

/** O botão de copiar uma mensagem ao hóspede (montada agora, nunca gravada), ou o que falta para ela sair. */
function Copiar({ m, rotulo }: { m: MensagemPronta; rotulo: string }) {
  if (!m.texto) {
    // O que é do cancelamento (o valor, o dia…) não se completa na reserva: o dado ainda não existe neste caso.
    const doCancelamento = m.falta.filter((v) => VARIAVEIS_DO_CANCELAMENTO.includes(v));
    const daReserva = m.falta.filter((v) => !VARIAVEIS_DO_CANCELAMENTO.includes(v));
    return (
      <p role="note" style={nota}>
        {rotulo}:{" "}
        {[
          daReserva.length ? `falta ${daReserva.map((v) => `{${v}}`).join(", ")} na reserva: complete antes de copiar.${daReserva.includes("link") ? " O endereço do site fica em Configurações → Empresa." : ""}` : "",
          doCancelamento.length ? `${textoDaFaltaNoCancelamento(doCancelamento)}.` : "",
        ]
          .filter(Boolean)
          .join(" ")}
      </p>
    );
  }
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
 * desfaz, e com ela o sistema não envia mais a mensagem e o aviso do Início some. `podeCopiar` falso: a mensagem leva o valor
 * (decisão, devolução feita) e só quem lê o financeiro a copia; sem isso, o botão fica com quem pode enviá-la.
 */
function Avisado({ reservaId, qual, marca, editar, podeCopiar = true }: { reservaId: string; qual: "pedido" | "decisao" | "devolucao"; marca: CancelamentoDoPainel["avisados"]["pedido"]; editar: boolean; podeCopiar?: boolean }) {
  if (marca) return <>enviada em {diaBr(marca.em)} por {marca.por ?? "o sistema"}</>;
  if (!editar) return <>ainda não enviada</>;
  if (!podeCopiar) return <>ainda não enviada (quem cuida do financeiro copia e envia esta mensagem)</>;
  return (
    <form action={marcarHospedeAvisadoAcao} style={{ display: "inline" }}>
      <input type="hidden" name="reservaId" value={reservaId} />
      <input type="hidden" name="qual" value={qual} />
      ainda não enviada{" "}
      <BotaoConfirmar pergunta="Confirmar que esta mensagem já foi enviada ao hóspede? A marca não se desfaz: o sistema não a envia mais e o aviso some do Início." style={botaoDiscreto}>
        Mensagem enviada ao hóspede
      </BotaoConfirmar>
    </form>
  );
}

/** Os pedidos descartados (nunca apagados): quando chegaram, por onde, quem descartou, quando e o motivo. */
function Descartados({ c }: { c: CancelamentoDoPainel }) {
  if (!c.descartados.length) return null;
  return (
    <div style={{ fontSize: "0.875rem" }}>
      <strong>Pedidos descartados</strong>
      <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
        {c.descartados.map((d) => (
          <li key={`${d.em.toISOString()}-${d.descartadoEm?.toISOString() ?? ""}`}>
            {diaHoraBr(d.em)} ({d.canal ? NOMES_CANAL_PEDIDO[d.canal] : "sem canal"}) — descartado por {d.por ?? "a equipe"}
            {d.descartadoEm ? ` em ${diaBr(d.descartadoEm)}` : ""}: {d.motivo}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * O cancelamento pela política no quadro "Pagamento no site" da ficha (M8.2c; desenho §9.2 e §9.3). Antes de cancelar: o
 * pedido (registrar, descartar, a mensagem de pedido recebido) e, para quem cuida do financeiro, o formulário do cálculo e
 * do cancelamento. Depois: o pedido, quem cancelou, a política, a decisão, a devolução, o financeiro, a parte do
 * proprietário, as OTAs, as mensagens ao hóspede e os pedidos descartados. Valores, a nota da decisão e as mensagens com
 * valor só com `financeiro:ler`; as ações só com a permissão de cada uma (o servidor confere de novo).
 */
export function CancelamentoSite({ reserva, pagamento, pagamentos, cancelamento: c, momentos, editarReserva, editarFinanceiro, verValores, agora }: PropsCancelamentoSite) {
  const confirmada = reserva.estado === "confirmada";
  if (!c && !confirmada) return null;
  const agoraSP = { data: hojeISO(FUSO, agora), hora: horaNoFuso(agora, FUSO) };
  const naoComparecimentoApos = momentos ? diaHoraBr(momentos.naoComparecimentoApos, momentos.fuso) : "a tolerância de Configurações → Pagamento no site";
  const semPolitica = pagamento.aceite === null || pagamento.aceite?.diasReembolsoIntegral === null;
  const somenteFinanceiro = !editarFinanceiro && <p style={nota}>Esta reserva foi paga pelo site: o cancelamento com devolução é feito por quem cuida do financeiro.</p>;
  const formulario = (pedido: Parameters<typeof FormCancelamentoSite>[0]["pedido"]) =>
    editarReserva && editarFinanceiro && confirmada ? (
      <FormCancelamentoSite
        reservaId={reserva.id}
        calcular={calcularCancelamentoAcao}
        cancelar={cancelarReservaPagaAcao}
        pedido={pedido}
        agora={agoraSP}
        naoComparecimentoApos={naoComparecimentoApos}
        semPolitica={semPolitica}
        canais={CANAIS_DA_EQUIPE}
        motivosEmpresa={MOTIVOS_DA_EMPRESA}
        motivosExcecao={MOTIVOS_DA_EXCECAO}
      />
    ) : null;
  const secao = (filhos: ReactNode) => (
    <section aria-label="Cancelamento pela política" style={{ border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>Cancelamento pela política</strong>
      {filhos}
    </section>
  );

  // Sem pedido nem cancelamento: registrar o pedido que chegou por outro canal e, para o financeiro, cancelar.
  if (!c)
    return secao(
      <>
        {somenteFinanceiro}
        {editarReserva && <FormRegistrarPedido reservaId={reserva.id} acao={registrarPedidoCancelamentoAcao} agora={agoraSP} canais={CANAIS_DA_EQUIPE} />}
        {formulario(null)}
      </>,
    );

  const recebido = c.mensagens.recebido;
  // Pedido esperando a equipe.
  if (c.situacao === "pedido") {
    const site = c.canal === "site";
    const descarte = site ? (
      editarFinanceiro ? (
        <FormDescartarPedido
          reservaId={reserva.id}
          acao={descartarPedidoCancelamentoAcao}
          site
          agora={agoraSP}
          canais={CANAIS_DA_DESISTENCIA}
          pergunta={`Descartar o pedido de cancelamento feito pelo hóspede no site em ${diaHoraBr(c.pedidoRecebidoEm)}, como desistência dele? A reserva continua confirmada e o pedido fica no histórico.`}
        />
      ) : (
        <p style={nota}>Pedido feito pelo hóspede no site: só quem cuida do financeiro descarta, como desistência do hóspede.</p>
      )
    ) : editarReserva ? (
      <FormDescartarPedido
        reservaId={reserva.id}
        acao={descartarPedidoCancelamentoAcao}
        site={false}
        agora={agoraSP}
        canais={CANAIS_DA_DESISTENCIA}
        pergunta={`Descartar o pedido de cancelamento registrado em ${diaHoraBr(c.pedidoRecebidoEm)}? A reserva continua confirmada. Escreva o motivo.`}
      />
    ) : null;
    return secao(
      <>
        <Linhas
          linhas={[
            ["Pedido recebido em", momentoDoPedido(c)],
            ["Situação", "esperando a equipe decidir (a reserva continua confirmada)"],
            ...(recebido || c.avisados.pedido ? ([["Hóspede avisado", <Avisado key="pedido" reservaId={reserva.id} qual="pedido" marca={c.avisados.pedido} editar={editarReserva} />]] as [string, ReactNode][]) : []),
          ]}
        />
        {editarReserva && recebido && <Copiar m={recebido} rotulo="Copiar mensagem: pedido recebido" />}
        {somenteFinanceiro}
        {descarte}
        <Descartados c={c} />
        {formulario({
          site,
          data: hojeISO(FUSO, c.pedidoRecebidoEm),
          hora: horaNoFuso(c.pedidoRecebidoEm, FUSO),
          canal: site ? null : c.canal,
          descricao: site ? diaHoraBr(c.pedidoRecebidoEm) : `Registrado por ${c.pedidoPor ?? "a equipe"}: mudar a data ou a hora pede o motivo (fica registrado).`,
        })}
      </>,
    );
  }

  // Cancelada pela política. As devoluções deste cancelamento em cada pagamento que conta (M8.2d: depois de um aumento,
  // também a do pagamento da diferença; o restante de uma devolvida a menos); com uma só, a linha de sempre. Sem nenhuma
  // na lista do domínio, nada (a que manda no pagamento pode ser a de uma redução de antes); a tentativa montada à mão, sem
  // a lista, usa a que manda.
  const porPagamento = c.direito === "integral" ? devolucoesDoCancelamento(pagamentos ?? [pagamento], verValores, c.id) : [];
  const devolucao: ReactNode =
    c.direito !== "integral" ? null : porPagamento.length > 1 ? (
      <ul key="devolucoes" style={{ margin: 0, paddingLeft: 18 }}>
        {porPagamento.map((x) => (
          <li key={x.chave}>
            {x.rotulo}: {x.linha}
          </li>
        ))}
      </ul>
    ) : (
      (porPagamento[0]?.linha ?? (pagamento.devolucoes ? null : linhaDaDevolucao(pagamento, verValores)))
    );
  const linhas: [string, ReactNode][] = [
    ["Pedido recebido em", momentoDoPedido(c)],
    ["Quem cancelou", quemCancelou(c)],
    ["Cancelada em", c.canceladaEm ? `${diaHoraBr(c.canceladaEm)}${c.canceladaPor ? ` por ${c.canceladaPor}` : ""}` : "—"],
    ["Política", politica(c)],
    ["Decisão", `${decisao(c, verValores)}${verValores && c.direito === "integral" && c.valorADevolver !== null ? ` (${formatBRL(c.valorADevolver)})` : ""}`],
    ...(devolucao ? ([["Devolução", devolucao]] as [string, ReactNode][]) : []),
    ["Financeiro", financeiro(c)],
    ["Parte do proprietário", parteDoProprietario(c, reserva.checkin, verValores)],
    [
      "OTAs",
      c.ota ? (
        `datas reabertas em ${diaBr(c.ota.em)} por ${c.ota.por ?? "o sistema"}`
      ) : editarReserva ? (
        <form key="ota" action={marcarOtaLiberadaAcao} style={{ display: "inline" }}>
          <input type="hidden" name="reservaId" value={reserva.id} />
          reabra as datas nas OTAs (no Beds24, apague o bloqueio){" "}
          <BotaoConfirmar pergunta="Confirmar que as datas desta reserva já foram reabertas nas OTAs (no Beds24, o bloqueio foi apagado)?" style={botaoDiscreto}>
            Datas reabertas nas OTAs
          </BotaoConfirmar>
        </form>
      ) : (
        "datas ainda não marcadas como reabertas nas OTAs"
      ),
    ],
    ...(recebido || c.avisados.pedido ? ([["Hóspede avisado: pedido recebido", <Avisado key="pedido" reservaId={reserva.id} qual="pedido" marca={c.avisados.pedido} editar={editarReserva} />]] as [string, ReactNode][]) : []),
    ["Hóspede avisado: decisão", <Avisado key="decisao" reservaId={reserva.id} qual="decisao" marca={c.avisados.decisao} editar={editarReserva} podeCopiar={verValores} />],
    ...(c.mensagens.devolvida || c.avisados.devolucao
      ? ([["Hóspede avisado: devolução feita", <Avisado key="devolucao" reservaId={reserva.id} qual="devolucao" marca={c.avisados.devolucao} editar={editarReserva} podeCopiar={verValores} />]] as [string, ReactNode][])
      : []),
  ];
  return secao(
    <>
      <Linhas linhas={linhas} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {editarReserva && recebido && <Copiar m={recebido} rotulo="Copiar mensagem: pedido recebido" />}
        {verValores && c.mensagens.decidido && <Copiar m={c.mensagens.decidido} rotulo="Copiar mensagem: cancelamento" />}
        {verValores && c.mensagens.devolvida && <Copiar m={c.mensagens.devolvida} rotulo="Copiar mensagem: devolução feita" />}
      </div>
      <Descartados c={c} />
    </>,
  );
}
