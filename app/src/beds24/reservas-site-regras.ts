/**
 * Reserva paga do site no Beds24 (M8.3, desenho em `requisitos/product/RESERVA-SITE-BEDS24.md`): as regras puras, sem
 * banco e sem rede. Aqui ficam as listas fechadas das duas tabelas (`beds24_reservas_site`, o acompanhamento, e
 * `beds24_reservas_operacoes`, a fila e o histórico), a régua que decide se uma reserva vai ao Beds24 e o que fazer com
 * ela (seção 2.1), o `esperado` com a assinatura, as chaves de idempotência (3.3) e a leitura dos escopos da credencial
 * (prontidão, seção 7). Nada disto escreve no Beds24: a escrita é o M8.3c, atrás de `escritaReservasBeds24Pronta`.
 *
 * O SCL é o dono da reserva (valor, financeiro, hóspede, situação); o Beds24 só espelha o quarto, as datas, o número de
 * pessoas e a situação. Nenhum dado pessoal nem valor sai daqui.
 */
import { createHash } from "node:crypto";
import { contratoVigente } from "@/contratos/regras";
import type { EstadoReserva } from "@/db/schema";
import { contratoDeMarketplace, type ContratoParaMotor } from "@/financeiro/motor";
import type { CredencialBeds24, EstadoBeds24, ReservaBeds24 } from "./tipos";

// ---------------------------------------------------------------- listas fechadas (desenho 3.2 e 3.4)

/**
 * Situação do acompanhamento (o que a equipe vê). "Desligada" não é gravada: a tela calcula (chave, pausa ou imóvel
 * desligado, ou nenhuma linha).
 */
export const SITUACOES_ACOMPANHAMENTO_BEDS24 = ["pendente", "em_envio", "conferida", "divergente", "conflito", "aguardando_equipe", "manual", "encerrada"] as const;
export type SituacaoAcompanhamentoBeds24 = (typeof SITUACOES_ACOMPANHAMENTO_BEDS24)[number];

/** Motivos de configuração: param as criações e viram um aviso só (não um por reserva). */
export const MOTIVOS_CONFIGURACAO_BEDS24 = ["sem_vinculo", "sem_credencial", "escopo_excessivo", "escopo_fora_de_ordem", "sem_ensaio", "marca_ilegivel"] as const;
/**
 * Motivo do acompanhamento: lista fechada, sem resposta crua do provedor e sem dado pessoal. Os rótulos ficam na tela
 * (o domínio devolve só códigos).
 */
export const MOTIVOS_ACOMPANHAMENTO_BEDS24 = [
  ...MOTIVOS_CONFIGURACAO_BEDS24,
  // Situação manual ou bloqueio
  "anterior_a_ligar", "deixada_a_mao", "bloqueio_manual", "bloqueio_do_scl",
  // Incerteza e recusa
  "incerta", "duplicada", "marca_em_registro_inesperado", "sem_permissao", "recusada_pelo_beds24", "sem_disponibilidade",
  // Conflito, falha e divergência
  "noites_ocupadas", "falhas", "mudada_no_beds24", "cancelada_no_beds24", "apagada_no_beds24",
] as const;
export type MotivoAcompanhamentoBeds24 = (typeof MOTIVOS_ACOMPANHAMENTO_BEDS24)[number];

/** `vincular`: o id informado pela equipe ("Já existe, vincular o id"). `ensaio`: o teste real em Integrações, sem reserva no SCL. */
export const TIPOS_OPERACAO_BEDS24 = ["criar", "atualizar", "cancelar", "vincular", "ensaio"] as const;
export type TipoOperacaoBeds24 = (typeof TIPOS_OPERACAO_BEDS24)[number];

/** `simulacao`: o botão "Simular" (fora da produção ou com a chave desligada), sem rede. */
export const MODOS_OPERACAO_BEDS24 = ["real", "simulacao"] as const;
export type ModoOperacaoBeds24 = (typeof MODOS_OPERACAO_BEDS24)[number];

/**
 * Situação da operação: pendente → enviando → feita → conferida | divergente | incerta; também conflito, recusada,
 * falhou ou superada. `simulada` só existe fora da produção ou com a chave desligada.
 */
export const SITUACOES_OPERACAO_BEDS24 = ["pendente", "enviando", "incerta", "feita", "conferida", "divergente", "conflito", "recusada", "falhou", "superada", "simulada"] as const;
export type SituacaoOperacaoBeds24 = (typeof SITUACOES_OPERACAO_BEDS24)[number];
/** No máximo uma por reserva (índice único parcial em `beds24_reservas_operacoes`). */
export const SITUACOES_OPERACAO_ATIVAS = ["pendente", "enviando", "incerta"] as const satisfies readonly SituacaoOperacaoBeds24[];

// ---------------------------------------------------------------- o que o SCL quer no Beds24

/** Situação que o SCL manda ao Beds24 (confirmed / cancelled na API). */
export type SituacaoEsperadaBeds24 = "confirmada" | "cancelada";

/** O que o SCL quer no Beds24 (`beds24_reservas_site.esperado`): quarto, datas, pessoas e situação. Nada do hóspede nem valor. */
export type EsperadoBeds24 = {
  /** roomId do Beds24: na criação, o do vínculo; depois, sempre o quarto guardado (nunca troca de quarto). */
  quarto: string;
  chegada: string;
  saida: string;
  /** O total de pessoas da reserva (o SCL só guarda o total); null só no cancelamento de uma reserva sem o número. */
  hospedes: number | null;
  situacao: SituacaoEsperadaBeds24;
};

/** Uma leitura do Beds24 nos mesmos campos (`lido`, `antes`, `depois`): a situação como o SCL a normaliza. */
export type LidoBeds24 = { quarto: string; chegada: string; saida: string; hospedes: number | null; situacao: EstadoBeds24 };

/** Resumo do que foi ou seria enviado (`beds24_reservas_operacoes.pedido`): sem nome real, e-mail, telefone nem valor. */
export type PedidoBeds24 = EsperadoBeds24 & { referencia: string };

/**
 * Assinatura do `esperado` (desenho 3.3): sha256 truncado de `room_id|chegada|saida|hospedes|situacao`. Igual à da
 * última intenção = nada a enviar; diferente = intenção nova.
 */
export function assinaturaEsperado(e: EsperadoBeds24): string {
  return createHash("sha256").update([e.quarto, e.chegada, e.saida, e.hospedes ?? "", e.situacao].join("|")).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------- chaves de idempotência (desenho 3.3)

/** `<tipo>:<reservaId>:<versao>`, com a versão do acompanhamento (sobe quando nasce uma intenção nova). */
export const chaveOperacaoBeds24 = (tipo: Exclude<TipoOperacaoBeds24, "ensaio">, reservaId: string, versao: number) => `${tipo}:${reservaId}:${versao}`;
/** O ensaio não tem reserva: um uuid por ensaio. */
export const chaveEnsaioBeds24 = (id: string) => `ensaio:${id}`;
/**
 * A simulação repete a linha só quando a última simulação desta reserva é a mesma intenção: o tipo e a assinatura. O mesmo
 * estado simulado antes como criação e depois como atualização são duas intenções (a linha guarda o tipo). A chave leva o id
 * da simulação anterior (`primeira`, sem ela): voltar a um estado já simulado (A→B→A) grava uma linha nova, e dois cliques
 * ao mesmo tempo continuam dando uma linha só.
 */
export const chaveSimulacaoBeds24 = (reservaId: string, tipo: AcaoBeds24, assinatura: string, anterior: string | null) => `simulacao:${reservaId}:${tipo}:${assinatura}:${anterior ?? "primeira"}`;

// ---------------------------------------------------------------- a régua (desenho 2.1)

export type AcaoBeds24 = "criar" | "atualizar" | "cancelar";

/** A reserva como a régua lê (só o que decide). */
export type ReservaParaBeds24 = {
  fonte: string;
  estado: EstadoReserva;
  checkin: string;
  checkout: string;
  hospedes: number | null;
  /** Quando passou a confirmada (vazio = não se sabe). */
  confirmadaEm: Date | null;
};

/** O resto que a régua precisa, lido por quem chama (sem banco aqui). */
export type ContextoParaBeds24 = {
  /** Hoje em America/Sao_Paulo (AAAA-MM-DD). */
  hoje: string;
  /** Existe um pagamento com `desfecho = 'reserva'` para ela (a confirmação normal, a tardia e a confirmada pela equipe que depois recebeu o pagamento). */
  pagaPeloSite: boolean;
  /** Contratos do imóvel: vale o vigente na data de entrada, pela régua do motor. */
  contratos: readonly ContratoParaMotor[];
  /** O imóvel na configuração `reservas_beds24` (D6); null = desligado. */
  ligacao: { ligadoEm: string } | null;
  /** Há um `cancelamentos_reserva` em `situacao = 'cancelada'` para ela. */
  cancelamentoDecidido: boolean;
  /** Quarto do vínculo único e válido do imóvel (o da criação); null = sem vínculo único. */
  quartoDoVinculo: string | null;
  /** O acompanhamento dela, se já existe. `quarto` = o quarto guardado (onde foi ou vai ser criada). */
  acompanhamento: { situacao: SituacaoAcompanhamentoBeds24; quarto: string | null; assinaturaEsperada: string | null } | null;
  /** O id no Beds24 ligado a ela: `reservas.beds24_id` ou o `beds24_id` de uma operação dela. null = nenhum. */
  beds24Id: string | null;
};

/** Por que a reserva não vai ao Beds24 agora (códigos; os rótulos ficam na tela). */
export type MotivoForaBeds24 =
  /** Outra fonte (Beds24, planilha, manual) ou a reserva-pedido de uma alteração (`fonte = 'alteracao'`). */
  | "outra_fonte"
  /** Pedido ou hold (`estado = 'pedido'`): nunca vai ao Beds24. */
  | "pedido"
  /** Nem confirmada nem cancelada (pendente, consulta). */
  | "nao_confirmada"
  /** Sem pagamento com desfecho `reserva` (inclui o pedido confirmado à mão sem pagamento, D3). */
  | "sem_pagamento"
  /** Sem contrato vigente na entrada: não dá para saber se é marketplace (avisar em vez de supor). */
  | "sem_contrato"
  /** Contrato de marketplace na entrada: fora até o M12.2. */
  | "marketplace"
  /** A equipe cuida à mão: o M8.3 não escreve. */
  | "manual"
  | "encerrada"
  /** Saída já passou: criar exige saída depois de hoje; atualizar, saída a partir de hoje. */
  | "estadia_terminou"
  /** Imóvel desligado na configuração: só a criação para. */
  | "imovel_desligado"
  /** Sem o número de pessoas: nada é inventado. */
  | "sem_hospedes"
  /** Ligada a um registro do Beds24 que o M8.3 não criou (sem acompanhamento com o quarto guardado). */
  | "ja_no_beds24"
  /** Conflito ou aguardando a equipe: nada sai sozinho até a equipe decidir. */
  | "aguardando_equipe"
  /** Diferente no Beds24: a atualização automática fica suspensa até a equipe agir. */
  | "divergente"
  /** O SCL não mudou desde a última intenção. */
  | "sem_mudanca"
  /** Cancelada sem um cancelamento decidido (`cancelamentos_reserva` em `cancelada`). */
  | "cancelada_sem_decisao"
  /** Cancelada sem reserva criada pelo M8.3 no Beds24: nada a cancelar lá. */
  | "cancelada_sem_beds24";

export type DecisaoBeds24 =
  | { decisao: "fora"; motivo: MotivoForaBeds24 }
  /** Confirmada antes de o imóvel ser ligado (ou sem `confirmadaEm`): o acompanhamento nasce `manual`. */
  | { decisao: "manual"; motivo: "anterior_a_ligar" }
  /** Iria ao Beds24, mas falta configuração: o acompanhamento fica `pendente` com o motivo. */
  | { decisao: "parada"; motivo: "sem_vinculo" }
  | { decisao: "enviar"; acao: AcaoBeds24; esperado: EsperadoBeds24; assinatura: string };

const fora = (motivo: MotivoForaBeds24): DecisaoBeds24 => ({ decisao: "fora", motivo });

function enviar(acao: AcaoBeds24, esperado: EsperadoBeds24, anterior: string | null): DecisaoBeds24 {
  const assinatura = assinaturaEsperado(esperado);
  return assinatura === anterior ? fora("sem_mudanca") : { decisao: "enviar", acao, esperado, assinatura };
}

/**
 * A régua (desenho 2.1), uma função, um lugar: a reserva entra quando é do site (`fonte = 'site'`), tem um pagamento com
 * desfecho `reserva` e o contrato vigente na entrada não é marketplace (a mesma régua do motor; o M12.2 retira esta
 * condição). Então:
 * - **criar**: confirmada, saída depois de hoje, sem reserva no Beds24 ligada a ela, imóvel ligado (D6) e confirmada a
 *   partir da ligação — senão nasce `manual` (`anterior_a_ligar`; vale ao nascer o acompanhamento: "mudança vale daquela
 *   data para frente");
 * - **atualizar**: reserva criada pelo M8.3 no Beds24, ainda confirmada, saída a partir de hoje, e a assinatura de agora
 *   diferente da última intenção; suspensa com o acompanhamento `divergente`;
 * - **cancelar**: cancelada com o cancelamento decidido e reserva criada pelo M8.3; segue com `divergente` e com o imóvel
 *   desligado (só a pausa geral, lida por quem chama, para o cancelamento).
 * Nunca entram o pedido ou hold, a reserva-pedido da alteração (a alteração `segurada` ainda não mudou a reserva), o
 * pagamento sem reserva (não tem reserva), as outras fontes nem o marketplace. O que já está `manual` ou `encerrada`
 * nunca é escrito.
 */
export function reservaDoSiteParaBeds24(r: ReservaParaBeds24, c: ContextoParaBeds24): DecisaoBeds24 {
  if (r.fonte !== "site") return fora("outra_fonte");
  if (r.estado === "pedido") return fora("pedido");
  if (!c.pagaPeloSite) return fora("sem_pagamento");
  const contrato = contratoVigente(c.contratos, r.checkin);
  if (!contrato) return fora("sem_contrato");
  if (contratoDeMarketplace(contrato)) return fora("marketplace");
  const a = c.acompanhamento;
  if (a?.situacao === "manual") return fora("manual");
  if (a?.situacao === "encerrada") return fora("encerrada");
  // "Criada pelo M8.3": o acompanhamento guarda o quarto e há um id do Beds24 ligado a ela.
  const criadaPeloScl = Boolean(a?.quarto && c.beds24Id);

  if (r.estado === "cancelada") {
    if (!c.cancelamentoDecidido) return fora("cancelada_sem_decisao");
    if (!criadaPeloScl) return fora("cancelada_sem_beds24");
    return enviar("cancelar", { quarto: a!.quarto!, chegada: r.checkin, saida: r.checkout, hospedes: r.hospedes, situacao: "cancelada" }, a!.assinaturaEsperada);
  }
  if (r.estado !== "confirmada") return fora("nao_confirmada");
  const hospedesValidos = r.hospedes !== null && Number.isInteger(r.hospedes) && r.hospedes >= 1;

  if (criadaPeloScl) {
    if (r.checkout < c.hoje) return fora("estadia_terminou");
    if (a!.situacao === "divergente") return fora("divergente");
    if (a!.situacao === "conflito" || a!.situacao === "aguardando_equipe") return fora("aguardando_equipe");
    if (!hospedesValidos) return fora("sem_hospedes");
    return enviar("atualizar", { quarto: a!.quarto!, chegada: r.checkin, saida: r.checkout, hospedes: r.hospedes, situacao: "confirmada" }, a!.assinaturaEsperada);
  }
  if (c.beds24Id) return fora("ja_no_beds24");

  // Criação.
  if (r.checkout <= c.hoje) return fora("estadia_terminou");
  if (a && (a.situacao === "conflito" || a.situacao === "aguardando_equipe" || a.situacao === "divergente")) return fora("aguardando_equipe");
  if (!c.ligacao) return fora("imovel_desligado");
  if (!a) {
    const ligadoEm = Date.parse(c.ligacao.ligadoEm);
    if (!r.confirmadaEm || Number.isNaN(ligadoEm) || r.confirmadaEm.getTime() < ligadoEm) return { decisao: "manual", motivo: "anterior_a_ligar" };
  }
  if (!hospedesValidos) return fora("sem_hospedes");
  if (!c.quartoDoVinculo) return { decisao: "parada", motivo: "sem_vinculo" };
  return enviar("criar", { quarto: c.quartoDoVinculo, chegada: r.checkin, saida: r.checkout, hospedes: r.hospedes, situacao: "confirmada" }, a?.assinaturaEsperada ?? null);
}

// ---------------------------------------------------------------- leitura, adoção e conferência (desenho 3.5, 4.3 e 5.2)

/** O registro do Beds24 nos campos que o M8.3 compara (`lido`, `antes`, `depois`): nada do hóspede nem valor. */
export const lidoDoRegistro = (b: Pick<ReservaBeds24, "roomId" | "checkin" | "checkout" | "hospedes" | "estado">): LidoBeds24 => ({ quarto: b.roomId, chegada: b.checkin, saida: b.checkout, hospedes: b.hospedes, situacao: b.estado });

/**
 * A assinatura do que o SCL quer agora, pela mesma conta da régua (desenho 3.3): o quarto guardado, as datas e as pessoas
 * da reserva, e a situação (confirmada ou cancelada). null = a reserva não está em nenhuma das duas (nada a comparar).
 */
export function assinaturaAtualDoScl(r: Pick<ReservaParaBeds24, "estado" | "checkin" | "checkout" | "hospedes">, quarto: string): string | null {
  if (r.estado !== "confirmada" && r.estado !== "cancelada") return null;
  return assinaturaEsperado({ quarto, chegada: r.checkin, saida: r.checkout, hospedes: r.hospedes, situacao: r.estado });
}

/** O que mudou no Beds24 por fora: o motivo do acompanhamento e se as datas, a situação ou o quarto mudaram (não só as pessoas). */
export type DiferencaNoBeds24 = { motivo: "mudada_no_beds24" | "cancelada_no_beds24" | "apagada_no_beds24"; soPessoas: boolean };

/**
 * Compara a leitura do Beds24 com o `esperado` (o que o SCL mandou): `lido` null = o registro não voltou na leitura por id
 * (apagado). As pessoas só contam quando o esperado é confirmado e tem o número. Igual = null.
 */
export function diferencaNoBeds24(esperado: EsperadoBeds24, lido: LidoBeds24 | null): DiferencaNoBeds24 | null {
  if (!lido) return { motivo: "apagada_no_beds24", soPessoas: false };
  if (esperado.situacao === "confirmada" && lido.situacao === "cancelada") return { motivo: "cancelada_no_beds24", soPessoas: false };
  if (lido.situacao !== esperado.situacao || lido.quarto !== esperado.quarto || lido.chegada !== esperado.chegada || lido.saida !== esperado.saida) return { motivo: "mudada_no_beds24", soPessoas: false };
  if (esperado.situacao === "confirmada" && esperado.hospedes !== null && lido.hospedes !== esperado.hospedes) return { motivo: "mudada_no_beds24", soPessoas: true };
  return null;
}

/**
 * A marca do SCL no registro ligado a uma reserva do site (D11; desenho 3.4 e 4.4): null = é a marca desta reserva. Sem marca
 * legível (o info item apagado no Beds24, a credencial que não lê os info items, ou dois códigos): `marca_ilegivel`. Com o
 * código de outra reserva, ou a marca do ensaio: `mudada_no_beds24` (marca alterada). Nos dois casos a conferência não bate.
 */
export function diferencaNaMarca(b: Pick<ReservaBeds24, "referenciaScl" | "ensaio">, codigo: string): "marca_ilegivel" | "mudada_no_beds24" | null {
  if (!b.ensaio && b.referenciaScl === codigo) return null;
  return !b.ensaio && b.referenciaScl === null ? "marca_ilegivel" : "mudada_no_beds24";
}

/** O que a criação esperava encontrar no Beds24: o quarto guardado (na criação, o do vínculo) e as datas do `esperado`. */
export type EsperadoDaAdocao = { quarto: string; chegada: string; saida: string };

export type DecisaoAdocao =
  | { adotar: true; registro: ReservaBeds24 }
  /** Nenhum registro com a marca. */
  | { adotar: false; motivo: "nenhum" }
  /** Dois ou mais registros com a marca: a equipe decide (nenhum POST). */
  | { adotar: false; motivo: "duplicada"; ids: string[] }
  /** Um registro com a marca, mas não bate (situação, quarto ou datas): a equipe confere (nenhum POST). */
  | { adotar: false; motivo: "marca_em_registro_inesperado"; id: string };

/**
 * As regras de adoção (desenho 3.5), iguais no trabalhador, na importação e em "Vincular": exatamente um registro com a
 * marca, em `confirmed` ou `new` (a confirmada do SCL), no quarto guardado, com a chegada e a saída do esperado. Um
 * `black` ou um `cancelled` com o código, ou outras datas, é marca em registro inesperado; dois ou mais, duplicada.
 * `comMarca` são os registros lidos com a marca desta reserva (o ensaio nunca entra). Sem esperado, nada se adota.
 */
export function regraDeAdocao(comMarca: readonly ReservaBeds24[], esperado: EsperadoDaAdocao | null): DecisaoAdocao {
  const ids = [...new Set(comMarca.map((b) => b.idExterno))];
  if (!ids.length) return { adotar: false, motivo: "nenhum" };
  if (ids.length > 1) return { adotar: false, motivo: "duplicada", ids: ids.sort() };
  const b = comMarca[0];
  if (!esperado || b.estado !== "confirmada" || b.roomId !== esperado.quarto || b.checkin !== esperado.chegada || b.checkout !== esperado.saida) return { adotar: false, motivo: "marca_em_registro_inesperado", id: b.idExterno };
  return { adotar: true, registro: b };
}

// ---------------------------------------------------------------- escopos da credencial (prontidão, desenho 7)

/**
 * Os escopos que o convite novo pede, exatamente (desenho 7, D10): todos precisam estar na credencial, e nenhum outro.
 * As leituras de reservas e de calendário vêm explícitas, sem supor que a escrita já as dá (a confirmar com o suporte,
 * seção 12, item 7): a importação e as releituras usam a mesma credencial.
 */
export const ESCOPOS_OBRIGATORIOS_BEDS24: readonly string[] = [
  "read:bookings",
  "write:bookings",
  "read:bookings-personal",
  "read:bookings-financial",
  "read:properties",
  "read:inventory",
  "write:inventory",
];

/**
 * O que a prontidão diz dos escopos lidos em GET /authentication/details, comparando com a lista exata do convite:
 * - `escopo_excessivo`: qualquer escopo fora da lista, o que inclui "all", apagar, escrita de dados pessoais
 *   (`write:bookings-personal`, que daria POST /bookings/messages) e qualquer outra escrita ou leitura — nada é escrito;
 * - `ilegivel`: a resposta não deu para ler, ou trouxe item fora do formato conhecido (nunca conta como em ordem);
 * - `incompleto`: falta algum dos escopos da lista (`faltando`), a escrita de reservas inclusive;
 * - `em_ordem`: exatamente a lista, nada a mais e nada a menos.
 * `faltando` só vem quando a lista foi lida inteira: com item fora do formato, o que parece faltar pode estar lá.
 */
export type ProntidaoEscoposBeds24 = { situacao: "em_ordem" | "escopo_excessivo" | "ilegivel" | "incompleto"; excessivos: string[]; faltando: string[] };

export const escopoExcessivoBeds24 = (e: string): boolean => !ESCOPOS_OBRIGATORIOS_BEDS24.includes(e);

export function avaliarEscoposBeds24(c: Pick<CredencialBeds24, "escopos" | "ilegiveis">): ProntidaoEscoposBeds24 {
  const escopos = c.escopos ?? [];
  const legivel = c.escopos !== null && !c.ilegiveis.length;
  const excessivos = escopos.filter(escopoExcessivoBeds24);
  const faltando = legivel ? ESCOPOS_OBRIGATORIOS_BEDS24.filter((e) => !escopos.includes(e)) : [];
  if (excessivos.length) return { situacao: "escopo_excessivo", excessivos, faltando };
  if (!legivel) return { situacao: "ilegivel", excessivos, faltando };
  if (faltando.length) return { situacao: "incompleto", excessivos, faltando };
  return { situacao: "em_ordem", excessivos, faltando };
}

/**
 * O motivo de configuração que a prontidão grava para os escopos (desenho 2.4 e 3.2), o único lugar desta tradução:
 * a mais é `escopo_excessivo` (nada é escrito); faltando ou ilegível é `escopo_fora_de_ordem` (as criações param);
 * em ordem não tem motivo.
 */
export function motivoDosEscoposBeds24(a: Pick<ProntidaoEscoposBeds24, "situacao">): "escopo_excessivo" | "escopo_fora_de_ordem" | null {
  if (a.situacao === "em_ordem") return null;
  return a.situacao === "escopo_excessivo" ? "escopo_excessivo" : "escopo_fora_de_ordem";
}
