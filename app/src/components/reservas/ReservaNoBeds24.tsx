/**
 * Ficha da reserva (M8.3a, desenho 8): a reserva paga pelo site no Beds24, só leitura e só para a equipe. Mostra a
 * situação e o motivo em linguagem simples, o id no Beds24, o quarto, a última conferência e o que foi lido, o histórico
 * curto das operações e, quando o ambiente deixa, o botão "Simular" (nada vai ao Beds24). O domínio devolve códigos; os
 * rótulos ficam aqui. Só o painel importa este componente: nada do hóspede nem do portal cita o Beds24.
 */
import styles from "@/components/formularios.module.css";
import { dataBr, dataHoraNoFuso } from "@/lib/datas";
import { simularReservaBeds24Acao } from "@/beds24/acoes-reservas";
import type { FichaReservaNoBeds24, MotivoDesligadaBeds24 } from "@/beds24/reservas-site-painel";
import type { MotivoSemSimulacao } from "@/beds24/reservas-site-simulacao";
import type { MotivoAcompanhamentoBeds24, SituacaoAcompanhamentoBeds24, SituacaoOperacaoBeds24, TipoOperacaoBeds24 } from "@/beds24/reservas-site-regras";
import type { EstadoBeds24 } from "@/beds24/tipos";

const quando = (d: Date) => dataHoraNoFuso(d);

export const NOMES_SITUACAO_NO_BEDS24: Record<SituacaoAcompanhamentoBeds24, string> = {
  pendente: "Envio a fazer",
  em_envio: "Sendo enviada",
  conferida: "Conferida: o Beds24 está igual ao SCL",
  divergente: "Diferente no Beds24",
  conflito: "Noites ocupadas por outra reserva",
  aguardando_equipe: "Aguardando a equipe",
  manual: "A equipe cuida à mão",
  encerrada: "Encerrada",
};

export const NOMES_MOTIVO_NO_BEDS24: Record<MotivoAcompanhamentoBeds24, string> = {
  sem_vinculo: "o imóvel não tem um vínculo único e válido com um quarto do Beds24",
  sem_credencial: "falta a credencial de escrita",
  escopo_excessivo: "a credencial tem permissões além das do convite (como apagar, tudo ou dados pessoais)",
  escopo_fora_de_ordem: "faltam permissões do convite na credencial, ou elas não deram para ler",
  sem_ensaio: "falta um ensaio conferido com a credencial atual",
  marca_ilegivel: "a marca do SCL não foi lida de volta no Beds24",
  anterior_a_ligar: "confirmada antes de o imóvel ser ligado",
  deixada_a_mao: "deixada à mão pela equipe",
  bloqueio_manual: "há um bloqueio feito à mão sobre as noites",
  bloqueio_do_scl: "há um bloqueio do próprio SCL sobre as noites",
  incerta: "envio sem confirmação: falta conferir se ficou gravado",
  duplicada: "há mais de um registro com a marca desta reserva",
  marca_em_registro_inesperado: "a marca está num registro que não bate com a reserva",
  sem_permissao: "a credencial não tem permissão de escrever reservas",
  recusada_pelo_beds24: "o Beds24 recusou o envio",
  sem_disponibilidade: "o Beds24 não mostrou as noites livres",
  noites_ocupadas: "as noites estão ocupadas por outra reserva",
  falhas: "cinco falhas seguidas",
  mudada_no_beds24: "mudada no Beds24 por fora",
  cancelada_no_beds24: "cancelada no Beds24 por fora",
  apagada_no_beds24: "apagada no Beds24",
};

const DESLIGADA: Record<MotivoDesligadaBeds24, string> = {
  ambiente: "aqui não é o deploy de produção (prévia, computador ou teste)",
  chave: "a chave BEDS24_ESCRITA_RESERVAS não está ligada",
  credencial: "falta o refresh token",
  pausa: "a pausa geral está ligada em Integrações",
  imovel: "o imóvel não está ligado em Integrações",
  sem_acompanhamento: "o sistema ainda não acompanha esta reserva",
};

const TIPO: Record<TipoOperacaoBeds24, string> = { criar: "Criar", atualizar: "Atualizar", cancelar: "Cancelar", vincular: "Vincular", ensaio: "Ensaio" };
const SITUACAO_OPERACAO: Record<SituacaoOperacaoBeds24, string> = {
  pendente: "pendente",
  enviando: "enviando",
  incerta: "sem confirmação",
  feita: "feita",
  conferida: "conferida",
  divergente: "diferente",
  conflito: "conflito",
  recusada: "recusada",
  falhou: "falhou",
  superada: "substituída",
  simulada: "simulada (nada enviado)",
};
const SITUACAO_LIDA: Record<EstadoBeds24, string> = { confirmada: "confirmada", pendente: "pendente", cancelada: "cancelada", bloqueio: "bloqueio", consulta: "consulta", pedido: "pedido" };

/** Por que nada foi simulado, em palavras. */
const SEM_SIMULACAO: Record<MotivoSemSimulacao, string> = {
  outra_fonte: "não é uma reserva do site",
  pedido: "ainda é um pedido (datas seguradas): nunca vai ao Beds24",
  nao_confirmada: "a reserva não está confirmada",
  sem_pagamento: "não há pagamento pelo site que confirmou a reserva (confirmada à mão: feche as datas à mão)",
  sem_contrato: "o imóvel não tem contrato vigente na entrada: confira o contrato",
  marketplace: "o contrato é de marketplace: fica de fora até o M12.2",
  manual: "a equipe cuida desta reserva à mão",
  encerrada: "o acompanhamento já foi encerrado",
  estadia_terminou: "a estadia já terminou",
  imovel_desligado: "o imóvel não está ligado",
  sem_hospedes: "falta o número de pessoas na reserva",
  ja_no_beds24: "a reserva está ligada a um registro do Beds24 que o sistema não criou",
  aguardando_equipe: "a reserva aguarda a equipe",
  divergente: "a reserva está diferente no Beds24: a atualização automática fica suspensa",
  sem_mudanca: "nada mudou desde o último envio",
  cancelada_sem_decisao: "cancelada sem o cancelamento pela política",
  cancelada_sem_beds24: "cancelada sem reserva criada pelo sistema no Beds24: nada a cancelar lá",
  anterior_a_ligar: "confirmada antes de o imóvel ser ligado: a equipe cuida à mão",
  sem_vinculo: "o imóvel não tem um vínculo único e válido com um quarto do Beds24",
  fora_do_ambiente: "simular só vale fora do deploy de produção ou com a chave das reservas desligada",
  nao_encontrada: "reserva não encontrada",
};

const SIMULADA = "Simulação gravada: o pedido no histórico abaixo é o que seria enviado ao Beds24. Nada foi enviado.";
const REPETIDA = "Nada mudou desde a última simulação: o pedido é o mesmo do histórico abaixo. Nada foi enviado.";
/** Imóvel desligado e a criação sairia depois de ligar (o acompanhamento já existe). */
const IMOVEL_DESLIGADO = " O imóvel não está ligado em Integrações: no deploy de produção, esta criação só sairia depois de ele ser ligado.";
/** Imóvel desligado e ligar agora não vale para ela: confirmada antes da ligação (D6), fica com a equipe. */
const IMOVEL_DESLIGADO_ANTERIOR =
  " O imóvel não está ligado em Integrações: a simulação considerou o imóvel ligado antes da confirmação. Ligar agora só vale para as reservas confirmadas depois da ligação, então esta continua com a equipe, à mão.";

/** As chaves de `chaveDoResultadoDaSimulacao` quando algo foi simulado. */
const SIMULACAO: Record<string, string> = {
  simulada: SIMULADA,
  simulada_imovel_desligado: SIMULADA + IMOVEL_DESLIGADO,
  simulada_imovel_desligado_anterior: SIMULADA + IMOVEL_DESLIGADO_ANTERIOR,
  repetida: REPETIDA,
  repetida_imovel_desligado: REPETIDA + IMOVEL_DESLIGADO,
  repetida_imovel_desligado_anterior: REPETIDA + IMOVEL_DESLIGADO_ANTERIOR,
};

/** O texto do resultado do "Simular" (`?beds24=`); chave desconhecida = nada. */
export function textoDaSimulacao(chave: string | undefined): string | null {
  if (!chave) return null;
  if (Object.hasOwn(SIMULACAO, chave)) return SIMULACAO[chave];
  const motivo = chave.startsWith("nada_") ? chave.slice(5) : "";
  return Object.hasOwn(SEM_SIMULACAO, motivo) ? `Nada seria enviado ao Beds24: ${SEM_SIMULACAO[motivo as MotivoSemSimulacao]}.` : null;
}

/**
 * O que a equipe faz à mão enquanto o sistema não escreve reservas. O pedido com as datas seguradas nunca vai ao Beds24 e
 * as datas dele não são fechadas nas OTAs (D9); o pedido vencido sem pagamento nunca teve nada fechado.
 */
const AS_MAO: Record<NonNullable<FichaReservaNoBeds24["pedido"]> | "reserva", string> = {
  reserva: "Por enquanto, o sistema não escreve reservas no Beds24: feche e abra as datas à mão, como hoje.",
  segurado: "É um pedido com as datas seguradas: ele não vai ao Beds24, e as datas não devem ser fechadas à mão nas OTAs enquanto estiverem seguradas.",
  vencido: "O pedido venceu sem pagamento: ele nunca foi ao Beds24 e as datas dele não precisaram ser fechadas nas OTAs. Nada a fazer.",
};

type Props = {
  reservaId: string;
  ficha: FichaReservaNoBeds24;
  /** `reserva:editar`: o botão "Simular" (quando o ambiente deixa). */
  editar: boolean;
  /** A chave do resultado do "Simular" (`?beds24=`). */
  resultado?: string;
};

export function ReservaNoBeds24({ reservaId, ficha, editar, resultado }: Props) {
  const a = ficha.acompanhamento;
  const texto = textoDaSimulacao(resultado);
  const linhas: [string, string][] = a
    ? [
        ["Situação", `${NOMES_SITUACAO_NO_BEDS24[a.situacao]}${a.motivo ? `: ${NOMES_MOTIVO_NO_BEDS24[a.motivo]}` : ""}`],
        ["Id no Beds24", ficha.beds24Id ?? "ainda não tem"],
        ["Quarto no Beds24", a.quarto ?? "ainda não escolhido"],
        ["Última conferência", a.conferidaEm ? quando(a.conferidaEm) : "nenhuma ainda"],
        [
          "O que foi lido",
          a.lidoEm
            ? a.lido
              ? `${quando(a.lidoEm)}: quarto ${a.lido.quarto}, ${dataBr(a.lido.chegada)} → ${dataBr(a.lido.saida)}, ${a.lido.hospedes ?? "?"} pessoa(s), ${SITUACAO_LIDA[a.lido.situacao]}`
              : `${quando(a.lidoEm)}: o registro não voltou na leitura`
            : "nada lido ainda",
        ],
        ["Datas fechadas nas OTAs", a.otaFechadaEm ? `${quando(a.otaFechadaEm)} (${a.otaFechadaAMao ? "marcado pela equipe" : "pelo sistema"})` : "não marcado"],
      ]
    : [["Id no Beds24", ficha.beds24Id ?? "nenhum"]];
  return (
    <section aria-label="Reserva no Beds24" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: "1.25rem" }}>No Beds24</h2>
      {texto && (
        <p role="status" className={styles.sucesso}>
          {texto}
        </p>
      )}
      <p style={{ margin: 0 }}>
        Envio automático ao Beds24:{" "}
        {ficha.desligada.length ? (
          <>
            <strong>desligado</strong> ({ficha.desligada.map((m) => DESLIGADA[m]).join("; ")}).
          </>
        ) : (
          <strong>ligado</strong>
        )}{" "}
        {AS_MAO[ficha.pedido ?? "reserva"]}
      </p>
      <dl className={styles.form} style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "8px 16px" }}>
        {linhas.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {ficha.operacoes.length > 0 && (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <caption>Operações (as {ficha.operacoes.length} mais recentes)</caption>
            <thead>
              <tr>
                <th>Quando</th>
                <th>O quê</th>
                <th>Situação</th>
                <th>Pedido</th>
                <th>Id no Beds24</th>
              </tr>
            </thead>
            <tbody>
              {ficha.operacoes.map((o) => (
                <tr key={o.id}>
                  <td>{quando(o.terminadoEm ?? o.iniciadoEm)}</td>
                  <td>
                    {TIPO[o.tipo]}
                    {o.modo === "simulacao" ? " (simulação)" : ""}
                  </td>
                  <td>
                    {SITUACAO_OPERACAO[o.situacao]}
                    {o.erro ? `: ${o.erro}` : ""}
                  </td>
                  <td>
                    {o.pedido
                      ? `quarto ${o.pedido.quarto}, ${dataBr(o.pedido.chegada)} → ${dataBr(o.pedido.saida)}, ${o.pedido.hospedes ?? "?"} pessoa(s), ${o.pedido.situacao}, marca ${o.pedido.referencia}`
                      : "—"}
                  </td>
                  <td>{o.beds24Id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editar && ficha.simular && (
        <form action={simularReservaBeds24Acao}>
          <input type="hidden" name="reservaId" value={reservaId} />
          <p style={{ margin: "0 0 8px", color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>
            Simular mostra o que o sistema mandaria ao Beds24 para esta reserva (quarto, datas, pessoas, situação e a marca), só com o que está no SCL. Nada
            é enviado e nada muda na reserva.
          </p>
          <button type="submit" className={styles.botao}>
            Simular
          </button>
        </form>
      )}
    </section>
  );
}
