/**
 * Reserva paga do site no Beds24 (M8.3, desenho em `requisitos/product/RESERVA-SITE-BEDS24.md`): as regras puras, sem
 * banco e sem rede. Aqui ficam as listas fechadas das duas tabelas (`beds24_reservas_site`, o acompanhamento, e
 * `beds24_reservas_operacoes`, a fila e o histórico), a régua que decide se uma reserva vai ao Beds24 e o que fazer com
 * ela (seção 2.1), o `esperado` com a assinatura, as chaves de idempotência (3.3) e a leitura dos escopos da credencial
 * (prontidão, seção 7). M8.3c (a escrita, atrás de `escritaReservasBeds24Pronta`): o `detalhe` de forma fechada das
 * operações, as regras de adoção com a marca do info item e a origem (3.5), a resposta da fila à régua (3.3), as saídas da
 * incerteza (3.8), as janelas e os atrasos da rotina (9), os casos do e-mail à equipe (6.5) e o ensaio não resolvido (8 e
 * 5.2). Nada disto chama a rede:
 * quem escreve é o trabalhador (`reservas-site-envio.ts`), que decide por aqui.
 *
 * O SCL é o dono da reserva (valor, financeiro, hóspede, situação); o Beds24 só espelha o quarto, as datas, o número de
 * pessoas e a situação. Nenhum dado pessoal nem valor sai daqui.
 */
import { createHash } from "node:crypto";
import { contratoVigente } from "@/contratos/regras";
import type { EstadoReserva } from "@/db/schema";
import { contratoDeMarketplace, type ContratoParaMotor } from "@/financeiro/motor";
import { dataValida } from "@/reservas/regras";
import { canalDe } from "./normalizar";
import type { CanalBeds24, CredencialBeds24, EstadoBeds24, ObservadoNaGravacao, ReservaBeds24, RespostaBeds24 } from "./tipos";

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

/**
 * As respostas do Beds24 (`beds24_reservas_operacoes.resposta`, lista fechada `RESPOSTAS_BEDS24` no contrato do cliente,
 * `tipos.ts`) em grupos, para as saídas da incerteza (desenho 3.8). A recusa: `success: false`, `errors` ou outro 4xx —
 * nunca repete sozinha.
 */
export const RESPOSTAS_DE_RECUSA_BEDS24 = ["recusada_disponibilidade", "recusada", "http_4xx"] as const satisfies readonly RespostaBeds24[];
/** Sem resposta que se possa ler (tempo, rede, 5xx, formato): no máximo uma nova tentativa automática por intenção. */
export const RESPOSTAS_SEM_RESPOSTA_BEDS24 = ["tempo", "rede", "http_5xx", "formato"] as const satisfies readonly RespostaBeds24[];
const ehRecusa = (r: RespostaBeds24 | null) => r !== null && (RESPOSTAS_DE_RECUSA_BEDS24 as readonly string[]).includes(r);
const semResposta = (r: RespostaBeds24 | null) => r !== null && (RESPOSTAS_SEM_RESPOSTA_BEDS24 as readonly string[]).includes(r);

/** Os botões da ficha e de Integrações que abrem ou concluem uma operação (`detalhe.porBotao`; desenho 8). */
export const BOTOES_BEDS24 = [
  "conferir_agora", "tentar_de_novo", "deixar_a_mao", "reenviar", "nao_existe", "vincular", "passar_ao_sistema",
  "criar_ensaio", "cancelar_ensaio", "conferir_ensaio",
] as const;
export type BotaoBeds24 = (typeof BOTOES_BEDS24)[number];

/** Os botões da ficha da reserva (M8.3c, bloco G; desenho 8), na ordem em que a ficha os mostra. */
export const BOTOES_DA_FICHA_BEDS24 = ["conferir_agora", "tentar_de_novo", "deixar_a_mao", "reenviar", "nao_existe", "vincular", "passar_ao_sistema"] as const satisfies readonly BotaoBeds24[];
export type BotaoDaFichaBeds24 = (typeof BOTOES_DA_FICHA_BEDS24)[number];
/**
 * Os botões da ficha que pedem também `configuracao:editar` (desenho 8: hoje, só o admin), além de `reserva:editar`. Uma
 * regra, um lugar: a ficha esconde por ela, e a ação e o domínio (`reservas-site-botoes.ts`) recusam por ela.
 */
export const BOTOES_DE_CONFIGURACAO_BEDS24: readonly BotaoDaFichaBeds24[] = ["nao_existe", "vincular", "passar_ao_sistema"];

/** As noites de um bloqueio achado no Beds24 ou no SCL, `[inicio, fim)` como uma estadia (o texto mostra de dd/mm a dd/mm). */
export type BloqueioAchadoBeds24 = { inicio: string; fim: string };

/**
 * O que o ensaio observou na reserva que criou (desenho 8 e 12, itens 1, 9, 11 e 15), para a pergunta ao suporte: só nomes
 * de chave e de cabeçalho, o canal normalizado e a origem pela API já limpa (`ReservaBeds24.origemApi`) — nunca um valor.
 */
export type ObservadoNoEnsaioBeds24 = ObservadoNaGravacao & {
  canal: CanalBeds24 | null;
  origemApi: string | null;
  /** O `bookingTime` voltou legível (ISO com fuso); null = não houve releitura. */
  horaDaReservaLegivel: boolean | null;
};

/**
 * `beds24_reservas_operacoes.detalhe`: forma fechada, sem dado pessoal nem valor (só ids do Beds24, datas, códigos e nomes).
 * - `candidato`: o ocupante exato da incerteza (3.8, item 5), o id sugerido em "Vincular" — nunca vai para `beds24_id`;
 * - `duplicadas`: os ids com a marca desta reserva (a duplicada da adoção; no cancelamento, gravados antes do primeiro POST);
 * - `bloqueio`: o bloqueio achado sobre as noites (`black`, ou blackout que não é do SCL; 6.3);
 * - `encerradaPelaEquipe`: "Não existe, pode criar" encerrou a incerteza (não conta como nova tentativa automática);
 * - `marcaNaoLida`: "Vincular" sem a marca, com a segunda confirmação (a credencial não lê a marca);
 * - `observado`: o que o ensaio viu; `porBotao`: o botão que abriu ou concluiu a operação.
 */
export type DetalheOperacaoBeds24 = {
  candidato?: string;
  duplicadas?: string[];
  bloqueio?: BloqueioAchadoBeds24;
  encerradaPelaEquipe?: true;
  marcaNaoLida?: true;
  observado?: ObservadoNoEnsaioBeds24;
  porBotao?: BotaoBeds24;
};

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** Id do Beds24 só com os caracteres esperados (o mesmo critério dos avisos da importação). */
const idDoBeds24 = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(v) ? v : null);
const nomes = (v: unknown, padrao: RegExp, max: number) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && padrao.test(x)))].slice(0, max) : []);
const CANAIS: readonly CanalBeds24[] = ["airbnb", "booking", "direta", "outro"];

/**
 * O `detalhe` gravado → a forma fechada, sem palpite: o que não passa na validação some (nunca um texto livre guardado). A
 * mesma função antes de gravar e ao ler.
 */
export function detalheOperacaoBeds24(v: unknown): DetalheOperacaoBeds24 {
  if (!ehObj(v)) return {};
  const d: DetalheOperacaoBeds24 = {};
  const candidato = idDoBeds24(v.candidato);
  if (candidato) d.candidato = candidato;
  const duplicadas = Array.isArray(v.duplicadas) ? [...new Set(v.duplicadas.map(idDoBeds24).filter((x): x is string => x !== null))].sort().slice(0, 20) : [];
  if (duplicadas.length) d.duplicadas = duplicadas;
  if (ehObj(v.bloqueio) && typeof v.bloqueio.inicio === "string" && typeof v.bloqueio.fim === "string" && dataValida(v.bloqueio.inicio) && dataValida(v.bloqueio.fim) && v.bloqueio.inicio < v.bloqueio.fim) {
    d.bloqueio = { inicio: v.bloqueio.inicio, fim: v.bloqueio.fim };
  }
  if (v.encerradaPelaEquipe === true) d.encerradaPelaEquipe = true;
  if (v.marcaNaoLida === true) d.marcaNaoLida = true;
  if (ehObj(v.observado)) {
    const o = v.observado;
    d.observado = {
      chaveDoId: typeof o.chaveDoId === "string" && /^[A-Za-z0-9_]{1,40}$/.test(o.chaveDoId) ? o.chaveDoId : null,
      chavesEmNew: nomes(o.chavesEmNew, /^[A-Za-z0-9_]{1,40}$/, 20),
      cabecalhosDeCredito: nomes(o.cabecalhosDeCredito, /^[a-z0-9-]{1,60}$/, 10),
      canal: CANAIS.includes(o.canal as CanalBeds24) ? (o.canal as CanalBeds24) : null,
      origemApi: typeof o.origemApi === "string" && /^[A-Za-z0-9 ._:/-]{1,40}$/.test(o.origemApi) ? o.origemApi : null,
      horaDaReservaLegivel: typeof o.horaDaReservaLegivel === "boolean" ? o.horaDaReservaLegivel : null,
    };
  }
  if ((BOTOES_BEDS24 as readonly unknown[]).includes(v.porBotao)) d.porBotao = v.porBotao as BotaoBeds24;
  return d;
}

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

/**
 * "Criada pelo M8.3" (desenho 6.2): o acompanhamento guarda o quarto e há um id do Beds24 ligado a ela (`reservas.beds24_id`
 * ou o de uma operação real dela). Uma regra, um lugar: a régua e as tarefas das OTAs (M8.3b) leem daqui. Criada, o texto
 * manual fala da reserva no Beds24; senão, do bloqueio que a equipe fez à mão.
 */
export const criadaPeloM83 = (a: { quarto: string | null } | null, beds24Id: string | null): boolean => Boolean(a?.quarto && beds24Id);

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
  const criadaPeloScl = criadaPeloM83(a, c.beds24Id);

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

/** O canal nomeado (Airbnb, Booking.com), pela mesma leitura do canal da importação (`canalDe`). */
const canalNomeado = (c: CanalBeds24) => c === "airbnb" || c === "booking";

/**
 * A origem que pode ser a de uma reserva que o SCL criou pela API (desenho 3.8, item 5: "origem direta ou API"; 12, item 9),
 * uma regra para a adoção, as duplicadas do cancelamento e o ocupante exato: o canal direto ou a origem pela API informada
 * (`origemApi`), e nunca um canal nomeado, nem no canal nem na origem pela API (`apiSource: "Booking.com"` com o `channel`
 * vazio dá o canal "outro") — mudar a situação de uma reserva de canal pelo Beds24 libera o estoque sem cancelar na OTA. O
 * canal desconhecido sem a origem pela API ("outro", onde `canalDe` põe Expedia, Vrbo e qualquer outro) nunca basta: uma
 * venda dupla real deixaria de ser "possível venda dupla". **[I]** até o ensaio registrar o canal e a origem que a reserva
 * criada recebe (`detalhe.observado`, item 9).
 */
export const origemPodeSerDoScl = (b: Pick<ReservaBeds24, "canal" | "origemApi">): boolean =>
  !canalNomeado(b.canal) && !(b.origemApi !== null && canalNomeado(canalDe(b.origemApi))) && (b.canal === "direta" || b.origemApi !== null);

/**
 * O registro "nosso" (desenho 3.5 e 4.3), uma regra para a adoção (`regraDeAdocao`), o "Vincular" e as duplicadas vivas do
 * cancelamento: a marca do info item `SCL` (`marcaFonte = 'info'`; o código só no nome ou nas notas nunca basta) e a origem
 * que pode ser a do SCL (`origemPodeSerDoScl`). Uma reserva de OTA com o código no info item nunca é nossa: cancelá-la no
 * Beds24 liberaria o estoque sem cancelar na OTA (venda dupla).
 */
export const registroNossoBeds24 = (b: Pick<ReservaBeds24, "marcaFonte" | "canal" | "origemApi">): boolean => b.marcaFonte === "info" && origemPodeSerDoScl(b);

/**
 * As regras de adoção (desenho 3.5), iguais no trabalhador, na importação e em "Vincular": exatamente um registro com a
 * marca, em `confirmed` ou `new` (a confirmada do SCL), no quarto guardado, com a chegada e a saída do esperado. Um
 * `black` ou um `cancelled` com o código, ou outras datas, é marca em registro inesperado; dois ou mais dos nossos, duplicada.
 * M8.3c (3.5 e 4.3): "nosso" é só o registro com a marca do info item `SCL` e a origem que pode ser a do SCL
 * (`registroNossoBeds24`). A duplicada conta só os nossos: uma reserva de OTA com o código nas notas nunca entra nos
 * ids (eles vão para `detalhe.duplicadas` e para "cancele no Beds24", e cancelá-la lá liberaria o estoque sem cancelar na
 * OTA: venda dupla). O código só no nome ou nas notas, ou num registro de canal, é marca em registro inesperado: nunca
 * adotado (e depois cancelado pelo sistema). `comMarca` são os registros lidos com a marca desta reserva, de qualquer fonte e
 * em todas as situações (o ensaio nunca entra). Sem esperado, nada se adota.
 */
export function regraDeAdocao(comMarca: readonly ReservaBeds24[], esperado: EsperadoDaAdocao | null): DecisaoAdocao {
  if (!comMarca.length) return { adotar: false, motivo: "nenhum" };
  const nossos = comMarca.filter(registroNossoBeds24);
  const ids = [...new Set(nossos.map((b) => b.idExterno))];
  if (ids.length > 1) return { adotar: false, motivo: "duplicada", ids: ids.sort() };
  const estranho = comMarca.find((b) => !nossos.includes(b));
  if (estranho) return { adotar: false, motivo: "marca_em_registro_inesperado", id: estranho.idExterno };
  const b = nossos[0];
  if (!esperado || b.estado !== "confirmada" || b.roomId !== esperado.quarto || b.checkin !== esperado.chegada || b.checkout !== esperado.saida) return { adotar: false, motivo: "marca_em_registro_inesperado", id: b.idExterno };
  return { adotar: true, registro: b };
}

// ---------------------------------------------------------------- a fila diante da régua (desenho 3.3)

/** A operação da reserva na fila que ainda não teve POST (`pendente`, `enviado_em` nulo), lida na fase 1. */
export type OperacaoNaFila = { tipo: AcaoBeds24; enviadoEm: null };

/**
 * A operação da reserva que ainda não terminou (desenho 3.3: com POST tentado, "a seguinte espera ela terminar"): `enviando`,
 * `incerta`, `feita` (a criação adotada pela importação, que o passo 1 da volta termina: fora de `SITUACOES_OPERACAO_ATIVAS`
 * e do índice `uma_ativa`, por isso a conferência é explícita, aqui) ou a `pendente` que já teve POST. Enquanto houver uma,
 * nenhuma intenção nova nasce (`passoDaFila` responde `esperar`).
 */
export const operacaoEmCurso = (o: { situacao: SituacaoOperacaoBeds24; enviadoEm: Date | null }): boolean =>
  o.situacao === "enviando" || o.situacao === "incerta" || o.situacao === "feita" || (o.situacao === "pendente" && o.enviadoEm !== null);

/**
 * O que a fase 1 faz com a resposta da régua (desenho 3.3: a fila não é só a régua):
 * - `esperar`: há operação da reserva em curso (`operacaoEmCurso`) — nada muda e nenhuma intenção nova nasce, qualquer que
 *   seja a régua (a seguinte sai depois que ela terminar; uma `criar` incerta e a reserva cancelada no SCL esperam a saída
 *   da incerteza, nunca a leitura da 6.3 antes dela);
 * - `seguir`: a régua não vê mudança desde a fase 1 que gravou a da fila — ela segue para a fase 2 como está;
 * - `atualizar_no_lugar`: a mesma ação com o SCL mudado, sem POST — a da fila recebe o pedido, as alterações e o `esperado`
 *   de agora, com a mesma chave;
 * - `abrir`: nasce uma operação nova; `superar` = a da fila (outra ação) vira `superada` ANTES, na mesma transação (senão o
 *   índice `uma_ativa` dá 23505);
 * - `parar`: nada é enviado; `superar` = a da fila vira `superada` e nunca sai (por exemplo, a `criar` à espera do atraso de
 *   uma falha quando Diego desliga o imóvel, D6; deixada `pendente`, ela barraria também a marca manual, 6.4). `acompanhamento`:
 *   `manual_anterior_a_ligar` (nasce, ou vira, `manual`/`anterior_a_ligar`, sem quarto: desenho 2.1, item 5), `sem_vinculo`
 *   (`pendente`/`sem_vinculo`, sem tentativa: 2.4), `cancelar_antes_de_criar` (a cancelada sem reserva criada pelo M8.3 segue
 *   para a leitura de 6.3), `pendente` (sai de `em_envio`, ou de um motivo que a régua já não dá, para `pendente` sem motivo)
 *   ou null (nada muda: `manual`, `encerrada`, à espera da equipe, conferida).
 * A da fila é só a sem `enviado_em` (o tipo exige): a que teve POST está em curso, nunca vira `superada` por aqui e segue a
 * saída da incerteza. A pausa geral nunca chega aqui (o passo 0 da volta só lê, e a da fila continua `pendente`).
 */
export type PassoDaFila =
  | { passo: "esperar" }
  | { passo: "seguir" }
  | { passo: "atualizar_no_lugar"; esperado: EsperadoBeds24; assinatura: string }
  | { passo: "abrir"; acao: AcaoBeds24; esperado: EsperadoBeds24; assinatura: string; superar: boolean }
  | { passo: "parar"; superar: boolean; acompanhamento: "manual_anterior_a_ligar" | "sem_vinculo" | "cancelar_antes_de_criar" | "pendente" | null };

export function passoDaFila(d: DecisaoBeds24, daFila: OperacaoNaFila | null, acompanhamento: { situacao: SituacaoAcompanhamentoBeds24; motivo: MotivoAcompanhamentoBeds24 | null } | null, emCurso: boolean): PassoDaFila {
  if (emCurso) return { passo: "esperar" };
  if (d.decisao === "enviar") {
    if (daFila?.tipo === d.acao) return { passo: "atualizar_no_lugar", esperado: d.esperado, assinatura: d.assinatura };
    return { passo: "abrir", acao: d.acao, esperado: d.esperado, assinatura: d.assinatura, superar: daFila !== null };
  }
  const superar = daFila !== null;
  if (d.decisao === "manual") return { passo: "parar", superar, acompanhamento: "manual_anterior_a_ligar" };
  if (d.decisao === "parada") return { passo: "parar", superar, acompanhamento: "sem_vinculo" };
  if (d.motivo === "sem_mudanca") return superar ? { passo: "seguir" } : { passo: "parar", superar: false, acompanhamento: null };
  if (d.motivo === "cancelada_sem_beds24" && acompanhamento) return { passo: "parar", superar, acompanhamento: "cancelar_antes_de_criar" };
  const solto = acompanhamento !== null && (acompanhamento.situacao === "em_envio" || (acompanhamento.situacao === "pendente" && acompanhamento.motivo !== null));
  return { passo: "parar", superar, acompanhamento: solto ? "pendente" : null };
}

// ---------------------------------------------------------------- a incerteza (desenho 3.8)

/** Antes disto desde `enviado_em`, nada conclui "não existe": o tempo-limite aborta só o nosso lado, e o Beds24 ainda pode gravar. */
export const MINUTOS_ANTES_DE_CONCLUIR_BEDS24 = 5;
/** Na terceira busca sem conclusão, a incerteza vai à equipe (`aguardando_equipe`, motivo `incerta`). */
export const BUSCAS_ATE_A_EQUIPE_BEDS24 = 3;

/**
 * A incerteza só conclui 5 min depois do POST (desenho 3.8, item 1), uma regra para as saídas puras daqui e para o
 * trabalhador, que nem lê o Beds24 antes disso.
 */
export const podeConcluirIncertezaBeds24 = (enviadoEm: Date, agora: Date): boolean => agora.getTime() - enviadoEm.getTime() >= MINUTOS_ANTES_DE_CONCLUIR_BEDS24 * 60_000;

/**
 * A leitura que não concluiu (desenho 3.8, item 4), uma regra: `buscas_sem_conclusao` passa a `buscas` (o de agora + 1); na
 * terceira, `equipe` (`aguardando_equipe`, motivo `incerta`). O contador é da incerteza: toda conclusão o zera.
 */
export const buscaSemConclusaoBeds24 = (buscas: number) => ({ saida: "sem_conclusao" as const, buscas: buscas + 1, equipe: buscas + 1 >= BUSCAS_ATE_A_EQUIPE_BEDS24 });

/** Uma operação anterior da mesma reserva, no que a regra da nova tentativa olha. */
export type OperacaoAnteriorBeds24 = {
  tipo: TipoOperacaoBeds24;
  situacao: SituacaoOperacaoBeds24;
  enviadoEm: Date | null;
  resposta: RespostaBeds24 | null;
  pedido: PedidoBeds24 | null;
  detalhe: DetalheOperacaoBeds24;
};

/**
 * "Já houve nova tentativa automática" para esta intenção (desenho 3.8, item 3: no máximo uma por intenção): existe, para a
 * reserva, uma operação do mesmo tipo em `falhou`, com POST (`enviado_em`), sem resposta legível (tempo, rede, 5xx ou formato,
 * QUALQUER que seja: contar só a mesma resposta daria uma tentativa por tipo), a mesma assinatura e não encerrada pela equipe
 * ("Não existe, pode criar"). O `limite` e o `nao_enviado` não foram processados e não contam.
 */
export function jaHouveNovaTentativa(ops: readonly OperacaoAnteriorBeds24[], tipo: AcaoBeds24, assinatura: string): boolean {
  return ops.some((o) => o.tipo === tipo && o.situacao === "falhou" && o.enviadoEm !== null && semResposta(o.resposta) && o.pedido !== null && assinaturaEsperado(o.pedido) === assinatura && !o.detalhe.encerradaPelaEquipe);
}

/**
 * O que a saída da incerteza da criação leu, sempre junto e antes de qualquer decisão (desenho 3.8): a busca pela marca e os
 * ocupantes das noites. `funcionou: false` = alguma das leituras falhou ou não dá para concluir (registro ilegível, id
 * repetido, noite faltando). `credencialLeMarca` = o ensaio vale para a credencial usada e nenhum `marca_ilegivel` conta:
 * sem ela, "não achou" não conclui (desenho 3.5: a busca "funcionou" com a resposta válida E a credencial que lê a marca).
 */
export type LeituraDaIncerteza =
  | { funcionou: false }
  | { funcionou: true; adocao: DecisaoAdocao; ocupanteExato: string | null; credencialLeMarca: boolean };

/**
 * - `aguardar`: antes de 5 min desde `enviado_em`; nada conclui;
 * - `adotar`: a fase 3 adota (com a trava) e segue a conferência;
 * - `divergente`: `duplicada` ou `marca_em_registro_inesperado` — a operação vira `divergente` (terminal) e o acompanhamento
 *   `aguardando_equipe` com o motivo, os ids em `detalhe.duplicadas` ou `detalhe.candidato` ("Deixar à mão" e "Vincular" valem);
 * - `candidato`: o ocupante exato sem marca — `aguardando_equipe`/`incerta` com `detalhe.candidato`; a operação continua
 *   `incerta`, sem nova tentativa, e o id nunca vai para `beds24_id`; nunca "possível venda dupla";
 * - `recusada`: não achou, com a busca que funcionou, depois de uma recusa — a operação vira `recusada` e o acompanhamento
 *   `aguardando_equipe` com o motivo, com e-mail; nunca repete sozinha;
 * - `nova_tentativa`: não achou, sem resposta legível, e ainda sem nova tentativa para esta intenção — a operação vira `falhou`
 *   e nasce outra com `versao+1`, `pendente`, com o atraso da tabela de falhas;
 * - `equipe`: `aguardando_equipe`/`incerta`, e a operação continua `incerta` (a segunda incerteza, o `sem_id`, ou uma resposta
 *   que não devia estar aqui: avisar em vez de supor);
 * - `sem_conclusao`: a busca não funcionou — `buscas_sem_conclusao` passa a `buscas`; com `equipe`, `aguardando_equipe`/`incerta`.
 */
export type SaidaDaIncerteza =
  | { saida: "aguardar" }
  | { saida: "adotar"; registro: ReservaBeds24 }
  | { saida: "divergente"; motivo: "duplicada" | "marca_em_registro_inesperado"; ids: string[] }
  | { saida: "candidato"; id: string }
  | { saida: "recusada"; motivo: "sem_disponibilidade" | "recusada_pelo_beds24" }
  | { saida: "nova_tentativa" }
  | { saida: "equipe" }
  | { saida: "sem_conclusao"; buscas: number; equipe: boolean };

/**
 * A saída da incerteza da CRIAÇÃO (desenho 3.8; o passo 1 da volta e "Conferir agora"; o ensaio nunca entra aqui), na
 * ordem: os 5 minutos, a leitura que funcionou, a adoção (achou, duplicada, marca em registro inesperado), o ocupante exato
 * (conferido antes de qualquer "não achou"), a credencial que lê a marca e, por fim, o "não achou" pela resposta do POST.
 * O `sem_id` nunca repete sozinho: o Beds24 disse que gravou, e um segundo POST arriscaria a duplicata.
 */
export function saidaDaIncertezaDaCriacao(o: { resposta: RespostaBeds24 | null; enviadoEm: Date; agora: Date; leitura: LeituraDaIncerteza; jaHouveNovaTentativa: boolean; buscasSemConclusao: number }): SaidaDaIncerteza {
  if (!podeConcluirIncertezaBeds24(o.enviadoEm, o.agora)) return { saida: "aguardar" };
  const l = o.leitura;
  if (!l.funcionou) return buscaSemConclusaoBeds24(o.buscasSemConclusao);
  if (l.adocao.adotar) return { saida: "adotar", registro: l.adocao.registro };
  if (l.adocao.motivo === "duplicada") return { saida: "divergente", motivo: "duplicada", ids: l.adocao.ids };
  if (l.adocao.motivo === "marca_em_registro_inesperado") return { saida: "divergente", motivo: "marca_em_registro_inesperado", ids: [l.adocao.id] };
  if (l.ocupanteExato) return { saida: "candidato", id: l.ocupanteExato };
  if (!l.credencialLeMarca) return buscaSemConclusaoBeds24(o.buscasSemConclusao);
  if (ehRecusa(o.resposta)) return { saida: "recusada", motivo: o.resposta === "recusada_disponibilidade" ? "sem_disponibilidade" : "recusada_pelo_beds24" };
  if (semResposta(o.resposta) && !o.jaHouveNovaTentativa) return { saida: "nova_tentativa" };
  return { saida: "equipe" };
}

/**
 * A releitura por id da saída da incerteza do `atualizar` e do `cancelar` (eles já têm o `beds24_id` desde a fase 1; nunca a
 * busca nem a adoção, que só valem na criação). `registro` null = o id não voltou; `podeConcluirApagada` = a credencial
 * guardada no acompanhamento é a de agora e o quarto continua acessível em BRL (senão a troca de token ou o acesso tirado
 * fazem todos os ids sumirem: `aguardando_equipe`/`sem_permissao`, sem mexer em `ota_fechada_em`).
 */
export type ReleituraDaIncerteza = { funcionou: false } | { funcionou: true; registro: LidoBeds24 | null; podeConcluirApagada: boolean };

export type SaidaDaIncertezaPorId =
  | { saida: "aguardar" }
  /** Igual ao pedido: a fase 3, `conferida` e as marcas (a conferência depois confere também a marca). */
  | { saida: "conferir" }
  | { saida: "nova_tentativa" }
  | { saida: "recusada"; motivo: "sem_disponibilidade" | "recusada_pelo_beds24" }
  | { saida: "equipe"; motivo: "incerta" | "sem_permissao" }
  | { saida: "divergente"; motivo: DiferencaNoBeds24["motivo"] }
  | { saida: "sem_conclusao"; buscas: number; equipe: boolean };

const mesmoLido = (a: LidoBeds24, b: LidoBeds24) => a.quarto === b.quarto && a.chegada === b.chegada && a.saida === b.saida && a.hospedes === b.hospedes && a.situacao === b.situacao;

/**
 * A saída da incerteza do `atualizar` e do `cancelar` (e da `enviando` vencida desses tipos), só pela releitura por id:
 * - igual ao `pedido`: `conferir`, na hora;
 * - igual ao `antes` (o registro relido na fase 2), e só 5 min depois de `enviado_em` (o Beds24 pode gravar depois do nosso
 *   tempo-limite): sem resposta legível, uma nova tentativa (o POST manda o estado inteiro: repetir é seguro), na mesma regra
 *   de "no máximo uma por intenção"; depois de uma recusa, `recusada` (nunca repete sozinha, como na criação — sem isso, cada
 *   nova tentativa recusada abriria outra, sem fim); senão, a equipe;
 * - não encontrado: `divergente`/`apagada_no_beds24` só com a credencial e o quarto que permitem concluir; senão a equipe,
 *   `sem_permissao`;
 * - sem o `antes` gravado (a fase 2 sempre relê por id antes de `enviado_em`; sem ele, não se separa o que não chegou a valer
 *   do que alguém mudou no Beds24): avisar em vez de supor — só 5 min depois de `enviado_em`, e então a equipe, `incerta`
 *   (nunca `divergente` na hora, com o e-mail de divergência, nem nova tentativa);
 * - outra coisa: `divergente` com o motivo de `diferencaNoBeds24`;
 * - a releitura falhou: `sem_conclusao`, como na criação.
 */
export function saidaDaIncertezaPorId(o: { pedido: EsperadoBeds24; antes: LidoBeds24 | null; resposta: RespostaBeds24 | null; enviadoEm: Date; agora: Date; releitura: ReleituraDaIncerteza; jaHouveNovaTentativa: boolean; buscasSemConclusao: number }): SaidaDaIncertezaPorId {
  const l = o.releitura;
  if (!l.funcionou) return buscaSemConclusaoBeds24(o.buscasSemConclusao);
  if (!l.registro) return l.podeConcluirApagada ? { saida: "divergente", motivo: "apagada_no_beds24" } : { saida: "equipe", motivo: "sem_permissao" };
  const dif = diferencaNoBeds24(o.pedido, l.registro);
  if (!dif) return { saida: "conferir" };
  if (o.antes && mesmoLido(o.antes, l.registro)) {
    if (!podeConcluirIncertezaBeds24(o.enviadoEm, o.agora)) return { saida: "aguardar" };
    if (ehRecusa(o.resposta)) return { saida: "recusada", motivo: o.resposta === "recusada_disponibilidade" ? "sem_disponibilidade" : "recusada_pelo_beds24" };
    if (semResposta(o.resposta) && !o.jaHouveNovaTentativa) return { saida: "nova_tentativa" };
    return { saida: "equipe", motivo: "incerta" };
  }
  if (!o.antes) return podeConcluirIncertezaBeds24(o.enviadoEm, o.agora) ? { saida: "equipe", motivo: "incerta" } : { saida: "aguardar" };
  return { saida: "divergente", motivo: dif.motivo };
}

/** O que a saída por id do fato já aceito pode concluir: nunca aguardar, nova tentativa nem recusa. */
export type SaidaDaFeitaPorId = Extract<SaidaDaIncertezaPorId, { saida: "conferir" | "divergente" | "equipe" | "sem_conclusao" }>;

/**
 * A saída por id do que o Beds24 já aceitou (desenho 3.6 e 4.3): a `feita` (o cancelamento conferido que espera as
 * duplicadas; a criação adotada pela importação ou sem a releitura) e a criação `enviando` vencida com o id (a queda entre a
 * resposta e a fase 3). O POST já valeu, então nunca há os 5 min, a comparação com o `antes` nem nova tentativa — só a
 * releitura, como na incerteza do `atualizar` e do `cancelar`:
 * - igual ao pedido: `conferir` (a conferência depois confere também a marca);
 * - não voltou: `divergente`/`apagada_no_beds24` só com a credencial e o quarto que permitem concluir; senão a equipe,
 *   `sem_permissao` (a troca de token ou o acesso tirado fazem todos os ids sumirem);
 * - outra coisa: `divergente` com o motivo de `diferencaNoBeds24`;
 * - a releitura falhou: `sem_conclusao`, como na incerteza.
 */
export function saidaDaFeitaPorId(releitura: ReleituraDaIncerteza, pedido: EsperadoBeds24, buscasSemConclusao: number): SaidaDaFeitaPorId {
  if (!releitura.funcionou) return buscaSemConclusaoBeds24(buscasSemConclusao);
  if (!releitura.registro) return releitura.podeConcluirApagada ? { saida: "divergente", motivo: "apagada_no_beds24" } : { saida: "equipe", motivo: "sem_permissao" };
  const dif = diferencaNoBeds24(pedido, releitura.registro);
  return dif ? { saida: "divergente", motivo: dif.motivo } : { saida: "conferir" };
}

// ---------------------------------------------------------------- a rotina (desenho 9)

/**
 * As janelas sem operação nova, em UTC (desenho 9): a importação diária (`/api/cron/beds24`, 9:15) e o envio diário de
 * calendário (`/api/cron/beds24-envio`, 10:00), cada uma com folga para a operação de 6 min (`JANELA_RESERVA_EM_ANDAMENTO`)
 * terminar antes: a importação e o envio nunca encontram "ocupada" por causa do M8.3. Intervalo `[inicio, fim)`. Aqui, e não
 * na rotina: o trabalhador confere a janela antes de cada operação, e a rotina importa o trabalhador.
 */
export const JANELAS_SEM_OPERACAO_NOVA_UTC = [
  { de: "importacao", inicio: "09:05", fim: "09:30" },
  { de: "envio", inicio: "09:50", fim: "10:15" },
] as const;
export type JanelaSemOperacaoNova = (typeof JANELAS_SEM_OPERACAO_NOVA_UTC)[number]["de"];

const minutoDoDia = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A janela em que `agora` cai (a da importação ou a do envio), ou null fora delas. */
export function dentroDeJanela(agora: Date): JanelaSemOperacaoNova | null {
  const m = agora.getUTCHours() * 60 + agora.getUTCMinutes();
  return JANELAS_SEM_OPERACAO_NOVA_UTC.find((j) => m >= minutoDoDia(j.inicio) && m < minutoDoDia(j.fim))?.de ?? null;
}

/**
 * Os atrasos das falhas ANTES do POST (desenho 9: a leitura falhou, o token não veio), a única fonte do atraso. Conflito,
 * divergência, recusa e incerteza não contam como falha: eles param e avisam na hora.
 */
export const ATRASOS_FALHA_MINUTOS = [10, 20, 40, 80, 160] as const;

/**
 * O atraso até a próxima tentativa depois da falha número `tentativas` (contando esta, a partir de 1): 10, 20, 40, 80 e 160
 * min, e 160 dali em diante. Na 5ª (e nas seguintes), também `equipe`: `aguardando_equipe`, motivo `falhas`, com e-mail.
 */
export function atrasoDaFalha(tentativas: number): { minutos: number; equipe: boolean } {
  const n = Math.max(1, Math.floor(Number.isFinite(tentativas) ? tentativas : 1));
  return { minutos: ATRASOS_FALHA_MINUTOS[Math.min(n, ATRASOS_FALHA_MINUTOS.length) - 1], equipe: n >= ATRASOS_FALHA_MINUTOS.length };
}

// ---------------------------------------------------------------- o e-mail à equipe (desenho 6.5)

/** Os casos que mandam e-mail à equipe (desenho 6.5), cada um com o texto próprio. */
export const CASOS_DE_EMAIL_BEDS24 = ["conflito", "overbooking", "divergencia", "recusada", "falhas", "marca_ilegivel"] as const;
export type CasoDeEmailBeds24 = (typeof CASOS_DE_EMAIL_BEDS24)[number];

/**
 * Os motivos do acompanhamento que podem pedir e-mail (o caso sai de `casoDeEmailBeds24`, com a situação). A função lê esta
 * lista: fora dela, nunca há e-mail (os dois não se separam).
 */
export const MOTIVOS_DE_EMAIL_BEDS24 = [
  "noites_ocupadas", "mudada_no_beds24", "cancelada_no_beds24", "apagada_no_beds24", "sem_disponibilidade", "recusada_pelo_beds24", "sem_permissao", "falhas", "marca_ilegivel",
] as const satisfies readonly MotivoAcompanhamentoBeds24[];

/**
 * As situações do acompanhamento que podem pedir e-mail (a varredura da rotina lê só estas). A função lê esta lista: fora
 * dela, nunca há e-mail (as duas não se separam, como nos motivos).
 */
export const SITUACOES_DE_EMAIL_BEDS24 = ["conflito", "conferida", "divergente", "aguardando_equipe"] as const satisfies readonly SituacaoAcompanhamentoBeds24[];

/**
 * A transição que pede e-mail à equipe (desenho 6.5), uma regra: o conflito (`conflito`/`noites_ocupadas`, "Possível venda
 * dupla"); o overbooking que o Beds24 informa depois de uma escrita certa (`conferida`/`noites_ocupadas`, texto próprio: o
 * sistema criou); a divergência apagada, mudada ou cancelada no Beds24 e a marca ilegível; a recusa do POST (a operação
 * `recusada`: sem disponibilidade, recusada pelo Beds24 ou sem permissão — a falta de disponibilidade lida ANTES do POST
 * não manda, nada foi enviado); e a 5ª falha. Só numa situação de `SITUACOES_DE_EMAIL_BEDS24` e com um motivo de
 * `MOTIVOS_DE_EMAIL_BEDS24`. null = sem e-mail (a linha de atenção do Início continua).
 */
export function casoDeEmailBeds24(situacao: SituacaoAcompanhamentoBeds24, motivo: MotivoAcompanhamentoBeds24 | null, operacao: SituacaoOperacaoBeds24 | null): CasoDeEmailBeds24 | null {
  if (!(SITUACOES_DE_EMAIL_BEDS24 as readonly string[]).includes(situacao)) return null;
  if (motivo === null || !(MOTIVOS_DE_EMAIL_BEDS24 as readonly string[]).includes(motivo)) return null;
  if (motivo === "noites_ocupadas") return situacao === "conflito" ? "conflito" : situacao === "conferida" ? "overbooking" : null;
  if (situacao === "divergente") return motivo === "marca_ilegivel" ? "marca_ilegivel" : motivo === "mudada_no_beds24" || motivo === "cancelada_no_beds24" || motivo === "apagada_no_beds24" ? "divergencia" : null;
  if (situacao !== "aguardando_equipe") return null;
  if (motivo === "falhas") return "falhas";
  if ((motivo === "sem_disponibilidade" || motivo === "recusada_pelo_beds24" || motivo === "sem_permissao") && operacao === "recusada") return "recusada";
  return null;
}

// ---------------------------------------------------------------- o ensaio (desenho 8, 5.2 e D7)

/**
 * As situações do ensaio FECHADO (M8.3c, plano 1.12), sem nada dele confirmado no Beds24: `conferida` (criado, conferido,
 * cancelado e relido como cancelado) e as que concluem sem reserva de teste viva — recusado antes do POST (`falhou`,
 * `conflito`), o POST não processado (o 401 e o 403 em `recusada`; o 429 sem a lista e o token que caiu em `falhou`), "Conferir
 * o ensaio" que leu e não achou nada (`falhou`) e o cancelado sem a conferência completa (`falhou`, com `depois` cancelado).
 * `superada` não é usada no ensaio, mas também não deixa nada. Antes deste registro, a definição do plano era só "sem `depois`
 * cancelado": o ensaio sem id que "Conferir o ensaio" fechou como "nada criado" ficaria não resolvido para sempre (e, com ele,
 * a guarda de um ensaio por vez impediria o "Ligar").
 */
export const SITUACOES_ENSAIO_FECHADO = ["conferida", "falhou", "recusada", "conflito", "superada"] as const satisfies readonly SituacaoOperacaoBeds24[];

/**
 * O ensaio NÃO RESOLVIDO (plano 1.12), uma regra para a guarda de um ensaio por vez, o desvio "e" da importação (desenho 5.2;
 * a mesma condição no banco, `ensaioNaoResolvidoNoBanco`) e Integrações: teve POST (`enviado_em`), não está fechado e o
 * registro não foi relido como cancelado (`depois`). Entra também a `feita` (entre "Criar o ensaio" e "Cancelar o ensaio": a
 * reserva de teste está confirmada no Beds24, fechando as OTAs), a `incerta`, a `divergente` e a `enviando`.
 */
export const ensaioNaoResolvidoBeds24 = (o: { enviadoEm: Date | null; situacao: SituacaoOperacaoBeds24; depois: LidoBeds24 | null }): boolean =>
  o.enviadoEm !== null && !(SITUACOES_ENSAIO_FECHADO as readonly string[]).includes(o.situacao) && o.depois?.situacao !== "cancelada";

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

/**
 * A leitura dos escopos guardada (`beds24_reservas_rotina.escopos`, M8.3c): a avaliação e os itens fora do formato, só nomes
 * de escopo (nunca a credencial). A rotina lê no começo da volta e o botão de Integrações também grava.
 */
export type EscoposLidosBeds24 = ProntidaoEscoposBeds24 & { ilegiveis: string[] };

const SITUACOES_ESCOPOS: readonly ProntidaoEscoposBeds24["situacao"][] = ["em_ordem", "escopo_excessivo", "ilegivel", "incompleto"];

/** O valor guardado → a leitura dos escopos; torto = null (sem leitura válida: nada é escrito, o lado seguro). */
export function escoposLidosBeds24(v: unknown): EscoposLidosBeds24 | null {
  if (!ehObj(v) || !SITUACOES_ESCOPOS.includes(v.situacao as ProntidaoEscoposBeds24["situacao"])) return null;
  const lista = (x: unknown) => (Array.isArray(x) && x.every((i) => typeof i === "string") ? (x as string[]) : null);
  const excessivos = lista(v.excessivos), faltando = lista(v.faltando), ilegiveis = lista(v.ilegiveis);
  if (!excessivos || !faltando || !ilegiveis) return null;
  return { situacao: v.situacao as ProntidaoEscoposBeds24["situacao"], excessivos, faltando, ilegiveis };
}
