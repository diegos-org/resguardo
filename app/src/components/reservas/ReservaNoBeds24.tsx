/**
 * Ficha da reserva (M8.3a, desenho 8): a reserva paga pelo site no Beds24, só para a equipe. Mostra a situação e o motivo
 * em linguagem simples, o id no Beds24, o quarto, a última conferência e o que foi lido, o histórico curto das operações e,
 * quando o ambiente deixa, o botão "Simular" (nada vai ao Beds24). M8.3b: o que fazer à mão nas OTAs para esta reserva (o
 * mesmo texto do Início, de `tarefasDasOtas`) e as marcas "Datas fechadas nas OTAs" (D8) e "Datas reabertas nas OTAs" (a
 * confirmada à mão, cancelada), com `BotaoConfirmar`. M8.3c (bloco G; plano 1.15): os botões do envio — "Conferir agora",
 * "Tentar de novo", "Deixar à mão", "Reenviar o que está no SCL" (`reserva:editar`) e "Não existe, pode criar", "Vincular o
 * id" e "Passar ao sistema" (também `configuracao:editar`: a operação não os vê) —, só os que valem para a reserva agora (a
 * regra do domínio, `botoesDaFichaBeds24`), com o resultado em `?beds24=`; e a frase "o sistema faz isso sozinho" (6.2) quando
 * cabe. O domínio devolve códigos e os textos das tarefas; os rótulos ficam aqui. Só o painel importa este componente: nada
 * do hóspede nem do portal cita o Beds24.
 */
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { dataBr, dataHoraNoFuso, diaMesBr } from "@/lib/datas";
import {
  conferirAgoraBeds24Acao, deixarAMaoBeds24Acao, marcarDatasFechadasNasOtasAcao, marcarDatasReabertasNasOtasAcao, naoExisteNoBeds24Acao, passarAoSistemaBeds24Acao, reenviarAoBeds24Acao, simularReservaBeds24Acao,
  tentarDeNovoBeds24Acao, vincularIdDoBeds24Acao,
} from "@/beds24/acoes-reservas";
import type { ResultadoDoBotaoBeds24 } from "@/beds24/reservas-site-botoes";
import type { MotivoDesligadaBeds24 } from "@/beds24/reservas-site-config";
import type { FichaReservaNoBeds24 } from "@/beds24/reservas-site-painel";
import type { MotivoSemSimulacao } from "@/beds24/reservas-site-simulacao";
import { BOTOES_DE_CONFIGURACAO_BEDS24, type BotaoDaFichaBeds24, type MotivoAcompanhamentoBeds24, type SituacaoAcompanhamentoBeds24, type SituacaoOperacaoBeds24, type TipoOperacaoBeds24 } from "@/beds24/reservas-site-regras";
import { type AtencaoOta, fraseDoEnvioAutomatico, type TarefaOta } from "@/beds24/reservas-site-tarefas";
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
  sem_pagamento: "não há pagamento pelo site que confirmou a reserva (confirmada à mão: feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs)",
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
  envio_em_curso: "há um envio desta reserva ao Beds24 ainda sem confirmação (em curso ou incerto); a simulação só vale depois da conferência",
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

/** O resultado das marcas manuais (`?beds24=`); chave desconhecida = nada. */
const MARCAS: Record<string, string> = {
  ota_fechada: "Datas marcadas como fechadas nas OTAs.",
  ota_reaberta: "Datas marcadas como reabertas nas OTAs.",
};

/**
 * O resultado dos botões do envio (M8.3c, `?beds24=`), com o estilo: `sucesso` quando resolveu, senão aviso (avisar em vez
 * de supor). Chave desconhecida = nada.
 */
const BOTOES: Record<ResultadoDoBotaoBeds24, { texto: string; ok: boolean }> = {
  conferido: { ok: true, texto: "Conferido no Beds24: a reserva está como no SCL." },
  diferente: { ok: false, texto: "Conferido no Beds24: a reserva está diferente lá. Veja o que foi lido abaixo." },
  equipe: { ok: false, texto: "Conferido no Beds24: a reserva continua esperando a equipe. Veja a situação abaixo." },
  overbooking: { ok: false, texto: "O Beds24 ainda informa overbooking nas noites desta reserva: resolva com o hóspede ou com o canal." },
  lido: { ok: false, texto: "A leitura do Beds24 ficou gravada (veja o que foi lido abaixo); a situação continua a mesma." },
  sem_conclusao: { ok: false, texto: "A leitura do Beds24 não concluiu: nada mudou. Tente de novo em alguns minutos." },
  aguarde: { ok: false, texto: "Ainda não deu 5 minutos desde o envio: o Beds24 ainda pode gravar. Confira de novo daqui a pouco." },
  nova_tentativa: { ok: true, texto: "O sistema envia esta reserva de novo ao Beds24 em até 10 minutos." },
  descartado: { ok: false, texto: "A reserva mudou no meio (outra ação ou a rotina): nada foi gravado. Confira a situação abaixo." },
  na_fila: { ok: true, texto: "Na fila: o sistema envia ao Beds24 em até 10 minutos, com a conferência antes." },
  a_mao: { ok: true, texto: "Deixada à mão: o sistema não escreve mais esta reserva no Beds24. Siga as tarefas abaixo e os avisos do Início." },
  vinculado: { ok: true, texto: "Vinculado e conferido: a reserva está ligada ao registro do Beds24, e as datas foram marcadas como fechadas nas OTAs." },
  vinculado_diferente: { ok: false, texto: "Vinculado, mas o registro do Beds24 está diferente da reserva: veja o que foi lido abaixo." },
  vinculado_sem_marca: { ok: false, texto: "Vinculado sem a marca (a credencial não lê a marca): o sistema não marcou as datas nas OTAs. Confira à mão." },
};

/** O texto do resultado de um botão do envio (`?beds24=`); chave desconhecida = null. */
export function textoDoBotao(chave: string | undefined): { texto: string; ok: boolean } | null {
  return chave && Object.hasOwn(BOTOES, chave) ? BOTOES[chave as ResultadoDoBotaoBeds24] : null;
}

/**
 * O pedido com as datas seguradas nunca vai ao Beds24 e as datas dele não são fechadas nas OTAs (D9); o pedido vencido sem
 * pagamento nunca teve nada fechado. As outras reservas seguem as tarefas das OTAs.
 */
const AS_MAO: Record<NonNullable<FichaReservaNoBeds24["pedido"]>, string> = {
  segurado: "É um pedido com as datas seguradas: ele não vai ao Beds24, e as datas não devem ser fechadas à mão nas OTAs enquanto estiverem seguradas.",
  vencido: "O pedido venceu sem pagamento: ele nunca foi ao Beds24 e as datas dele não precisaram ser fechadas nas OTAs. Nada a fazer.",
};
const NADA_A_FAZER = "Nada a fazer à mão nas OTAs para esta reserva agora.";

/** O que pede atenção, no lugar das tarefas (nunca "feche como bloqueio" sobre noites já ocupadas). */
const ATENCAO: Record<AtencaoOta, string> = {
  conflito: "As noites estão ocupadas por outra reserva no Beds24 (possível venda dupla): não feche como bloqueio sobre elas; decida com a equipe.",
  divergente: "A reserva está diferente no Beds24: confira o que foi lido antes de mexer à mão.",
  aguardando_equipe: "A reserva aguarda a equipe no Beds24: confira a situação abaixo.",
  transicao: "Há um bloqueio feito à mão sobre as noites no Beds24: o sistema não cria por cima e não apaga o bloqueio.",
  ja_no_beds24: "A reserva está ligada a um registro do Beds24 que o sistema não criou: confira o registro antes de mexer à mão.",
};

/** O texto de cada tarefa na ficha: o manual (6.2) ou o que o sistema está fazendo, com a frase da 6.2 na atrasada (quando cabe). */
function textoNaFicha(t: TarefaOta, automatico: boolean): string {
  if (t.estado === "sendo_enviada") return "O sistema está enviando esta reserva ao Beds24: não feche nem mude as datas à mão.";
  if (t.estado === "atrasada") {
    const frase = fraseDoEnvioAutomatico(automatico, { estado: "atrasada" });
    return `O envio desta reserva ao Beds24 está atrasado (mais de 30 minutos): confira o histórico abaixo antes de mexer à mão.${frase ? ` ${frase}` : ""}`;
  }
  return t.texto;
}

/** Um botão do envio que não pede confirmação (só lê, ou só enfileira de novo o que a equipe já tinha mandado). */
function Simples({ acao, reservaId, rotulo, nome }: { acao: (form: FormData) => Promise<void>; reservaId: string; rotulo: string; nome: string }) {
  return (
    <form action={acao} style={{ display: "inline" }}>
      <input type="hidden" name="reservaId" value={reservaId} />
      <button type="submit" className={styles.botao} aria-label={nome}>
        {rotulo}
      </button>
    </form>
  );
}

/** Um botão do envio com `BotaoConfirmar` (desenho 8). */
function Confirmado({ acao, reservaId, rotulo, pergunta }: { acao: (form: FormData) => Promise<void>; reservaId: string; rotulo: string; pergunta: string }) {
  return (
    <form action={acao} style={{ display: "inline" }}>
      <input type="hidden" name="reservaId" value={reservaId} />
      <BotaoConfirmar pergunta={pergunta} className={styles.botao}>
        {rotulo}
      </BotaoConfirmar>
    </form>
  );
}

/**
 * Os botões do envio que valem para a reserva agora (`ficha.acoes.botoes`, a regra do domínio), só com a permissão de cada um:
 * `reserva:editar` para todos e `configuracao:editar` também para "Não existe, pode criar", "Vincular" e "Passar ao sistema"
 * (o servidor recusa do mesmo jeito). "Tentar de novo" e "Conferir agora" não pedem confirmação (desenho 8).
 */
function BotoesDoEnvio({ reservaId, ficha, editar, configurar }: { reservaId: string; ficha: FichaReservaNoBeds24; editar: boolean; configurar: boolean }) {
  const { acoes } = ficha;
  const pode = (b: BotaoDaFichaBeds24) => editar && acoes.botoes.includes(b) && (!BOTOES_DE_CONFIGURACAO_BEDS24.includes(b) || configurar);
  const algum = acoes.botoes.some(pode);
  if (!algum) return null;
  return (
    <div aria-label="Envio ao Beds24" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {pode("conferir_agora") && <Simples acao={conferirAgoraBeds24Acao} reservaId={reservaId} rotulo="Conferir agora" nome="Conferir agora no Beds24" />}
        {pode("tentar_de_novo") && <Simples acao={tentarDeNovoBeds24Acao} reservaId={reservaId} rotulo="Tentar de novo" nome="Tentar de novo o envio ao Beds24" />}
        {pode("reenviar") && (
          <Confirmado
            acao={reenviarAoBeds24Acao}
            reservaId={reservaId}
            rotulo="Reenviar o que está no SCL"
            pergunta="Reenviar ao Beds24 as datas e as pessoas que estão no SCL? O que foi mudado lá por fora é substituído; antes, o sistema confere se as noites novas estão livres. O envio sai em até 10 minutos."
          />
        )}
        {pode("nao_existe") && (
          <Confirmado
            acao={naoExisteNoBeds24Acao}
            reservaId={reservaId}
            rotulo="Não existe, pode criar"
            pergunta="Confirmar que esta reserva NÃO está no Beds24 (você conferiu lá, pelo quarto e pelas datas)? O sistema a cria de novo em até 10 minutos; se ela existir lá, fica duplicada."
          />
        )}
        {pode("passar_ao_sistema") && (
          <Confirmado
            acao={passarAoSistemaBeds24Acao}
            reservaId={reservaId}
            rotulo="Passar ao sistema"
            pergunta="Passar esta reserva ao sistema? Ele confere no Beds24 que não há bloqueio nem outra reserva nas noites e cria a reserva lá em até 10 minutos. Se você fechou as datas à mão como bloqueio, desfaça antes (mude para Cancelado, sem apagar)."
          />
        )}
        {pode("deixar_a_mao") && (
          <Confirmado
            acao={deixarAMaoBeds24Acao}
            reservaId={reservaId}
            rotulo="Deixar à mão"
            pergunta="Deixar esta reserva à mão? Depois disso o sistema nunca mais a escreve no Beds24: a equipe fecha, muda e reabre as datas à mão, pelos avisos do Início."
          />
        )}
      </div>
      {acoes.duplicadas.length > 0 && <p style={{ margin: 0 }}>Registros com a marca desta reserva no Beds24: {acoes.duplicadas.join(", ")}. Cancele no Beds24 os que sobram (não apague) e use Conferir agora.</p>}
      {pode("vincular") && (
        <form action={vincularIdDoBeds24Acao} className={styles.form} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
          <input type="hidden" name="reservaId" value={reservaId} />
          <label>
            Já existe no Beds24: o id da reserva lá
            <input name="beds24Id" required maxLength={64} pattern="[A-Za-z0-9._:\-]{1,64}" defaultValue={acoes.candidato ?? ""} />
          </label>
          {acoes.vincularSemMarca && (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" name="semMarca" value="sim" />
              Vincular sem a marca (a credencial não lê a marca: confira no Beds24 que é esta reserva)
            </label>
          )}
          <BotaoConfirmar
            pergunta="Vincular esta reserva ao registro informado do Beds24? O sistema relê o registro e confere a situação, o quarto, as datas e a marca antes de ligar."
            className={styles.botao}
          >
            Vincular o id
          </BotaoConfirmar>
        </form>
      )}
      {acoes.candidato && pode("vincular") && <p style={{ margin: 0, color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>O id sugerido ({acoes.candidato}) é o registro sem marca nas mesmas datas e quarto: confira no Beds24 antes de vincular.</p>}
    </div>
  );
}

/** O botão da marca manual da tarefa (reserva:editar), com a pergunta do `BotaoConfirmar`. */
function Marca({ reservaId, t }: { reservaId: string; t: TarefaOta }) {
  const datas = `${diaMesBr(t.checkin)} a ${diaMesBr(t.checkout)}`;
  if (t.marca === "datas_fechadas")
    return (
      <form action={marcarDatasFechadasNasOtasAcao} style={{ display: "inline" }}>
        <input type="hidden" name="reservaId" value={reservaId} />
        <BotaoConfirmar pergunta={`Confirmar que as datas desta reserva (${datas}) já foram fechadas nas OTAs (no Beds24, como bloqueio)? Depois disso o sistema nunca cria esta reserva no Beds24.`}>
          Datas fechadas nas OTAs
        </BotaoConfirmar>
      </form>
    );
  if (t.marca === "datas_reabertas")
    return (
      <form action={marcarDatasReabertasNasOtasAcao} style={{ display: "inline" }}>
        <input type="hidden" name="reservaId" value={reservaId} />
        <BotaoConfirmar pergunta={`Confirmar que as datas desta reserva (${datas}) já foram reabertas nas OTAs (no Beds24, o bloqueio mudado para Cancelado, sem apagar)?`}>
          Datas reabertas nas OTAs
        </BotaoConfirmar>
      </form>
    );
  return null;
}

type Props = {
  reservaId: string;
  ficha: FichaReservaNoBeds24;
  /** `reserva:editar`: o botão "Simular" (quando o ambiente deixa), as marcas manuais das OTAs e os botões do envio. */
  editar: boolean;
  /** M8.3c: `configuracao:editar` (hoje, só o admin): também "Não existe, pode criar", "Vincular" e "Passar ao sistema". */
  configurar?: boolean;
  /** A chave do resultado do "Simular", de uma marca ou de um botão do envio (`?beds24=`). */
  resultado?: string;
};

export function ReservaNoBeds24({ reservaId, ficha, editar, configurar = false, resultado }: Props) {
  const a = ficha.acompanhamento;
  const texto = textoDaSimulacao(resultado);
  const marcada = resultado && Object.hasOwn(MARCAS, resultado) ? MARCAS[resultado] : null;
  const doBotao = textoDoBotao(resultado);
  // A frase da 6.2 também nas atenções de falha, recusa e incerteza do envio (plano, P5), com o envio automático ligado.
  const fraseDaAtencao = fraseDoEnvioAutomatico(ficha.acoes.automatico, { motivo: a?.motivo ?? null });
  const fechar = ficha.tarefas.some((t) => t.caso === "paga" || t.caso === "d3");
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
        // A reserva marcada à mão e cancelada pelo botão de sempre: "Datas reabertas nas OTAs" encerra o acompanhamento.
        ...(a.situacao === "encerrada" && a.otaFechadaAMao ? ([["Datas reabertas nas OTAs", "marcado pela equipe (data e autor no histórico da reserva)"]] as [string, string][]) : []),
      ]
    : [["Id no Beds24", ficha.beds24Id ?? "nenhum"], ...(fechar ? ([["Datas fechadas nas OTAs", "não marcado"]] as [string, string][]) : [])];
  return (
    <section aria-label="Reserva no Beds24" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: "1.25rem" }}>No Beds24</h2>
      {texto && (
        // Só a simulação gravada é sucesso; "Nada seria enviado" é um aviso (avisar em vez de supor).
        <p role="status" className={resultado && Object.hasOwn(SIMULACAO, resultado) ? styles.sucesso : styles.alerta}>
          {texto}
        </p>
      )}
      {marcada && (
        <p role="status" className={styles.sucesso}>
          {marcada}
        </p>
      )}
      {doBotao && (
        <p role="status" className={doBotao.ok ? styles.sucesso : styles.alerta}>
          {doBotao.texto}
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
        )}
        {ficha.pedido ? ` ${AS_MAO[ficha.pedido]}` : ""}
      </p>
      {!ficha.pedido && (
        <div aria-label="Nas OTAs" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ficha.atencoes.map((x) => (
            <p key={x.tipo} role="note" className={styles.alerta} style={{ margin: 0 }}>
              {ATENCAO[x.tipo]}
              {x.tipo === "aguardando_equipe" && fraseDaAtencao ? ` ${fraseDaAtencao}` : ""}
            </p>
          ))}
          {ficha.tarefas.map((t) => (
            <div key={t.caso}>
              {textoNaFicha(t, ficha.acoes.automatico)} {editar && <Marca reservaId={reservaId} t={t} />}
            </div>
          ))}
          {!ficha.atencoes.length && !ficha.tarefas.length && <p style={{ margin: 0 }}>{NADA_A_FAZER}</p>}
        </div>
      )}
      {!ficha.pedido && <BotoesDoEnvio reservaId={reservaId} ficha={ficha} editar={editar} configurar={configurar} />}
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
