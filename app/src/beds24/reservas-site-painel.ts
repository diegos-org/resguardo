/**
 * Reserva paga do site no Beds24 (M8.3a, desenho 8): o que o painel mostra, só leitura. O domínio devolve códigos; os
 * rótulos ficam nos componentes (`components/reservas/ReservaNoBeds24.tsx`, `components/configuracoes/ReservasSiteBeds24.tsx`).
 * - `fichaReservaNoBeds24`: o bloco da ficha (situação e motivo, id no Beds24, quarto, última conferência e leitura,
 *   histórico curto das operações), o "desligada", calculado e nunca gravado (chave, pausa, imóvel ou nenhuma linha), e as
 *   tarefas das OTAs desta reserva (M8.3b), da mesma função do Início (`tarefasDasOtas`).
 * - `painelReservasBeds24`: a seção de Integrações (chave e ambiente, credencial com o último 403 ou 401 de reservas,
 *   prontidão sem rede com os escopos guardados, o motivo que para a escrita, pausa geral, imóveis ligados, o ensaio e os
 *   contadores por situação). M8.3c: a marca ilegível sai da mesma regra do trabalhador (`existeMarcaIlegivelQueConta`).
 * - `conferirEscoposReservasBeds24`: os escopos da credencial (GET /authentication/details), lidos só no deploy de
 *   produção com a escrita pronta, da credencial da organização; nas prévias, no computador e nos testes, diz que não leu e
 *   nada sai. M8.3c: a leitura fica guardada (`gravarEscoposLidos`, a mesma da rotina).
 * Nada aqui escreve no Beds24; no banco, só a leitura dos escopos.
 */
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { quartoDoVinculo } from "@/calendario/envio";
import { beds24ReservasOperacoes, beds24ReservasSite, cotacoes, imoveis, reservas, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { lerConfigBeds24, listarMapeamentosBeds24, organizacaoBeds24 } from "./configuracao";
import { ambienteDeEscritaDeReservas, credencialDeEscritaForaDaProducao, escritaReservasBeds24Ligada, escritaReservasBeds24Pronta, impressaoCredencialBeds24, leitorDeCredencialDoAmbiente, simulacaoReservasBeds24Permitida } from "./http";
import { ensaioValeParaCredencial, lerConfigReservasBeds24, ligacaoDoImovel, type MotivoDesligadaBeds24, motivosDesligada } from "./reservas-site-config";
import { type EnsaioNoPainel, ensaioNoPainel } from "./reservas-site-ensaio";
import { type LinhaAtencaoOta, type TarefaOta, tarefasDasOtas } from "./reservas-site-tarefas";
import {
  type EscoposLidosBeds24,
  type LidoBeds24,
  type ModoOperacaoBeds24,
  type MotivoAcompanhamentoBeds24,
  type PedidoBeds24,
  type ProntidaoEscoposBeds24,
  SITUACOES_ACOMPANHAMENTO_BEDS24,
  type SituacaoAcompanhamentoBeds24,
  type SituacaoOperacaoBeds24,
  type TipoOperacaoBeds24,
} from "./reservas-site-regras";
import {
  type ConfiguracaoQueParaAsReservas, existeMarcaIlegivelQueConta, gravarEscoposLidos, leituraDosEscoposValida, lerEstadoRotina, motivoDeConfiguracaoDasReservas, ultimaRecusaDeReservas,
  type UltimaRecusaDeReservas,
} from "./reservas-site-rotina";
import { ErroBeds24, type LeitorCredencialBeds24 } from "./tipos";

export type OperacaoNaFicha = {
  id: string;
  tipo: TipoOperacaoBeds24;
  modo: ModoOperacaoBeds24;
  situacao: SituacaoOperacaoBeds24;
  pedido: PedidoBeds24 | null;
  beds24Id: string | null;
  iniciadoEm: Date;
  terminadoEm: Date | null;
  /** Mensagem segura (nunca a resposta crua do provedor). */
  erro: string;
};

export type FichaReservaNoBeds24 = {
  desligada: MotivoDesligadaBeds24[];
  /** O id final do Beds24 (`reservas.beds24_id`), num lugar só. */
  beds24Id: string | null;
  acompanhamento: {
    situacao: SituacaoAcompanhamentoBeds24;
    motivo: MotivoAcompanhamentoBeds24 | null;
    /** O quarto onde a reserva foi (ou vai ser) criada. */
    quarto: string | null;
    conferidaEm: Date | null;
    lido: LidoBeds24 | null;
    lidoEm: Date | null;
    otaFechadaEm: Date | null;
    /** A marca "datas fechadas" foi gravada pela equipe (D8); false = pelo sistema. */
    otaFechadaAMao: boolean;
  } | null;
  /** O histórico curto, da mais nova para a mais velha. */
  operacoes: OperacaoNaFicha[];
  /** O ambiente deixa simular (fora do deploy de produção ou com a chave desligada); a permissão é de quem chama. */
  simular: boolean;
  /**
   * O pedido do site (hold do M8.1, D9): `segurado` = ainda é um pedido com as datas seguradas (nunca vai ao Beds24, e as
   * datas não são fechadas à mão nas OTAs); `vencido` = venceu sem pagamento (a cotação `expirada`): nunca foi confirmada,
   * nada foi fechado. null = a reserva passou do pedido (confirmada, ou cancelada depois de confirmada).
   */
  pedido: PedidoNaFicha | null;
  /** M8.3b: o que fazer à mão nas OTAs (ou o que o sistema está enviando) para esta reserva, de `tarefasDasOtas`. */
  tarefas: TarefaOta[];
  /** M8.3b: o que pede atenção nesta reserva (conflito, divergência, aguardando a equipe), no lugar das tarefas. */
  atencoes: LinhaAtencaoOta[];
};

export type PedidoNaFicha = "segurado" | "vencido";

/** Quantas operações a ficha mostra. */
export const OPERACOES_NA_FICHA = 10;

/** O bloco da ficha de uma reserva do site; null = reserva fora da organização ou de outra fonte. */
export async function fichaReservaNoBeds24(db: Db, org: string, reservaId: string, env: NodeJS.ProcessEnv, agora: Date = new Date()): Promise<FichaReservaNoBeds24 | null> {
  if (!uuidValido(reservaId)) return null;
  const [r] = await db.select({ id: reservas.id, imovelId: reservas.imovelId, beds24Id: reservas.beds24Id, estado: reservas.estado }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, org), eq(reservas.fonte, "site")));
  if (!r) return null;
  // "Expirada" só é gravada na cotação quando o pedido vence ainda como pedido (nunca depois de confirmado).
  const [vencido] = r.estado === "cancelada" ? await db.select({ id: cotacoes.id }).from(cotacoes).where(and(eq(cotacoes.organizacaoId, org), eq(cotacoes.reservaId, r.id), eq(cotacoes.estado, "expirada"))).limit(1) : [];
  const config = await lerConfigReservasBeds24(db, org);
  const [a] = await db.select().from(beds24ReservasSite).where(and(eq(beds24ReservasSite.organizacaoId, org), eq(beds24ReservasSite.reservaId, r.id)));
  const op = beds24ReservasOperacoes;
  const operacoes = await db
    .select({ id: op.id, tipo: op.tipo, modo: op.modo, situacao: op.situacao, pedido: op.pedido, beds24Id: op.beds24Id, iniciadoEm: op.iniciadoEm, terminadoEm: op.terminadoEm, erro: op.erro })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.reservaId, r.id)))
    .orderBy(desc(op.iniciadoEm), desc(op.id))
    .limit(OPERACOES_NA_FICHA);
  const { tarefas, atencoes } = await tarefasDasOtas(db, org, agora, env, { reservaIds: [r.id] });
  return {
    desligada: motivosDesligada(env, { pausada: config.pausado !== null, imovelLigado: ligacaoDoImovel(config, r.imovelId) !== null, comAcompanhamento: Boolean(a) }),
    beds24Id: r.beds24Id,
    acompanhamento: a
      ? { situacao: a.situacao, motivo: a.motivo, quarto: a.roomId, conferidaEm: a.conferidaEm, lido: a.lido, lidoEm: a.lidoEm, otaFechadaEm: a.otaFechadaEm, otaFechadaAMao: a.otaFechadaEm !== null && a.otaFechadaPor !== null }
      : null,
    operacoes,
    simular: simulacaoReservasBeds24Permitida(env),
    pedido: r.estado === "pedido" ? "segurado" : vencido ? "vencido" : null,
    tarefas,
    atencoes,
  };
}

// ---------------------------------------------------------------- Integrações (desenho 8)

/** A marca do SCL é legível com a credencial atual? Só o ensaio prova; uma releitura sem a marca derruba. */
export type MarcaLegivelBeds24 = "provada_no_ensaio" | "ilegivel" | "nao_conferida";

/** Por que ligar um imóvel é recusado agora (o servidor recusa do mesmo jeito: `ligarImovelReservasBeds24`). */
export type MotivoSemLigarBeds24 = "sem_credencial" | "sem_ensaio";

/**
 * Um imóvel da tabela "Imóveis ligados": os ativos e também o inativo que continua ligado na configuração (para a equipe ver
 * e poder desligar; ele só volta a ser ligado depois de reativado no cadastro).
 */
export type ImovelNasReservasBeds24 = { id: string; codigo: string; ativo: boolean; ligadoEm: string | null; ligadoPor: string | null; quartoDoVinculo: string | null };

/**
 * Por que "Criar o ensaio" não vale agora (o servidor recusa do mesmo jeito, `criarEnsaioReservasBeds24`, e confere ainda os
 * escopos, o quarto e as noites na hora): fora do deploy de produção, a escrita de reservas não pronta (a chave ou o refresh
 * token), a pausa, um ensaio em curso ou não resolvido, ou nenhum imóvel ativo com o vínculo único.
 */
export type MotivoSemEnsaioBeds24 = "fora_da_producao" | "nao_pronta" | "pausa" | "em_curso" | "sem_imovel";

/** A última leitura dos escopos guardada (pela rotina, pelo botão ou pelo ensaio): a avaliação, quando e se vale agora. */
export type EscoposGuardadosBeds24 = EscoposLidosBeds24 & {
  lidoEm: Date | null;
  /** Lida com a credencial de agora (com outra, a credencial foi trocada depois). */
  comCredencialAtual: boolean;
  /** Vale para escrever: a credencial de agora e menos de 26 h (`leituraDosEscoposValida`). */
  valida: boolean;
};

export type PainelReservasBeds24 = {
  chave: {
    /** `BEDS24_ESCRITA_RESERVAS=ligada`. */
    ligada: boolean;
    /** Este é o deploy de produção, rodando como produção: o único lugar onde a escrita de reservas pode sair. */
    ambienteDeProducao: boolean;
    /** As quatro condições juntas (`escritaReservasBeds24Pronta`). */
    pronta: boolean;
  };
  credencial: {
    refreshToken: boolean;
    /** Só o token direto (`BEDS24_API_KEY`), que só lê. */
    soTokenDireto: boolean;
    /** O refresh token fora do deploy de produção: o aviso de Sistema e Integrações. */
    foraDaProducao: boolean;
  };
  /** null = sem pausa. `por` é o nome de quem pausou (vazio quando não se sabe). */
  pausa: { em: string | null; por: string } | null;
  ensaio: { em: string; valeParaCredencialAtual: boolean } | null;
  marca: MarcaLegivelBeds24;
  /** A importação automática diária do Beds24 (não é requisito: o M8.3 faz a própria conferência). */
  importacaoAutomatica: boolean;
  /** null = pode ligar. */
  semLigar: MotivoSemLigarBeds24 | null;
  imoveis: ImovelNasReservasBeds24[];
  contadores: Record<SituacaoAcompanhamentoBeds24, number>;
  /** M8.3c: o último 403 ou 401 do POST de reservas, também do ensaio (`ultimaRecusaDeReservas`); null = nenhum. */
  ultimaRecusa: UltimaRecusaDeReservas | null;
  /** M8.3c: os escopos guardados; null = nunca lidos. */
  escopos: EscoposGuardadosBeds24 | null;
  /** M8.3c: com a escrita pronta, o que para a escrita por configuração (`motivoDeConfiguracaoDasReservas`); null = nada para. */
  motivoDeConfiguracao: ConfiguracaoQueParaAsReservas | null;
  /** M8.3c: o ensaio em curso ou não resolvido, ou o último, com o resultado (`ensaioNoPainel`); null = nenhum ainda. */
  ensaioAtual: EnsaioNoPainel | null;
  /** M8.3c: null = "Criar o ensaio" vale agora (o servidor confere de novo). */
  semEnsaio: MotivoSemEnsaioBeds24 | null;
};

/** A seção "Reservas do site no Beds24" em Integrações; nenhuma leitura do Beds24 (os escopos vêm por um botão). */
export async function painelReservasBeds24(db: Db, org: string, env: NodeJS.ProcessEnv, agora: Date = new Date()): Promise<PainelReservasBeds24> {
  const config = await lerConfigReservasBeds24(db, org);
  const importacao = await lerConfigBeds24(db, org);
  const doCadastro = await db.select({ id: imoveis.id, codigo: imoveis.codigo, ativo: imoveis.ativo }).from(imoveis).where(eq(imoveis.organizacaoId, org)).orderBy(asc(imoveis.codigo));
  // O inativo ligado continua na lista: senão ele ficaria ligado sem aparecer, e sem como desligar pelo painel.
  const locais = doCadastro.filter((i) => i.ativo || ligacaoDoImovel(config, i.id) !== null);
  const mapas = await listarMapeamentosBeds24(db, org);
  const ids = [...new Set([config.pausado?.por, ...config.imoveis.map((i) => i.ligadoPor)].filter((x): x is string => Boolean(x)))];
  const nomes = new Map(ids.length ? (await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(and(eq(usuarios.organizacaoId, org), inArray(usuarios.id, ids)))).map((u) => [u.id, u.nome]) : []);
  const porSituacao = await db.select({ situacao: beds24ReservasSite.situacao, n: count() }).from(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, org)).groupBy(beds24ReservasSite.situacao);
  // M8.3c (desenho 4.4): a mesma regra que para as criações — fora de `manual` e `encerrada`, de estadia que não terminou.
  // Antes, qualquer linha com o motivo, de qualquer situação e data, contava.
  const ilegivel = await existeMarcaIlegivelQueConta(db, org, agora);
  const credencial = impressaoCredencialBeds24(env);
  const ensaioVale = ensaioValeParaCredencial(config, credencial);
  const contadores = Object.fromEntries(SITUACOES_ACOMPANHAMENTO_BEDS24.map((s) => [s, 0])) as Record<SituacaoAcompanhamentoBeds24, number>;
  for (const l of porSituacao) if (l.situacao in contadores) contadores[l.situacao] = Number(l.n);
  const refreshToken = Boolean(env.BEDS24_REFRESH_TOKEN?.trim());
  const rotina = await lerEstadoRotina(db, org);
  const pronta = escritaReservasBeds24Pronta(env);
  const ensaioAtual = await ensaioNoPainel(db, org, agora, env);
  const paraEnsaio = locais.some((i) => i.ativo && quartoDoVinculo(mapas, i.id) !== null);
  const semEnsaio: MotivoSemEnsaioBeds24 | null = !ambienteDeEscritaDeReservas(env)
    ? "fora_da_producao"
    : !pronta
      ? "nao_pronta"
      : config.pausado
        ? "pausa"
        : ensaioAtual && ensaioAtual.fase !== "terminado" && ensaioAtual.fase !== "parado_antes_do_envio"
          ? "em_curso"
          : !paraEnsaio
            ? "sem_imovel"
            : null;
  return {
    chave: { ligada: escritaReservasBeds24Ligada(env), ambienteDeProducao: ambienteDeEscritaDeReservas(env), pronta: escritaReservasBeds24Pronta(env) },
    credencial: { refreshToken, soTokenDireto: !refreshToken && Boolean(env.BEDS24_API_KEY?.trim()), foraDaProducao: credencialDeEscritaForaDaProducao(env) },
    pausa: config.pausado ? { em: config.pausado.em, por: (config.pausado.por && nomes.get(config.pausado.por)) || "" } : null,
    ensaio: config.ensaio ? { em: config.ensaio.em, valeParaCredencialAtual: ensaioVale } : null,
    marca: ilegivel ? "ilegivel" : ensaioVale ? "provada_no_ensaio" : "nao_conferida",
    importacaoAutomatica: importacao.automatica,
    semLigar: !credencial ? "sem_credencial" : !ensaioVale ? "sem_ensaio" : null,
    imoveis: locais.map((i) => {
      const l = ligacaoDoImovel(config, i.id);
      return { id: i.id, codigo: i.codigo, ativo: i.ativo, ligadoEm: l?.ligadoEm ?? null, ligadoPor: l?.ligadoPor ? (nomes.get(l.ligadoPor) ?? null) : null, quartoDoVinculo: quartoDoVinculo(mapas, i.id) };
    }),
    contadores,
    ultimaRecusa: await ultimaRecusaDeReservas(db, org, env),
    escopos: rotina.escopos
      ? { ...rotina.escopos, lidoEm: rotina.escoposLidosEm, comCredencialAtual: Boolean(credencial) && rotina.escoposCredencial === credencial, valida: leituraDosEscoposValida(rotina, credencial, agora) }
      : null,
    // A mesma função do trabalhador, do Início e do Sistema, com o que já foi lido aqui (sem ler o Beds24).
    motivoDeConfiguracao: pronta ? motivoDeConfiguracaoDasReservas({ refreshToken, credencial, rotina, leituraFalhou: false, agora, ensaioValido: ensaioVale, marcaIlegivel: ilegivel }) : null,
    ensaioAtual,
    semEnsaio,
  };
}

/** Os escopos lidos, ou por que não foram lidos (os textos ficam na tela). */
export type EscoposDaCredencial =
  | { lidos: true; avaliacao: ProntidaoEscoposBeds24; escopos: string[]; ilegiveis: string[]; lidoEm: string }
  | { lidos: false; motivo: "fora_da_producao" | "chave_desligada" | "sem_refresh_token" }
  | { lidos: false; motivo: "falhou"; erro: string };

export const ERRO_ESCOPOS_OUTRA_ORGANIZACAO = "Esta credencial do Beds24 não está vinculada à sua organização: nada foi lido.";

/**
 * Prontidão (desenho 7): lê os escopos da credencial por GET /authentication/details, só leitura, e só onde a escrita de
 * reservas está pronta (o deploy de produção, a chave e o refresh token) e com a credencial da organização. `leitorDe` é o
 * leitor real por padrão, que devolve null fora dessa condição; os testes passam a versão falsa. M8.3c (plano 1.9): a leitura
 * fica guardada (`gravarEscoposLidos`, a mesma da rotina), para a escrita valer por 26 h sem ler de novo; antes, nada era
 * gravado.
 */
export async function conferirEscoposReservasBeds24(
  db: Db, org: string, env: NodeJS.ProcessEnv, leitorDe: (env: NodeJS.ProcessEnv) => LeitorCredencialBeds24 | null = leitorDeCredencialDoAmbiente, agora: Date = new Date(),
): Promise<EscoposDaCredencial> {
  if (!ambienteDeEscritaDeReservas(env)) return { lidos: false, motivo: "fora_da_producao" };
  if (!escritaReservasBeds24Ligada(env)) return { lidos: false, motivo: "chave_desligada" };
  if (!env.BEDS24_REFRESH_TOKEN?.trim()) return { lidos: false, motivo: "sem_refresh_token" };
  // A credencial é global e atende uma organização só: a leitura dela nunca fica guardada em outra.
  const daOrganizacao = await organizacaoBeds24(db, env).then((id) => id === org, () => false);
  if (!daOrganizacao) return { lidos: false, motivo: "falhou", erro: ERRO_ESCOPOS_OUTRA_ORGANIZACAO };
  const leitor = leitorDe(env);
  if (!leitor) return { lidos: false, motivo: "fora_da_producao" };
  let c: Awaited<ReturnType<LeitorCredencialBeds24["credencial"]>>;
  try {
    c = await leitor.credencial();
  } catch (e) {
    return { lidos: false, motivo: "falhou", erro: e instanceof ErroBeds24 ? e.message : "Não foi possível ler a credencial no Beds24." };
  }
  const avaliacao = await gravarEscoposLidos(db, org, impressaoCredencialBeds24(env), c, agora);
  return { lidos: true, avaliacao: { situacao: avaliacao.situacao, excessivos: avaliacao.excessivos, faltando: avaliacao.faltando }, escopos: c.escopos ?? [], ilegiveis: c.ilegiveis, lidoEm: c.lidoEm };
}
