/**
 * A disputa do pagamento no site na tela do painel (M8.2e; desenho "Painel"): o bloco **Disputa** de cada linha do quadro
 * "Pagamento no site" da ficha — o cabeçalho por tipo, a situação em palavras, o valor em disputa e o valor em risco (com
 * a conta), o que o Mercado Pago mostra, a verificação do banco, a linha do tempo, a decisão, os lançamentos de cada lado
 * e do caixa, a devolução substituída, os avisos, o prazo dos documentos e as ações que o domínio permite agora —, tudo em
 * textos prontos: o formulário do navegador só mostra, nunca calcula nem decide. E os textos de cada resultado
 * (`?contestacao=`) e a página "Documentos para a defesa". Nada daqui é gravado.
 *
 * Duas leituras, deny-by-default no servidor:
 * - `lerContestacoesDaEquipe` (financeiro:ler **e** papel diferente de `proprietario` — o papel proprietário tem
 *   financeiro:ler, mas a leitura da equipe nunca é dele: o portal usa `contestacoesDoProprietario`, com lista branca);
 * - `lerContestacoesDaOperacao` (reserva:ler): o tipo, a situação, as datas e o prazo dos documentos, sem valores, sem
 *   notas, sem motivo, decisão, lançamentos nem linha do tempo.
 * O id do pagamento e o da disputa vindos do formulário são resolvidos na empresa da sessão (`reservaDoPagamento`,
 * `reservaDaContestacao`) antes de qualquer outra coisa.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { AcessoNegado, podeFazer, type Sessao } from "@/acesso/politica";
import { DOCUMENTO_COMO_FUNCIONA, lerComoFunciona } from "@/configuracoes/como-funciona";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { lerPaginaLegal } from "@/configuracoes/paginas-legais";
import { type Bloco, blocosDoDocumento, PAGINAS_LEGAIS, preencherCampos } from "@/configuracoes/paginas-legais-texto";
import { aceitesDocumento, contestacoesPagamento, devolucoesPagamento, eventosContestacao, imoveis, limpezas, manutencoes, pagamentos, portariaChecklists, reservas, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { dataBr, diaHoraNoFuso, diaMesBr, diaMesNoFuso, hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { imoveisComPortaria } from "@/portaria/portaria";
import { partesDoProprietario } from "@/repasses/extrato";
import { aceitesDaReserva, politicaDoPagamento } from "@/site/aceites";
import { desdeADefesa, desdeAberturaDaDisputa, type FatosDaDecisao, type FatosDoResultado, previaDaDecisao, previaDoResultado } from "./contestacao";
import { type LinhaDaDisputa, livroDaDisputa, retidoRealizado } from "./contestacao-acerto";
import {
  avisoDeContestacao,
  CODIGOS_CAUSA_CONTESTACAO,
  type CodigoCausaContestacao,
  confirmacaoReforcadaDaDecisao,
  contestacaoNaoFinal,
  type EstadoConhecidoContestacao,
  fraseDaCausa,
  leituraEmDisputa,
  NOMES_QUEM_ARCA,
  NOMES_SITUACAO_CONTESTACAO,
  NOMES_TIPO_CONTESTACAO,
  perguntaDaDecisao,
  prefixoDaContestacao,
  QUEM_ARCA_CONTESTACAO,
  type QuemArcaContestacao,
  quemArcaPelaRegra,
  type SituacaoContestacao,
  TEXTO_COBERTURA_A_CONFERIR,
  TEXTO_DIVISAO_MUDOU,
  TEXTO_NADA_A_DIVIDIR,
  TEXTO_PAGAMENTO_SEM_RESERVA,
  TEXTO_REGISTRADA_A_MAO,
  TEXTO_RESULTADO_SEM_LEITURA,
  TEXTO_SEM_COMO_FUNCIONA,
  TEXTO_VERIFICACAO_TENTADA,
  textoDaOrigemDaContestacao,
  type TextosDasCausas,
  type TipoContestacao,
  valorSeguradoDesatualizado,
} from "./contestacao-regras";
import { AVISOS_PAGAMENTO, textoContestacaoComDevolucao, textoContestacaoValorAcima, textoContestacaoValorMudou } from "./situacoes";
import type { Contestacao, Devolucao, Pagamento } from "./travas";

const FUSO = "America/Sao_Paulo";
const DIA_MS = 86_400_000;
/** dd/mm de um instante (São Paulo). */
const diaBr = (d: Date) => diaMesNoFuso(d, FUSO);
/** dd/mm às HH:MM (São Paulo). */
const diaHoraBr = (d: Date) => diaHoraNoFuso(d, FUSO);
/** Dias entre duas datas AAAA-MM-DD (de → até). */
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);
const nDias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;
const comSinal = (n: number) => (n > 0 ? `+${formatBRL(n)}` : formatBRL(n));
/** Um texto de regra ("registrada à mão: …") como frase: inicial maiúscula e ponto final. */
const emFrase = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;

// ---------------------------------------------------------------- os resultados das ações (?contestacao=)

/** O que a ficha mostra depois de cada ação da disputa (o endereço leva só a chave; o texto é este). */
export const RESULTADOS_DA_CONTESTACAO = {
  registrada: "Disputa registrada no quadro do pagamento: o sistema confere pela leitura do Mercado Pago quando puder.",
  registrada_duplicata: "Registrada como possível duplicata de outra disputa do pagamento: confirme que é outra disputa no quadro (ou encerre sem efeito).",
  debito: "Débito do Mercado Pago confirmado: o valor em disputa saiu do caixa na data informada.",
  decisao: "Quem arca registrado: o valor do proprietário fica segurado nos próximos repasses até o resultado; a perda prevista da SCL entrou no financeiro.",
  decisao_definitiva: "Quem arca registrado: a disputa já estava perdida, e o desconto e a perda ficaram definitivos no mês corrente.",
  decisao_mudada: "Decisão mudada: a diferença de cada lado entrou no mês corrente.",
  valor_atualizado: "Valor segurado atualizado com o valor em disputa de agora: a diferença de cada lado entrou no mês corrente.",
  outra_disputa: "Confirmado que é outra disputa: ela passa a segurar o valor dela.",
  documentos: "Documentos marcados como enviados no painel do Mercado Pago.",
  prazo: "Prazo dos documentos informado.",
  ganha: "Resultado confirmado: a SCL ganhou a disputa. O valor segurado do proprietário volta no repasse seguinte.",
  perdida: "Resultado confirmado: a SCL perdeu a disputa.",
  sem_efeito: "Disputa encerrada sem efeito: os lançamentos previstos dela foram desfeitos no mês corrente.",
  aviso_conferido: "Aviso conferido: a disputa continua encerrada.",
  reaberta: "A disputa foi reaberta: a rodada seguinte está no quadro e segue o fluxo inteiro.",
  cancelada: "Reserva cancelada sem devolução pelo sistema: o valor fica retido até o resultado da disputa. Reabra as datas nas OTAs.",
} as const;
export type ResultadoDaContestacao = keyof typeof RESULTADOS_DA_CONTESTACAO;

/** O texto de um resultado vindo do endereço (só as chaves conhecidas; o resto não mostra nada). */
export function textoDoResultadoDaContestacao(v: unknown): string | null {
  return typeof v === "string" && Object.hasOwn(RESULTADOS_DA_CONTESTACAO, v) ? RESULTADOS_DA_CONTESTACAO[v as ResultadoDaContestacao] : null;
}

// ---------------------------------------------------------------- textos puros

/** "Contestação no cartão — aberta em dd/mm" (e "rodada 2" quando há). */
export function cabecalhoDaDisputa(l: Pick<Contestacao, "tipo" | "abertaEm" | "abertaNoProvedorEm" | "rodada">): string {
  return `${NOMES_TIPO_CONTESTACAO[l.tipo]} — aberta em ${diaBr(l.abertaNoProvedorEm ?? l.abertaEm)}${l.rodada > 1 ? ` (rodada ${l.rodada})` : ""}`;
}

/** A disputa perdida que ainda espera a decisão de quem arca (a reserva continua em conferência). */
const perdidaSemDecisao = (l: Pick<Contestacao, "situacao" | "decisaoVersao" | "definitivoEm">) => l.situacao === "perdida" && l.decisaoVersao === 0 && l.definitivoEm === null;

/** A situação em palavras: aberta; encerrada no Mercado Pago, resultado a conferir; ganha; perdida; encerrada sem efeito. */
export function situacaoDaDisputaEmPalavras(l: Pick<Contestacao, "situacao" | "resultadoEm" | "decisaoVersao" | "definitivoEm" | "duplicataPossivel">): string {
  const nome = NOMES_SITUACAO_CONTESTACAO[l.situacao];
  if (l.situacao === "ganha" || l.situacao === "perdida") {
    const em = l.resultadoEm ? ` em ${diaMesBr(l.resultadoEm)}` : "";
    return `${nome}${em}${perdidaSemDecisao(l) ? " (sem decisão de quem arca: a reserva continua em conferência)" : ""}`;
  }
  return `${nome}${l.duplicataPossivel && contestacaoNaoFinal(l.situacao) ? " (possível duplicata de outra disputa do pagamento)" : ""}`;
}

/** O prazo dos documentos em palavras, com o nível (atenção dentro dos dias do aviso e depois do prazo); null sem nada a dizer. */
export function prazoDosDocumentos(
  l: Pick<Contestacao, "situacao" | "documentacaoPrazo" | "documentosEnviadosEm">,
  agora: Date,
  diasAviso: number,
): { texto: string; nivel: "atencao" | "info"; vencido: boolean } | null {
  if (l.documentosEnviadosEm) return { texto: `Documentos enviados no painel do Mercado Pago em ${diaBr(l.documentosEnviadosEm)}.`, nivel: "info", vencido: false };
  if (!contestacaoNaoFinal(l.situacao)) return null;
  if (!l.documentacaoPrazo) return { texto: AVISOS_PAGAMENTO.contestacao_prazo_desconhecido, nivel: "atencao", vencido: false };
  const prazo = hojeISO(FUSO, l.documentacaoPrazo);
  const faltam = diasEntre(hojeISO(FUSO, agora), prazo);
  if (faltam < 0) return { texto: `O prazo dos documentos passou em ${diaMesBr(prazo)}: confira no painel do Mercado Pago e marque "Documentos enviados" se eles foram enviados.`, nivel: "atencao", vencido: true };
  const quando = faltam === 0 ? `até hoje (${diaMesBr(prazo)})` : `até ${diaMesBr(prazo)} (faltam ${nDias(faltam)})`;
  return { texto: `Envie os documentos pelo painel do Mercado Pago ${quando}; depois marque "Documentos enviados".`, nivel: faltam <= diasAviso ? "atencao" : "info", vencido: false };
}

const ESTADO_LIDO: Record<EstadoConhecidoContestacao, string> = {
  in_process: "em análise no banco",
  settled: "encerrada: a transação foi liquidada",
  reimbursed: "encerrada: devolvido ao pagador depois da contestação",
};
const TEXTO_ESTADO_DESCONHECIDO = "situação que o sistema não conhece";
/** O estado lido em palavras; o que não está na lista (nenhum, ou um que esta versão não conhece) diz que é desconhecido. */
const estadoEmPalavras = (e: string | null): string => (e && Object.hasOwn(ESTADO_LIDO, e) ? ESTADO_LIDO[e as EstadoConhecidoContestacao] : TEXTO_ESTADO_DESCONHECIDO);
const DOCUMENTACAO: Record<string, string> = {
  pending: "pendente",
  review_pending: "em análise",
  valid: "aceita",
  invalid: "recusada",
  not_supplied: "não enviada",
  not_applicable: "não se aplica",
  desconhecida: "situação que o sistema não conhece",
};
const RESULTADO_TRES_DS: Record<string, string> = {
  AUTHENTICATED: "o hóspede passou pela verificação do banco (autenticado)",
  NOT_AUTHENTICATED: "não autenticado pelo banco",
  CHALLENGE: "o banco pediu a verificação",
  ATTEMPTED: TEXTO_VERIFICACAO_TENTADA,
  REJECTED: "verificação recusada pelo banco",
  ERROR: "erro na verificação do banco",
};
const MODO_TRES_DS: Record<string, string> = { on_fraud_risk: "pedida quando houver risco", never: "nunca pedida" };

/** O que o Mercado Pago mostra da disputa, uma linha cada (estado com o código, documentação e prazo, cobertura, motivo). */
export function oQueOMercadoPagoMostra(l: Contestacao): string[] {
  const linhas: string[] = [];
  if (l.estadoLido || l.codigo) {
    const estado = estadoEmPalavras(l.estadoLido);
    const codigo = l.codigo && l.codigo !== l.estadoLido ? `código ${l.codigo}${l.estadoLido ? `; o último conhecido é ${l.estadoLido}` : ""}` : `código ${l.estadoLido}`;
    linhas.push(`Situação: ${estado} (${codigo})${l.estadoLido === "reimbursed" ? " — o sentido está a conferir" : ""}.`);
  } else linhas.push(l.origem === "equipe" ? `Situação: ainda sem leitura (${TEXTO_REGISTRADA_A_MAO}).` : "Situação: ainda sem leitura.");
  if (l.documentacao) linhas.push(`Documentação: ${DOCUMENTACAO[l.documentacao] ?? DOCUMENTACAO.desconhecida}${l.documentacaoPrazo ? `, prazo ${diaBr(l.documentacaoPrazo)}` : ""}.`);
  else if (l.documentacaoPrazo) linhas.push(`Prazo dos documentos: ${diaBr(l.documentacaoPrazo)}.`);
  if (l.coberturaAplicada !== null || l.coberturaElegivel !== null) {
    const aplicada = l.coberturaAplicada === null ? "ainda sem resultado" : l.coberturaAplicada ? "aplicada (a favor do vendedor)" : "não aplicada (contra o vendedor)";
    const elegivel = l.coberturaElegivel === null ? "" : l.coberturaElegivel ? "; elegível à cobertura" : "; não elegível à cobertura";
    linhas.push(`Cobertura: ${aplicada}${elegivel} — ${TEXTO_COBERTURA_A_CONFERIR}.`);
  }
  if (l.motivoId || l.motivoCodigo) linhas.push(`Códigos do motivo: ${[l.motivoId ? `reason_id ${l.motivoId}` : "", l.motivoCodigo ?? ""].filter(Boolean).join(" · ")} — o sentido está a conferir.`);
  if (l.aoVivo) linhas.push("O Mercado Pago marcou esta disputa como real (live_mode) no ambiente de teste: confira no painel dele.");
  if (l.consultadaEm) linhas.push(`Última leitura: ${diaHoraBr(l.consultadaEm)}.`);
  return linhas;
}

/** A verificação do banco do pagamento: o retrato na abertura da disputa e o modo pedido (Pix: não há). */
export function verificacaoDoBanco(l: Pick<Contestacao, "tresDSStatus">, p: Pick<Pagamento, "forma" | "tresDS">): string {
  if (p.forma === "pix") return "Pix: não há verificação do banco.";
  const modo = p.tresDS ? MODO_TRES_DS[p.tresDS] : null;
  const resultado = l.tresDSStatus ? RESULTADO_TRES_DS[l.tresDSStatus] ?? l.tresDSStatus : "sem resultado da verificação neste pagamento";
  return `${resultado}${modo ? ` (verificação ${modo})` : ""}.`;
}

/** Os avisos da linha em palavras, com os valores quando o texto precisa deles. */
function avisosDaLinha(l: Contestacao, p: Pagamento, devs: readonly Devolucao[], segurado: number): string[] {
  return l.avisos.filter(avisoDeContestacao).map((c) => {
    if (c === "contestacao_valor_acima" && l.valor !== null) return textoContestacaoValorAcima(l.valor, p.valor);
    if (c === "contestacao_valor_mudou" && l.exposicao !== null) return textoContestacaoValorMudou(l.exposicao, l.valorEmRisco, segurado);
    if (c === "contestacao_com_devolucao") {
      const d = devs.find((x) => x.situacao === "confirmada" || x.situacao === "por_fora");
      const valor = d ? (d.situacao === "por_fora" ? (d.porForaValor ?? d.valor) : (d.valorConfirmado ?? d.valor)) : p.devolvidoForaReconhecido;
      const dia = d?.confirmadaEm ? diaBr(d.confirmadaEm) : d?.porForaData ? diaMesBr(d.porForaData) : "no painel do Mercado Pago";
      if (valor > 0) return textoContestacaoComDevolucao(valor, dia, l.valor ?? l.valorEmRisco);
    }
    return AVISOS_PAGAMENTO[c];
  });
}

/** A conta do valor em risco (o que segura o retido e o débito pendente): o contestado, o pago, as outras disputas e o substituído. */
function contaDoValorEmRisco(l: Contestacao, pago: number, outras: number, substituido: number): string {
  if (!contestacaoNaoFinal(l.situacao)) return l.situacao === "perdida" || l.situacao === "ganha" ? "a disputa terminou: vale o resultado" : "encerrada sem efeito: nada fica em risco";
  if (l.duplicataPossivel) return 'possível duplicata: não segura nada até "Confirmar que é outra disputa"';
  const contestado = l.valor === null ? `o pago (${formatBRL(pago)}), porque o Mercado Pago não informou o valor de um jeito legível` : `o valor em disputa (${formatBRL(l.valor)})`;
  const partes = [`${contestado}${l.valor !== null && l.valor > pago ? `, limitado ao pago (${formatBRL(pago)})` : ""}`];
  if (outras > 0) partes.push(`menos o que as outras disputas do pagamento já seguram (${formatBRL(outras)})`);
  if (substituido > 0) partes.push(`menos a devolução que esta disputa substitui (${formatBRL(substituido)}: o acerto do cancelamento ou da alteração já a tirou)`);
  return partes.join(", ");
}

const SUFIXOS: { re: RegExp; lado: "proprietario" | "scl" | "caixa"; texto: (m: RegExpExecArray) => string }[] = [
  { re: /^retido(?:#\d+)?$/, lado: "caixa", texto: () => "Retido pelo Mercado Pago" },
  { re: /^proprietario:v(\d+)$/, lado: "proprietario", texto: (m) => `Segurado (versão ${m[1]})` },
  { re: /^scl:v(\d+)$/, lado: "scl", texto: (m) => `Perda prevista (versão ${m[1]})` },
  { re: /^proprietario:reverte$/, lado: "proprietario", texto: () => "Valor segurado devolvido (a SCL ganhou)" },
  { re: /^scl:reverte$/, lado: "scl", texto: () => "Perda prevista revertida (a SCL ganhou)" },
  { re: /^proprietario:final$/, lado: "proprietario", texto: () => "Ajuste do desconto definitivo" },
  { re: /^scl:espelho$/, lado: "scl", texto: () => "Espelho da perda prevista" },
  { re: /^scl:final$/, lado: "scl", texto: () => "Perda definitiva" },
  { re: /^volta$/, lado: "caixa", texto: () => "Volta do retido (a SCL ganhou)" },
  { re: /^caixa_final$/, lado: "caixa", texto: () => "Caixa final da disputa perdida" },
  { re: /^tarifa$/, lado: "scl", texto: () => "Tarifa do Mercado Pago pela disputa" },
  { re: /^taxa$/, lado: "scl", texto: () => "Taxa do pagamento que não voltou" },
  { re: /^sem_efeito:/, lado: "proprietario", texto: () => "Desfeito (encerrada sem efeito)" },
];

/** Os lançamentos da disputa em palavras, por lado (proprietário, SCL, caixa), com o estado e o mês; os estornados marcados. */
function lancamentosEmPalavras(linhas: readonly LinhaDaDisputa[], prefixo: string): { proprietario: string[]; scl: string[]; caixa: string[] } {
  const r = { proprietario: [] as string[], scl: [] as string[], caixa: [] as string[] };
  const estornos = new Set(linhas.filter((x) => x.estornoDe).map((x) => x.id));
  for (const x of [...linhas].sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())) {
    if (estornos.has(x.id)) continue;
    const sufixo = x.chaveOrigem.startsWith(prefixo) ? x.chaveOrigem.slice(prefixo.length) : x.chaveOrigem;
    const regra = SUFIXOS.map((s) => ({ s, m: s.re.exec(sufixo) })).find((y) => y.m);
    const lado = regra ? (regra.s.re.source.startsWith("^sem_efeito") ? (x.tipo === "direito_proprietario" ? "proprietario" : "scl") : regra.s.lado) : "caixa";
    const nome = regra ? regra.s.texto(regra.m!) : x.descricao;
    const valor = lado === "caixa" ? `${x.tipo === "recebimento" ? "entrada" : "saída"} de ${formatBRL(x.montante ?? 0)}` : comSinal(x.valor);
    const mes = `${x.competencia.slice(5, 7)}/${x.competencia.slice(0, 4)}`;
    const quando = x.dataCaixa ? `, em ${diaMesBr(x.dataCaixa)}` : "";
    r[lado].push(`${nome}: ${valor} (${x.estado}, ${mes}${quando})${x.estornada ? " — estornado" : ""}`);
  }
  return r;
}

const ORIGEM_DA_DEVOLUCAO: Record<string, string> = { cancelamento: "do cancelamento", alteracao: "da alteração", sem_reserva: "do pagamento sem reserva" };
const FONTE: Record<string, string> = { order: "leitura da order", chargebacks: "leitura das disputas do Mercado Pago", payments: "leitura do pagamento no Mercado Pago", equipe: "equipe", sistema: "sistema" };
const MOMENTO_EMAIL: Record<string, string> = { abertura: "a abertura", prazo_aviso: "o aviso do prazo dos documentos", prazo_dia: "o dia do prazo dos documentos" };

/** Um evento da linha do tempo em palavras (só códigos, datas e centavos: nunca notas). */
function eventoEmPalavras(tipo: string, antes: Record<string, unknown> | null, depois: Record<string, unknown> | null, nomeDaCausa: (c: unknown) => string): string {
  const a = antes ?? {};
  const d = depois ?? {};
  const v = (x: unknown) => (typeof x === "number" ? formatBRL(x) : "—");
  const dia = (x: unknown) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? diaMesBr(x) : "—");
  const sit = (x: unknown) => (typeof x === "string" && x in NOMES_SITUACAO_CONTESTACAO ? NOMES_SITUACAO_CONTESTACAO[x as SituacaoContestacao] : String(x ?? "—"));
  switch (tipo) {
    case "aberta":
      return "Disputa aberta";
    case "estado_lido":
      return d.situacao && d.situacao !== a.situacao ? `Situação: ${sit(a.situacao)} → ${sit(d.situacao)}${d.estadoLido ? ` (código ${String(d.estadoLido)})` : ""}` : `Situação no Mercado Pago: ${String(a.estadoLido ?? "—")} → ${String(d.estadoLido ?? "—")}`;
    case "documentacao":
      return `Documentação: ${DOCUMENTACAO[String(a.documentacao)] ?? "—"} → ${DOCUMENTACAO[String(d.documentacao)] ?? "—"}`;
    case "prazo":
      return `Prazo dos documentos: ${dia(a.prazo)} → ${dia(d.prazo)}`;
    case "valor":
      return `Valor em disputa: ${v(a.valor)} → ${v(d.valor)}`;
    case "cobertura":
      return `Cobertura aplicada: ${String(a.coberturaAplicada ?? "sem resultado")} → ${String(d.coberturaAplicada ?? "sem resultado")}`;
    case "decisao":
      return `${d.atualizacao ? "Valor segurado atualizado" : Number(a.versao ?? 0) > 0 ? "Decisão mudada" : "Quem arca registrado"} (versão ${String(d.versao ?? "—")}): ${nomeDaCausa(d.causa)}; ${typeof d.quemArca === "string" && d.quemArca in NOMES_QUEM_ARCA ? NOMES_QUEM_ARCA[d.quemArca as QuemArcaContestacao].toLowerCase() : "—"}; proprietário ${v(d.proprietario)}, SCL ${v(d.scl)}`;
    case "documentos_enviados":
      return `Documentos enviados no painel do Mercado Pago (${dia(d.data)})`;
    case "debito_confirmado":
      return `Débito do Mercado Pago confirmado: ${v(d.valor)} em ${dia(d.data)}`;
    case "resultado":
      return `Resultado confirmado: ${sit(d.situacao)}`;
    case "sem_efeito":
      return "Encerrada sem efeito";
    case "aviso_conferido":
      return "Aviso conferido: a disputa continua encerrada no painel do Mercado Pago";
    case "reaberta":
      return "A disputa foi reaberta (reapresentação ou arbitragem): nasceu a rodada seguinte";
    case "outra_disputa":
      return "Confirmado que é outra disputa";
    case "substituicao":
      return `Devolução de ${v(d.valor)} substituída pela disputa`;
    case "cancelamento":
      return `Reserva cancelada pela ação "Cancelar a reserva contestada" (valor retido ${v(d.valorRetido)})`;
    case "caixa":
      return d.retidoRealizado !== undefined ? `Retido realizado: ${v(d.retidoRealizado)}${d.dia ? ` em ${dia(d.dia)}` : ""}` : `Retido previsto: ${v(a.retidoPrevisto)} → ${v(d.retidoPrevisto)}`;
    case "lancamentos":
      return `Lançamentos (${String(d.momento ?? "—")}): ${String(d.linhas ?? 0)} linha(s)`;
    case "email_equipe":
      return `E-mail à equipe: ${MOMENTO_EMAIL[String(d.momento)] ?? "aviso"}`;
    default:
      return tipo;
  }
}

/**
 * "Texto para o proprietário" pronto para copiar depois da decisão (causa, valores, o que acontece em cada resultado; sem
 * envio automático). Neutro quanto ao tipo e à forma de pagamento ("disputa do pagamento", como o portal: nunca "cartão"
 * num MED do Pix ou numa reclamação) e pela situação: segurado até o resultado; ganha, o valor volta; perdida, o desconto
 * fica definitivo; sem efeito, nada fica descontado.
 */
export function textoParaOProprietario(e: {
  reservaCodigo: string;
  causa: string;
  valor: number;
  proprietario: number;
  explicacao: string;
  situacao: SituacaoContestacao;
  /** AAAA-MM-DD do resultado confirmado (ganha ou perdida). */
  resultadoEm: string | null;
}): string {
  const partes = [`Disputa do pagamento da reserva ${e.reservaCodigo}: foi aberta uma disputa de ${formatBRL(e.valor)} sobre o pagamento desta reserva no Mercado Pago. Causa registrada: ${e.causa}.`];
  if (e.explicacao.trim()) partes.push(e.explicacao.trim().replace(/([^.!?])$/, "$1."));
  const quando = e.resultadoEm ? ` em ${diaMesBr(e.resultadoEm)}` : "";
  const valor = formatBRL(e.proprietario);
  if (e.situacao === "sem_efeito") partes.push(e.proprietario > 0 ? `A disputa foi encerrada sem efeito: nada fica descontado de você (o valor segurado, ${valor}, volta no repasse seguinte).` : "A disputa foi encerrada sem efeito: nada fica descontado de você.");
  else if (e.proprietario <= 0) partes.push(e.situacao === "ganha" ? `A SCL ganhou a disputa${quando}: nada foi descontado de você.` : "Pela decisão registrada, nada é descontado de você.");
  else if (e.situacao === "ganha") partes.push(`A SCL ganhou a disputa${quando}: o valor segurado (${valor}) volta no repasse seguinte.`);
  else if (e.situacao === "perdida") partes.push(`A SCL perdeu a disputa${quando}: o desconto de ${valor} dos seus repasses fica definitivo.`);
  else
    partes.push(
      `Pela decisão registrada, ${valor} ficam segurados dos seus próximos repasses até o resultado: se a SCL ganhar a disputa, o valor volta no repasse seguinte; se perder, o desconto fica definitivo. Cada passo aparece no seu extrato.`,
    );
  return partes.join(" ");
}

// ---------------------------------------------------------------- os modelos

/** O que todos que leem a reserva veem de uma disputa (sem valores, notas, motivo, decisão, lançamentos nem linha do tempo). */
export type ContestacaoNaTela = {
  id: string;
  pagamentoId: string;
  tipo: TipoContestacao;
  situacao: SituacaoContestacao;
  rodada: number;
  cabecalho: string;
  /** "O pagamento desta reserva está em disputa ([tipo]): quem cuida do financeiro acompanha." */
  frase: string;
  situacaoTexto: string;
  idCaso: string | null;
  abertaEm: Date;
  prazo: ReturnType<typeof prazoDosDocumentos>;
  documentosEnviadosEm: Date | null;
  /** "Documentos enviados no painel do Mercado Pago" ainda cabe (disputa não final, sem a marca). */
  podeMarcarDocumentos: boolean;
  /** AAAA-MM-DD: o primeiro dia possível do envio dos documentos (a abertura da disputa, `desdeADefesa`), o mesmo que o domínio confere. */
  desde: string;
  /** Não final, não duplicada e com valor em risco: a razão de "Cancelar a reserva contestada" (o domínio confere o resto). */
  seguraValor: boolean;
};

/** O que o proprietário e a SCL ficam da reserva num resultado (D − x e C − y na perdida; D e C na ganha), em reais. */
export type FicaDaReserva = { proprietario: string; scl: string };

/**
 * Uma opção de quem arca no formulário: o débito de cada lado, o que cada um fica da reserva com o resultado perdido e com
 * o ganho (a prévia do desenho; `ganha` null quando a disputa já está perdida), a assinatura e a pergunta do
 * BotaoConfirmar de cada causa.
 */
export type OpcaoNaTela = {
  quemArca: QuemArcaContestacao;
  nome: string;
  proprietario: string;
  scl: string;
  fica: { perdida: FicaDaReserva; ganha: FicaDaReserva | null };
  assinatura: string;
  perguntas: Record<CodigoCausaContestacao, string>;
};

/** O formulário da decisão (registrar ou mudar quem arca): os fatos ao lado e as opções. */
export type DecisaoNaTela = {
  versao: number;
  /** "registrar" (versão 0) ou "mudar" (versão ≥ 1). */
  modo: "registrar" | "mudar";
  causas: { codigo: CodigoCausaContestacao; nome: string; frase: string }[];
  opcoes: OpcaoNaTela[];
  /** Por que alguma opção não aparece (sem proprietário nas linhas do motor; sem partes para dividir). */
  semOpcao: string[];
  fatos: string[];
  /** "O valor em disputa mudou…": a ação pronta "Atualizar o valor segurado" (versão e assinatura), ou null. */
  atualizacao: { versao: number; assinatura: string; pergunta: string } | null;
  /**
   * A explicação ao proprietário em vigor: no "Mudar quem arca", o campo vem preenchido com ela (enviar sem mexer a mantém;
   * apagar o campo é apagar a explicação). Vazia no "Registrar".
   */
  explicacao: string;
};

/** O formulário de "Confirmar o resultado": os fatos em palavras, os valores propostos e as perguntas (C1: nada marcado). */
export type ResultadoNaTela = {
  versao: number;
  assinatura: string;
  /** Os fatos do Mercado Pago em palavras, ao lado do formulário. */
  fatos: string[];
  /** A leitura de agora pode mostrar a disputa em andamento (`podeEstarEmAndamento`): a caixa da nota reforçada aparece. */
  emAndamento: boolean;
  semReserva: boolean;
  /** O retido já saiu do caixa: o "Ganhou" pede o dia em que o dinheiro voltou. */
  retidoRealizado: boolean;
  /** Sem recebimento do pagamento: o "Ganhou" oferece registrar a liberação ali mesmo. */
  semRecebimento: boolean;
  proposta: { valorPerdido: number | null; liquidoNaoEntrou: number | null; debitoEm: string | null; liquido: number | null };
  /**
   * O "Perdeu" pede antes a liberação registrada à mão (`FatosDoResultado.liberacaoAntesDaPerda`): o texto, mostrado no
   * formulário (o "nunca entrou" vem vazio, sem valor suposto), ou null.
   */
  liberacaoAntes: string | null;
  /** A conta do valor perdido proposto. */
  contaDoPerdido: string;
  desde: string;
  perguntas: { ganha: string; perdida: string };
};

/** O bloco de uma disputa para a equipe que lê o financeiro. */
export type ContestacaoDaEquipe = ContestacaoNaTela & {
  origem: "leitura" | "equipe";
  registradaAMao: boolean;
  /**
   * A origem em palavras (`textoDaOrigemDaContestacao`): registrada à mão, ou lida no Mercado Pago (pode ser uma reclamação
   * no Mercado Pago: o sistema não tem como separar).
   */
  origemTexto: string;
  /** A nota do "Confirmar o débito do Mercado Pago" (`debito_nota`; só a equipe que lê o financeiro); vazia sem nota. */
  notaDebito: string;
  duplicataPossivel: boolean;
  idContestacao: string | null;
  idTransacao: string | null;
  valor: string;
  valorEmRisco: string;
  contaDoValorEmRisco: string;
  mercadoPago: string[];
  verificacao: string;
  notaRegistro: string;
  eventos: { em: Date; texto: string; quem: string }[];
  /** `nota`: a da decisão (nunca apagada); `notaMudanca`: o "por que mudar" da mudança mais recente (vazia sem mudança). */
  decisao: { linhas: [string, string][]; nota: string; notaMudanca: string; explicacao: string; textoParaProprietario: string | null } | null;
  divisaoMudou: boolean;
  /** "Pagamento sem reserva: não há proprietário…" ou "A disputa cobre a devolução…": por que não há decisão. */
  semDecisao: string | null;
  lancamentos: { proprietario: string[]; scl: string[]; caixa: string[] };
  substituidas: string[];
  avisos: string[];
  resultado: { linhas: [string, string][]; nota: string } | null;
  acoes: {
    debito: { valor: number; desde: string } | null;
    decidir: DecisaoNaTela | null;
    outraDisputa: boolean;
    prazo: { desde: string } | null;
    resultado: ResultadoNaTela | null;
    semEfeito: { pedeVolta: boolean; emAndamento: boolean } | null;
    conferirAviso: { reabre: boolean } | null;
  };
};

// ---------------------------------------------------------------- leitura

/** A reserva (na empresa) do pagamento: o registro pela equipe recebe o id do pagamento. null = não é desta empresa. */
export async function reservaDoPagamento(db: Db, organizacaoId: string, pagamentoId: string): Promise<{ reservaId: string } | null> {
  if (!uuidValido(pagamentoId)) return null;
  const [p] = await db.select({ reservaId: pagamentos.reservaId }).from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  return p ?? null;
}

/** A reserva na empresa ("Cancelar a reserva contestada" a resolve antes de ler o Mercado Pago). null = não é desta empresa. */
export async function reservaDaOrganizacao(db: Db, organizacaoId: string, reservaId: string): Promise<{ reservaId: string } | null> {
  if (!uuidValido(reservaId)) return null;
  const [r] = await db.select({ reservaId: reservas.id }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)));
  return r ?? null;
}

/** A reserva (na empresa) da disputa, pelo pagamento dela (a do pagamento sem reserva também tem a reserva da cotação). */
export async function reservaDaContestacao(db: Db, organizacaoId: string, contestacaoId: string): Promise<{ reservaId: string; pagamentoId: string } | null> {
  if (!uuidValido(contestacaoId)) return null;
  const [c] = await db
    .select({ reservaId: pagamentos.reservaId, pagamentoId: pagamentos.id })
    .from(contestacoesPagamento)
    .innerJoin(pagamentos, eq(pagamentos.id, contestacoesPagamento.pagamentoId))
    .where(and(eq(contestacoesPagamento.id, contestacaoId), eq(contestacoesPagamento.organizacaoId, organizacaoId), eq(pagamentos.organizacaoId, organizacaoId)));
  return c ?? null;
}

/** Os pagamentos de uma reserva (na empresa) e as disputas deles, em ordem de abertura. */
async function disputasDaReserva(db: Db, organizacaoId: string, reservaId: string) {
  if (!uuidValido(reservaId)) return { ps: [] as Pagamento[], ls: [] as Contestacao[] };
  const ps = await db.select().from(pagamentos).where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.reservaId, reservaId))).orderBy(asc(pagamentos.criadoEm), asc(pagamentos.id));
  if (!ps.length) return { ps, ls: [] as Contestacao[] };
  const ls = await db
    .select()
    .from(contestacoesPagamento)
    .where(and(eq(contestacoesPagamento.organizacaoId, organizacaoId), inArray(contestacoesPagamento.pagamentoId, ps.map((p) => p.id))))
    .orderBy(asc(contestacoesPagamento.abertaEm), asc(contestacoesPagamento.rodada), asc(contestacoesPagamento.id));
  return { ps, ls };
}

function naTela(l: Contestacao, p: Pick<Pagamento, "aprovadoEm" | "criadoEm">, agora: Date, diasAviso: number, editarDocumentos: boolean): ContestacaoNaTela {
  return {
    id: l.id,
    pagamentoId: l.pagamentoId,
    tipo: l.tipo,
    situacao: l.situacao,
    rodada: l.rodada,
    cabecalho: cabecalhoDaDisputa(l),
    frase: `O pagamento desta reserva está em disputa (${NOMES_TIPO_CONTESTACAO[l.tipo].toLowerCase()}): quem cuida do financeiro acompanha.`,
    situacaoTexto: situacaoDaDisputaEmPalavras(l),
    idCaso: l.idCaso,
    abertaEm: l.abertaNoProvedorEm ?? l.abertaEm,
    prazo: prazoDosDocumentos(l, agora, diasAviso),
    documentosEnviadosEm: l.documentosEnviadosEm,
    podeMarcarDocumentos: editarDocumentos && contestacaoNaoFinal(l.situacao) && !l.documentosEnviadosEm,
    desde: desdeADefesa(p, l),
    seguraValor: contestacaoNaoFinal(l.situacao) && !l.duplicataPossivel && l.valorEmRisco > 0,
  };
}

const podeDocumentos = (sessao: Pick<Sessao, "papel">) => podeFazer(sessao.papel, "reserva:editar") || podeFazer(sessao.papel, "financeiro:editar");

/**
 * As disputas de uma reserva para quem lê a reserva sem o financeiro (reserva:ler): tipo, situação, datas e o prazo dos
 * documentos, sem valores. "Documentos enviados" só com reserva:editar ou financeiro:editar.
 */
export async function lerContestacoesDaOperacao(db: Db, sessao: Sessao, reservaId: string, agora: Date = new Date()): Promise<ContestacaoNaTela[]> {
  if (!podeFazer(sessao.papel, "reserva:ler")) throw new AcessoNegado("ACAO_NAO_PERMITIDA");
  const { ps, ls } = await disputasDaReserva(db, sessao.organizacaoId, reservaId);
  if (!ls.length) return [];
  const { diasAvisoDocumentacao } = await lerConfigPagamentoSite(db, sessao.organizacaoId);
  return ls.map((l) => naTela(l, ps.find((p) => p.id === l.pagamentoId)!, agora, diasAvisoDocumentacao, podeDocumentos(sessao)));
}

/**
 * As disputas de uma reserva para a equipe que lê o financeiro: tudo do bloco **Disputa** (valores, motivo, decisão,
 * lançamentos, notas, linha do tempo e as ações que o domínio permite). Exige financeiro:ler e papel diferente de
 * proprietário, no servidor (o proprietário tem financeiro:ler e nunca lê por aqui).
 */
export async function lerContestacoesDaEquipe(db: Db, sessao: Sessao, reservaId: string, agora: Date = new Date()): Promise<ContestacaoDaEquipe[]> {
  if (!podeFazer(sessao.papel, "financeiro:ler") || sessao.papel === "proprietario") throw new AcessoNegado("ACAO_NAO_PERMITIDA");
  const org = sessao.organizacaoId;
  const { ps, ls } = await disputasDaReserva(db, org, reservaId);
  if (!ls.length) return [];
  const editar = podeFazer(sessao.papel, "financeiro:editar");
  const config = await lerConfigPagamentoSite(db, org);
  const causas: TextosDasCausas = config.causasContestacao;
  const nomeDaCausa = (c: unknown) => (typeof c === "string" && c in causas ? causas[c as CodigoCausaContestacao].nome : "—");
  const [r] = await db.select({ codigo: reservas.codigo, checkin: reservas.checkin, checkout: reservas.checkout, estado: reservas.estado, imovelId: reservas.imovelId }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, org)));
  const devs = await db.select().from(devolucoesPagamento).where(and(eq(devolucoesPagamento.organizacaoId, org), inArray(devolucoesPagamento.pagamentoId, ps.map((p) => p.id))));
  const evs = await db.select().from(eventosContestacao).where(inArray(eventosContestacao.contestacaoId, ls.map((l) => l.id))).orderBy(desc(eventosContestacao.em), desc(eventosContestacao.ordem));
  const ids = [...new Set([...evs.map((e) => e.usuarioId), ...ls.flatMap((l) => [l.decisaoPor, l.resultadoPor])].filter((x): x is string => !!x))];
  const nomes = new Map((ids.length ? await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(and(eq(usuarios.organizacaoId, org), inArray(usuarios.id, ids))) : []).map((u) => [u.id, u.nome]));
  const quem = (id: string | null, fonte?: string) => (id ? (nomes.get(id) ?? "a equipe") : fonte === "equipe" ? "a equipe" : FONTE[fonte ?? "sistema"] ?? "o sistema");
  const fatosDaReserva = r ? await fatosDaEstadia(db, org, { id: reservaId, ...r }, agora) : [];
  const saida: ContestacaoDaEquipe[] = [];
  for (const l of ls) {
    const p = ps.find((x) => x.id === l.pagamentoId)!;
    const devsP = devs.filter((d) => d.pagamentoId === p.id);
    const pago = p.valorPago ?? p.valor;
    const outras = ls.filter((x) => x.pagamentoId === p.id && x.id !== l.id && contestacaoNaoFinal(x.situacao) && !x.duplicataPossivel).reduce((s, x) => s + x.valorEmRisco, 0);
    const substituidas = devsP.filter((d) => d.contestacaoId === l.id);
    const substituido = substituidas.filter((d) => d.situacao === "recusada" || d.situacao === "pedida").reduce((s, d) => s + d.valor, 0);
    const livro = await livroDaDisputa(db, org, l);
    const naoFinal = contestacaoNaoFinal(l.situacao);
    // A decisão: os fatos do domínio (versão, opções, assinaturas, recusa) — a mesma regra que a ação confere.
    const pd = await previaDaDecisao(db, org, l.id);
    const fd: FatosDaDecisao | null = pd.ok ? pd.fatos : null;
    const pr = naoFinal ? await previaDoResultado(db, org, l.id) : null;
    const fr: FatosDoResultado | null = pr?.ok ? pr.fatos : null;
    const semReserva = fd?.semReserva ?? !l.reservaId;
    const emAndamento = podeEstarEmAndamento(l);
    const comForm = editar && !!fd && (fd.recusa === null || (naoFinal && fd.versao > 0 && !fd.semReserva));
    // Ao lado do formulário: quanto o proprietário já recebeu da reserva e se ele aceitou um "Como funciona" que fale de disputas.
    const doProprietario =
      comForm && fd!.partes.proprietarioId
        ? [await recebidoPeloProprietario(db, org, fd!.partes.proprietarioId, reservaId, agora), avisoDoComoFunciona(await aceitouComoFuncionaDasDisputas(db, org, fd!.partes.proprietarioId))].filter((x): x is string => !!x)
        : [];
    const decisaoNaTela = comForm ? decisaoDoForm(l, p, fd!, causas, [...fatosDaReserva, ...doProprietario], r?.codigo ?? "") : null;
    saida.push({
      ...naTela(l, p, agora, config.diasAvisoDocumentacao, podeDocumentos(sessao)),
      origem: l.origem,
      registradaAMao: l.origem === "equipe",
      origemTexto: emFrase(textoDaOrigemDaContestacao(l)),
      notaDebito: l.debitoNota,
      duplicataPossivel: l.duplicataPossivel,
      idContestacao: l.idContestacao,
      idTransacao: l.idTransacao,
      valor: l.valor === null ? `não informado de um jeito legível (o valor em risco usa o pago, ${formatBRL(pago)})` : formatBRL(l.valor),
      valorEmRisco: formatBRL(l.valorEmRisco),
      contaDoValorEmRisco: contaDoValorEmRisco(l, pago, outras, substituido),
      mercadoPago: oQueOMercadoPagoMostra(l),
      verificacao: verificacaoDoBanco(l, p),
      notaRegistro: l.notaRegistro,
      eventos: evs
        .filter((e) => e.contestacaoId === l.id)
        .map((e) => ({ em: e.em, texto: eventoEmPalavras(e.tipo, e.antes, e.depois, nomeDaCausa), quem: quem(e.usuarioId, e.fonte) })),
      decisao:
        l.decisaoVersao > 0 && l.causa && l.quemArca
          ? {
              linhas: [
                ["Causa", nomeDaCausa(l.causa)],
                ["Quem arca", NOMES_QUEM_ARCA[l.quemArca]],
                ["Divisão", `proprietário ${formatBRL(l.parteProprietario ?? 0)}; SCL ${formatBRL(l.parteScl ?? 0)} (sobre ${formatBRL(l.exposicao ?? 0)})`],
                ["Versão", `${l.decisaoVersao}${l.decisaoEm ? `, em ${diaHoraBr(l.decisaoEm)}` : ""} por ${quem(l.decisaoPor, "equipe")}`],
              ],
              nota: l.decisaoNota,
              notaMudanca: l.decisaoMudancaNota,
              explicacao: l.explicacaoProprietario,
              textoParaProprietario: r
                ? textoParaOProprietario({
                    reservaCodigo: r.codigo,
                    causa: nomeDaCausa(l.causa),
                    valor: l.exposicao ?? l.valorEmRisco,
                    proprietario: l.parteProprietario ?? 0,
                    explicacao: l.explicacaoProprietario,
                    situacao: l.situacao,
                    resultadoEm: l.resultadoEm,
                  })
                : null,
            }
          : null,
      divisaoMudou: !!fd?.divisaoMudou && naoFinal,
      semDecisao: l.decisaoVersao === 0 ? (semReserva ? TEXTO_PAGAMENTO_SEM_RESERVA : fd && fd.valor <= 0 && (naoFinal || l.situacao === "perdida") ? TEXTO_NADA_A_DIVIDIR : null) : null,
      lancamentos: lancamentosEmPalavras(livro.linhas, prefixoDaContestacao(p.id, l.id)),
      substituidas: substituidas.map((d) => `Devolução ${ORIGEM_DA_DEVOLUCAO[d.origem] ?? ""} de ${formatBRL(d.valor)}: ${d.situacao === "confirmada" ? `confirmada pela disputa${d.valorConfirmado !== null ? ` (${formatBRL(d.valorConfirmado)})` : ""}` : naoFinal ? "substituída pela disputa (o dinheiro volta ao hóspede por ela, se ele ganhar)" : "devida de novo (a substituição acabou)"}`.replace("  ", " ")),
      avisos: avisosDaLinha(l, p, devsP, livro.proprietario),
      resultado:
        l.situacao === "ganha" || l.situacao === "perdida" || l.situacao === "sem_efeito"
          ? {
              linhas: [
                ...(l.resultadoEm ? ([["Resultado em", `${dataBr(l.resultadoEm)} por ${quem(l.resultadoPor, "equipe")}`]] as [string, string][]) : []),
                ...(l.situacao === "perdida" && l.valorPerdido !== null ? ([["Valor perdido", formatBRL(l.valorPerdido)]] as [string, string][]) : []),
                ...(l.situacao === "perdida" && l.liquidoNaoEntrou ? ([["Nunca entrou na conta", formatBRL(l.liquidoNaoEntrou)]] as [string, string][]) : []),
                ...(l.debitoEm ? ([["Débito do Mercado Pago", dataBr(l.debitoEm)]] as [string, string][]) : []),
                ...(l.tarifa ? ([["Tarifa do Mercado Pago", formatBRL(l.tarifa)]] as [string, string][]) : []),
              ],
              nota: l.situacao === "sem_efeito" ? l.encerradaNota : l.resultadoNota,
            }
          : null,
      acoes: {
        debito: editar && naoFinal && !l.duplicataPossivel && !l.retidoConfirmadoEm && !retidoRealizado(livro.retido) ? { valor: l.valorEmRisco, desde: desdeAberturaDaDisputa(p, l) } : null,
        decidir: decisaoNaTela,
        outraDisputa: editar && naoFinal && l.duplicataPossivel,
        prazo: editar && naoFinal && !l.documentacaoPrazo ? { desde: desdeADefesa(p, l) } : null,
        resultado: editar && naoFinal && !l.duplicataPossivel && fr ? resultadoDoForm(l, p, fr, emAndamento) : null,
        semEfeito: editar && naoFinal ? { pedeVolta: retidoRealizado(livro.retido), emAndamento } : null,
        conferirAviso: editar && !naoFinal && l.avisos.includes("contestacao_resultado_mudou") ? { reabre: l.situacao === "ganha" && l.estadoLido === "in_process" } : null,
      },
    });
  }
  return saida;
}

/** Os fatos da estadia ao lado do formulário da decisão: já aconteceu ou por vir, as limpezas e as manutenções das datas, o que o proprietário já recebeu e o "Como funciona". */
async function fatosDaEstadia(db: Db, organizacaoId: string, r: { id: string; codigo: string; checkin: string; checkout: string; estado: string; imovelId: string }, agora: Date): Promise<string[]> {
  const hoje = hojeISO(FUSO, agora);
  const fatos: string[] = [];
  fatos.push(r.checkin > hoje ? `Estadia por vir: entrada em ${diaMesBr(r.checkin)}.` : r.checkout <= hoje ? `Estadia já aconteceu (${diaMesBr(r.checkin)}–${diaMesBr(r.checkout)}).` : `Estadia em curso (${diaMesBr(r.checkin)}–${diaMesBr(r.checkout)}).`);
  const ls = await db
    .select({ data: limpezas.data, estado: limpezas.estado })
    .from(limpezas)
    .where(and(eq(limpezas.organizacaoId, organizacaoId), eq(limpezas.imovelId, r.imovelId), inArray(limpezas.data, datasEntre(r.checkin, r.checkout))))
    .orderBy(asc(limpezas.data));
  if (ls.length) fatos.push(`Limpezas nas datas: ${ls.map((x) => `${diaMesBr(x.data)} (${x.estado})`).join(", ")}.`);
  const ms = await db.select({ titulo: manutencoes.titulo, estado: manutencoes.estado, criadoEm: manutencoes.criadoEm, dataRealizada: manutencoes.dataRealizada }).from(manutencoes).where(and(eq(manutencoes.organizacaoId, organizacaoId), eq(manutencoes.imovelId, r.imovelId)));
  const nasDatas = ms.filter((m) => {
    const d = m.dataRealizada ?? hojeISO(FUSO, m.criadoEm);
    return d >= r.checkin && d <= r.checkout;
  });
  if (nasDatas.length) fatos.push(`Manutenções nas datas: ${nasDatas.map((m) => `${m.titulo} (${m.estado})`).join("; ")}.`);
  return fatos;
}

/** As datas AAAA-MM-DD de `de` até `ate`, inclusive (a estadia e o dia da saída). */
function datasEntre(de: string, ate: string): string[] {
  const n = Math.max(0, Math.min(400, diasEntre(de, ate)));
  return Array.from({ length: n + 1 }, (_, i) => new Date(Date.parse(`${de}T12:00:00Z`) + i * DIA_MS).toISOString().slice(0, 10));
}

/** O formulário da decisão: causas com a frase da regra, as opções com a pergunta montada pelo domínio, os fatos ao lado. */
function decisaoDoForm(l: Contestacao, p: Pagamento, f: FatosDaDecisao, causas: TextosDasCausas, fatosDaReserva: string[], reservaCodigo: string): DecisaoNaTela {
  const doPagamento = { forma: p.forma, tresDSStatus: l.tresDSStatus };
  const semOpcao: string[] = [];
  const opcoes: OpcaoNaTela[] = [];
  // A prévia: o que cada lado fica da reserva (as partes efetivas de agora, D e C, as mesmas da divisão) com o resultado
  // perdido (D − x, C − y) e com o ganho (D, C; nada é descontado). Na perdida, só o resultado que aconteceu.
  const D = f.partes.parteProprietario;
  const C = f.partes.comissao;
  const fica = (o: { proprietario: number; scl: number }): OpcaoNaTela["fica"] => ({
    perdida: { proprietario: formatBRL(D - o.proprietario), scl: formatBRL(C - o.scl) },
    ganha: f.perdida ? null : { proprietario: formatBRL(D), scl: formatBRL(C) },
  });
  for (const q of QUEM_ARCA_CONTESTACAO) {
    const o = f.opcoes[q];
    if (!o) {
      semOpcao.push(q === "scl" ? "" : !f.partes.proprietarioId ? `${NOMES_QUEM_ARCA[q]}: a reserva não tem proprietário nas linhas do financeiro.` : `${NOMES_QUEM_ARCA[q]}: não há partes para dividir.`);
      continue;
    }
    const perguntas = Object.fromEntries(
      CODIGOS_CAUSA_CONTESTACAO.map((c) => [
        c,
        `${perguntaDaDecisao({
          nomeCausa: causas[c].nome,
          quemArca: q,
          proprietario: o.proprietario,
          scl: o.scl,
          comResultado: l.situacao === "perdida",
          pelaRegra: quemArcaPelaRegra(c, doPagamento),
          reforcada: confirmacaoReforcadaDaDecisao(c, q),
        })} ${ficaEmPalavras(fica(o))}`,
      ]),
    ) as Record<CodigoCausaContestacao, string>;
    opcoes.push({ quemArca: q, nome: NOMES_QUEM_ARCA[q], proprietario: formatBRL(o.proprietario), scl: formatBRL(o.scl), fica: fica(o), assinatura: o.assinatura, perguntas });
  }
  const fatos = [
    `Valor em disputa: ${l.valor === null ? "não informado" : formatBRL(l.valor)}; ${f.perdida ? `perda a dividir: ${formatBRL(f.valor)}` : `valor em risco: ${formatBRL(f.valor)}`}.`,
    `Partes da reserva ${reservaCodigo} agora: proprietário ${formatBRL(f.partes.parteProprietario)}, comissão da SCL ${formatBRL(f.partes.comissao)}.`,
    ...fatosDaReserva,
    `Verificação do banco: ${verificacaoDoBanco(l, p)}`,
    ...oQueOMercadoPagoMostra(l).filter((x) => x.startsWith("Cobertura") || x.startsWith("Documentação") || x.startsWith("Prazo")),
    ...(f.divisaoMudou ? [TEXTO_DIVISAO_MUDOU] : []),
  ];
  const atualizacao =
    f.versao > 0 && f.atualizacao && l.causa && l.quemArca && valorSeguradoDesatualizado(l)
      ? {
          versao: f.versao,
          assinatura: f.atualizacao.assinatura,
          pergunta: `Atualizar o valor segurado para o valor em disputa de agora (${formatBRL(f.valor)})? Mesma causa e quem arca: proprietário ${formatBRL(f.atualizacao.proprietario)}; SCL ${formatBRL(f.atualizacao.scl)}. A diferença de cada lado entra no mês corrente.`,
        }
      : null;
  return {
    versao: f.versao,
    modo: f.versao === 0 ? "registrar" : "mudar",
    causas: CODIGOS_CAUSA_CONTESTACAO.map((c) => ({ codigo: c, nome: causas[c].nome, frase: fraseDaCausa(c, doPagamento, causas) })),
    opcoes,
    semOpcao: semOpcao.filter(Boolean),
    fatos,
    atualizacao,
    explicacao: f.versao > 0 ? l.explicacaoProprietario : "",
  };
}

/** A prévia de uma opção em palavras (a pergunta do BotaoConfirmar a repete): o que cada lado fica da reserva em cada resultado. */
function ficaEmPalavras(f: OpcaoNaTela["fica"]): string {
  const perdida = `Com a disputa perdida, ficam da reserva: proprietário ${f.perdida.proprietario}; SCL ${f.perdida.scl}.`;
  return f.ganha ? `${perdida} Ganha: proprietário ${f.ganha.proprietario}; SCL ${f.ganha.scl}.` : perdida;
}

/**
 * A leitura de agora pode mostrar a disputa em andamento: o formulário já traz a caixa da nota reforçada, que a fase 0 do
 * domínio pede (`releituraDaDisputa`) — `in_process` guardado ou, com a linha ainda aberta, o caso da Chargebacks API ainda
 * sem estado nem cobertura (a mesma regra, `leituraEmDisputa`). A caixa a mais não muda nada quando a releitura não a pede;
 * a recusa `nota_reforcada` também a mostra (o formulário), para a ação sempre poder ser concluída pela tela.
 */
export const podeEstarEmAndamento = (l: Pick<Contestacao, "situacao" | "estadoLido" | "coberturaAplicada">): boolean =>
  l.estadoLido === "in_process" || (l.situacao === "aberta" && leituraEmDisputa({ fonte: "chargebacks", estadoLido: l.estadoLido, coberturaAplicada: l.coberturaAplicada }));

/** Os fatos do Mercado Pago em palavras para "Confirmar o resultado" (C1: o formulário começa sem nada marcado). */
export function fatosDoResultadoEmPalavras(l: Pick<Contestacao, "estadoLido" | "coberturaAplicada" | "codigo" | "origem" | "situacao">): string[] {
  if (l.estadoLido === "in_process" && l.situacao === "aberta")
    return [`O Mercado Pago ainda mostra a disputa em andamento (código in_process): confirme o resultado só se o painel dele já mostra o resultado (a nota reforçada é pedida).`];
  if (l.estadoLido === "settled" || l.estadoLido === "reimbursed" || l.coberturaAplicada !== null) {
    const codigo = l.estadoLido ? `código ${l.estadoLido}` : `cobertura ${String(l.coberturaAplicada)}`;
    return [
      `O Mercado Pago mostra a disputa encerrada (${codigo}). Pela página atual do Mercado Pago, reimbursed é "devolvido ao pagador" e a cobertura false é "contra o vendedor"; o sentido está a conferir (item 61). Confira no painel dele se o dinheiro voltou à SCL.`,
    ];
  }
  return [`${TEXTO_RESULTADO_SEM_LEITURA[0].toUpperCase()}${TEXTO_RESULTADO_SEM_LEITURA.slice(1)}.`];
}

/** O formulário de "Confirmar o resultado": valores propostos (com a conta), datas e as perguntas de cada resultado. */
function resultadoDoForm(l: Contestacao, p: Pagamento, f: FatosDoResultado, emAndamento: boolean): ResultadoNaTela {
  const valorPerdido = f.proposta.valorPerdido;
  const conta = f.semReserva
    ? `a taxa do pagamento${p.taxa !== null ? ` (${formatBRL(p.taxa)})` : ""}: o dinheiro do pagamento sem reserva nunca entrou no livro; o que a SCL perde é a taxa, salvo se o Mercado Pago a devolver`
    : `o valor em disputa${l.valor === null ? " (ilegível: o pago)" : ""}${valorPerdido !== null ? ` (${formatBRL(valorPerdido)})` : ""}; confira no painel do Mercado Pago quanto saiu da conta`;
  return {
    versao: f.versao,
    assinatura: f.assinatura,
    fatos: fatosDoResultadoEmPalavras(l),
    emAndamento,
    semReserva: f.semReserva,
    retidoRealizado: !!f.retido && (f.retido.estado === "realizado" || f.retido.estado === "conciliado"),
    semRecebimento: f.semRecebimento,
    proposta: { ...f.proposta, liquido: p.liquido },
    liberacaoAntes: f.liberacaoAntesDaPerda,
    contaDoPerdido: conta,
    desde: desdeAberturaDaDisputa(p, l),
    perguntas: {
      ganha: `Confirmar que a SCL GANHOU a disputa (resultado em {data})? ${f.lancado.proprietario > 0 ? `O valor segurado do proprietário (${formatBRL(f.lancado.proprietario)}) volta no repasse seguinte e a perda prevista da SCL é desfeita.` : "Nada foi descontado de ninguém."} O resultado não se desfaz pelo sistema: uma correção depois é um ajuste.`,
      perdida: `Confirmar que a SCL PERDEU a disputa (resultado em {data}), com {valor} perdidos${f.semReserva ? "" : " ({naoEntrou} deste pagamento nunca entraram na conta)"}? ${l.decisaoVersao > 0 ? "O desconto do proprietário e a perda da SCL ficam definitivos no mês corrente." : "Sem decisão de quem arca, a reserva continua em conferência até a decisão."} O resultado não se desfaz pelo sistema: uma correção depois é um ajuste.`,
    },
  };
}

// ---------------------------------------------------------------- "Documentos para a defesa"

/** A página para imprimir "Documentos para a defesa", montada na hora (nada é gravado). */
export type DocumentosParaDefesa = {
  reserva: [string, string][];
  pagamentos: { titulo: string; linhas: [string, string][] }[];
  /** A Política de cancelamento que o hóspede aceitou (a versão, quando, o resumo e o texto, com os valores congelados nela). */
  politica: { titulo: string; quando: string; resumo: Bloco[] | null; blocos: Bloco[] } | null;
  portaria: string | null;
  porFora: readonly string[];
};

/** O que o sistema não tem e a equipe junta por fora. */
export const DOCUMENTOS_POR_FORA = [
  "A conversa com o hóspede (WhatsApp, e-mail ou a plataforma), com as datas combinadas e a confirmação da estadia.",
  "O registro de entrada e saída do prédio (portaria), quando houver.",
  "Fotos do imóvel na entrada e na saída, e de qualquer problema relatado.",
  "O comprovante de qualquer devolução já feita ao hóspede.",
] as const;

/**
 * "Documentos para a defesa" (reserva:editar ou financeiro:editar, conferido por quem chama): o resumo da reserva (código,
 * imóvel, datas, pessoas), o pagamento de cada disputa (ids, data, forma, verificação do banco), a política aceita (versão,
 * horário e texto) e a lista da portaria (M6.4, quando o imóvel exige), e o que a equipe junta por fora. Montada na hora,
 * nunca gravada. null = a reserva não é desta empresa ou não tem disputa. O valor pago só com `verValores` (quem lê o
 * financeiro, como na ficha): a operação abre a página sem ver valores. O resumo segue a lista do desenho (sem o nome do
 * titular: a equipe junta por fora o que o Mercado Pago pedir).
 */
export async function documentosParaDefesa(db: Db, organizacaoId: string, reservaId: string, o: { verValores: boolean }): Promise<DocumentosParaDefesa | null> {
  if (!uuidValido(reservaId)) return null;
  const [r] = await db
    .select({ r: reservas, imovelCodigo: imoveis.codigo, imovelNome: imoveis.nome })
    .from(reservas)
    .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
    .where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)));
  if (!r) return null;
  const { ps, ls } = await disputasDaReserva(db, organizacaoId, reservaId);
  if (!ls.length) return null;
  const disputados = ps.filter((p) => ls.some((l) => l.pagamentoId === p.id));
  // A política do pagamento disputado mais antigo (a da reserva; a da diferença de uma alteração segue a mesma, D11).
  const politica = await politicaDoPagamento(db, organizacaoId, disputados[0].id);
  // O texto da versão aceita, com os valores congelados nela (o que o hóspede leu), como a página da política no site.
  const versao = politica ? (await lerPaginaLegal(db, organizacaoId, "cancelamento")).find((v) => v.numero === politica.versao) : undefined;
  const blocos = (texto: string | undefined) => (versao && texto?.trim() ? blocosDoDocumento(preencherCampos(texto, versao.valores)) : null);
  const aceite = politica ? (await aceitesDaReserva(db, organizacaoId, reservaId)).find((a) => a.versoes.cancelamento === politica.versao) : undefined;
  let portaria: string | null = null;
  if ((await imoveisComPortaria(db, organizacaoId)).includes(r.r.imovelId)) {
    const [c] = await db.select().from(portariaChecklists).where(and(eq(portariaChecklists.reservaId, reservaId), eq(portariaChecklists.organizacaoId, organizacaoId)));
    portaria = c
      ? `Documentos recebidos: ${c.documentosRecebidos} de ${r.r.hospedes ?? "?"} pessoa(s)${c.encaminhadoEm ? `; encaminhados à portaria em ${diaMesBr(c.encaminhadoEm)}` : ""}${c.entregaConfirmadaEm ? `; entrega confirmada em ${diaMesBr(c.entregaConfirmadaEm)}` : ""}.`
      : "O imóvel exige documentos na portaria, mas a lista desta reserva não foi preenchida (Portaria).";
  }
  return {
    reserva: [
      ["Reserva", r.r.codigo],
      ["Imóvel", `${r.imovelCodigo} · ${r.imovelNome}`],
      ["Entrada e saída", `${dataBr(r.r.checkin)} → ${dataBr(r.r.checkout)}`],
      ["Pessoas", r.r.hospedes === null ? "não informado" : String(r.r.hospedes)],
    ],
    pagamentos: disputados.map((p) => ({
      titulo: `${p.forma === "cartao" ? "Cartão de crédito" : "Pix"} de ${diaBr(p.criadoEm)}`,
      linhas: [
        ["Order no Mercado Pago", p.idProvedor ?? "—"],
        ["Referência", p.referencia],
        ["Número do pagamento", p.idPagamentoProvedor ?? "—"],
        ["Aprovado em", p.aprovadoEm ? diaHoraBr(p.aprovadoEm) : "—"],
        ...(o.verValores ? ([["Valor pago", formatBRL(p.valorPago ?? p.valor)]] as [string, string][]) : []),
        ["Verificação do banco", verificacaoDoBanco({ tresDSStatus: ls.find((l) => l.pagamentoId === p.id)?.tresDSStatus ?? p.tresDSStatus }, p)],
        ...ls.filter((l) => l.pagamentoId === p.id).map((l) => [cabecalhoDaDisputa(l), l.idCaso ? `caso ${l.idCaso}` : "número do caso não informado"] as [string, string]),
      ],
    })),
    politica:
      politica && versao
        ? {
            titulo: `${PAGINAS_LEGAIS.cancelamento.titulo}, versão ${politica.versao} de ${dataBr(politica.data)}`,
            quando: aceite ? `Aceita pelo hóspede no site em ${diaHoraBr(aceite.aceitoEm)} (antes de pagar).` : "A versão com que o pagamento foi criado.",
            resumo: blocos(versao.secoes.resumo),
            blocos: blocos(versao.secoes.texto) ?? [],
          }
        : null,
    portaria,
    porFora: DOCUMENTOS_POR_FORA,
  };
}

// ---------------------------------------------------------------- o "Como funciona" com a seção das disputas

/** O proprietário já aceitou uma versão do "Como funciona" com a seção "Contestações de pagamento" preenchida (sem isso, o aviso). */
export async function aceitouComoFuncionaDasDisputas(db: Db, organizacaoId: string, proprietarioId: string | null): Promise<boolean> {
  if (!proprietarioId || !uuidValido(proprietarioId)) return false;
  const versoes = (await lerComoFunciona(db, organizacaoId)).filter((v) => v.secoes.contestacoes?.trim());
  if (!versoes.length) return false;
  const aceites = await db
    .select({ versao: aceitesDocumento.versao })
    .from(aceitesDocumento)
    .where(and(eq(aceitesDocumento.organizacaoId, organizacaoId), eq(aceitesDocumento.documento, DOCUMENTO_COMO_FUNCIONA), eq(aceitesDocumento.proprietarioId, proprietarioId)));
  return aceites.some((a) => versoes.some((v) => v.numero === a.versao));
}

/** O aviso do "Como funciona" ao lado da decisão (sem bloquear). */
export const avisoDoComoFunciona = (aceitou: boolean) => (aceitou ? null : TEXTO_SEM_COMO_FUNCIONA);

/** Quanto o proprietário já recebeu desta reserva (as partes repassadas e pagas) e o que está num repasse ainda a pagar. */
export async function recebidoPeloProprietario(db: Db, organizacaoId: string, proprietarioId: string | null, reservaId: string, agora: Date): Promise<string | null> {
  if (!proprietarioId) return null;
  const partes = (await partesDoProprietario(db, organizacaoId, proprietarioId, agora, { reservaIds: [reservaId] })).filter((x) => !x.disputa);
  const pago = partes.filter((x) => x.situacao === "repassado" && x.repasse?.situacao === "pago").reduce((s, x) => s + x.valor, 0);
  const aPagar = partes.filter((x) => x.situacao === "repassado" && x.repasse?.situacao !== "pago").reduce((s, x) => s + x.valor, 0);
  const esperando = partes.filter((x) => x.situacao !== "repassado").reduce((s, x) => s + x.valor, 0);
  return `O proprietário já recebeu ${formatBRL(pago)} desta reserva${aPagar ? `; ${formatBRL(aPagar)} estão num repasse ainda a pagar` : ""}${esperando ? `; ${formatBRL(esperando)} ainda não foram repassados` : ""}.`;
}
