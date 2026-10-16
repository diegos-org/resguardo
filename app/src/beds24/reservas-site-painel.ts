/**
 * Reserva paga do site no Beds24 (M8.3a, desenho 8): o que o painel mostra, só leitura. O domínio devolve códigos; os
 * rótulos ficam nos componentes (`components/reservas/ReservaNoBeds24.tsx`, `components/configuracoes/ReservasSiteBeds24.tsx`).
 * - `fichaReservaNoBeds24`: o bloco da ficha (situação e motivo, id no Beds24, quarto, última conferência e leitura,
 *   histórico curto das operações) e o "desligada", calculado e nunca gravado (chave, pausa, imóvel ou nenhuma linha).
 * - `painelReservasBeds24`: a seção de Integrações (chave e ambiente, credencial, prontidão sem rede, pausa geral,
 *   imóveis ligados e contadores por situação).
 * - `conferirEscoposReservasBeds24`: os escopos da credencial (GET /authentication/details), lidos só no deploy de
 *   produção com a escrita pronta; nas prévias, no computador e nos testes, diz que não leu e nada sai.
 * Nada aqui escreve, no banco ou no Beds24.
 */
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { quartoDoVinculo } from "@/calendario/envio";
import { beds24ReservasOperacoes, beds24ReservasSite, imoveis, reservas, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { lerConfigBeds24, listarMapeamentosBeds24 } from "./configuracao";
import { ambienteDeEscritaDeReservas, credencialDeEscritaForaDaProducao, escritaReservasBeds24Ligada, escritaReservasBeds24Pronta, impressaoCredencialBeds24, leitorDeCredencialDoAmbiente, simulacaoReservasBeds24Permitida } from "./http";
import { ensaioValeParaCredencial, lerConfigReservasBeds24, ligacaoDoImovel } from "./reservas-site-config";
import {
  avaliarEscoposBeds24,
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
import { ErroBeds24, type LeitorCredencialBeds24 } from "./tipos";

/**
 * Por que o envio automático está desligado para esta reserva (pode haver mais de um): fora do deploy de produção, a
 * chave `BEDS24_ESCRITA_RESERVAS`, o refresh token, a pausa geral, o imóvel não ligado (D6) ou nenhuma linha de
 * acompanhamento. Vazio = ligado.
 */
export type MotivoDesligadaBeds24 = "ambiente" | "chave" | "credencial" | "pausa" | "imovel" | "sem_acompanhamento";

/** Os motivos do "desligada", na ordem em que a tela mostra. */
export function motivosDesligada(env: NodeJS.ProcessEnv, o: { pausada: boolean; imovelLigado: boolean; comAcompanhamento: boolean }): MotivoDesligadaBeds24[] {
  const m: MotivoDesligadaBeds24[] = [];
  if (!ambienteDeEscritaDeReservas(env)) m.push("ambiente");
  if (!escritaReservasBeds24Ligada(env)) m.push("chave");
  if (!env.BEDS24_REFRESH_TOKEN?.trim()) m.push("credencial");
  if (o.pausada) m.push("pausa");
  if (!o.imovelLigado) m.push("imovel");
  if (!o.comAcompanhamento) m.push("sem_acompanhamento");
  return m;
}

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
};

/** Quantas operações a ficha mostra. */
export const OPERACOES_NA_FICHA = 10;

/** O bloco da ficha de uma reserva do site; null = reserva fora da organização ou de outra fonte. */
export async function fichaReservaNoBeds24(db: Db, org: string, reservaId: string, env: NodeJS.ProcessEnv): Promise<FichaReservaNoBeds24 | null> {
  if (!uuidValido(reservaId)) return null;
  const [r] = await db.select({ id: reservas.id, imovelId: reservas.imovelId, beds24Id: reservas.beds24Id }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, org), eq(reservas.fonte, "site")));
  if (!r) return null;
  const config = await lerConfigReservasBeds24(db, org);
  const [a] = await db.select().from(beds24ReservasSite).where(and(eq(beds24ReservasSite.organizacaoId, org), eq(beds24ReservasSite.reservaId, r.id)));
  const op = beds24ReservasOperacoes;
  const operacoes = await db
    .select({ id: op.id, tipo: op.tipo, modo: op.modo, situacao: op.situacao, pedido: op.pedido, beds24Id: op.beds24Id, iniciadoEm: op.iniciadoEm, terminadoEm: op.terminadoEm, erro: op.erro })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.reservaId, r.id)))
    .orderBy(desc(op.iniciadoEm), desc(op.id))
    .limit(OPERACOES_NA_FICHA);
  return {
    desligada: motivosDesligada(env, { pausada: config.pausado !== null, imovelLigado: ligacaoDoImovel(config, r.imovelId) !== null, comAcompanhamento: Boolean(a) }),
    beds24Id: r.beds24Id,
    acompanhamento: a
      ? { situacao: a.situacao, motivo: a.motivo, quarto: a.roomId, conferidaEm: a.conferidaEm, lido: a.lido, lidoEm: a.lidoEm, otaFechadaEm: a.otaFechadaEm, otaFechadaAMao: a.otaFechadaEm !== null && a.otaFechadaPor !== null }
      : null,
    operacoes,
    simular: simulacaoReservasBeds24Permitida(env),
  };
}

// ---------------------------------------------------------------- Integrações (desenho 8)

/** A marca do SCL é legível com a credencial atual? Só o ensaio prova; uma releitura sem a marca derruba. */
export type MarcaLegivelBeds24 = "provada_no_ensaio" | "ilegivel" | "nao_conferida";

/** Por que ligar um imóvel é recusado agora (o servidor recusa do mesmo jeito: `ligarImovelReservasBeds24`). */
export type MotivoSemLigarBeds24 = "sem_credencial" | "sem_ensaio";

export type ImovelNasReservasBeds24 = { id: string; codigo: string; ligadoEm: string | null; ligadoPor: string | null; quartoDoVinculo: string | null };

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
};

/** A seção "Reservas do site no Beds24" em Integrações; nenhuma leitura do Beds24 (os escopos vêm por um botão). */
export async function painelReservasBeds24(db: Db, org: string, env: NodeJS.ProcessEnv): Promise<PainelReservasBeds24> {
  const config = await lerConfigReservasBeds24(db, org);
  const importacao = await lerConfigBeds24(db, org);
  const locais = await db.select({ id: imoveis.id, codigo: imoveis.codigo }).from(imoveis).where(and(eq(imoveis.organizacaoId, org), eq(imoveis.ativo, true))).orderBy(asc(imoveis.codigo));
  const mapas = await listarMapeamentosBeds24(db, org);
  const ids = [...new Set([config.pausado?.por, ...config.imoveis.map((i) => i.ligadoPor)].filter((x): x is string => Boolean(x)))];
  const nomes = new Map(ids.length ? (await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(and(eq(usuarios.organizacaoId, org), inArray(usuarios.id, ids)))).map((u) => [u.id, u.nome]) : []);
  const porSituacao = await db.select({ situacao: beds24ReservasSite.situacao, n: count() }).from(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, org)).groupBy(beds24ReservasSite.situacao);
  const [ilegivel] = await db.select({ id: beds24ReservasSite.id }).from(beds24ReservasSite).where(and(eq(beds24ReservasSite.organizacaoId, org), eq(beds24ReservasSite.motivo, "marca_ilegivel"))).limit(1);
  const credencial = impressaoCredencialBeds24(env);
  const ensaioVale = ensaioValeParaCredencial(config, credencial);
  const contadores = Object.fromEntries(SITUACOES_ACOMPANHAMENTO_BEDS24.map((s) => [s, 0])) as Record<SituacaoAcompanhamentoBeds24, number>;
  for (const l of porSituacao) if (l.situacao in contadores) contadores[l.situacao] = Number(l.n);
  const refreshToken = Boolean(env.BEDS24_REFRESH_TOKEN?.trim());
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
      return { id: i.id, codigo: i.codigo, ligadoEm: l?.ligadoEm ?? null, ligadoPor: l?.ligadoPor ? (nomes.get(l.ligadoPor) ?? null) : null, quartoDoVinculo: quartoDoVinculo(mapas, i.id) };
    }),
    contadores,
  };
}

/** Os escopos lidos, ou por que não foram lidos (os textos ficam na tela). */
export type EscoposDaCredencial =
  | { lidos: true; avaliacao: ProntidaoEscoposBeds24; escopos: string[]; ilegiveis: string[]; lidoEm: string }
  | { lidos: false; motivo: "fora_da_producao" | "chave_desligada" | "sem_refresh_token" }
  | { lidos: false; motivo: "falhou"; erro: string };

/**
 * Prontidão (desenho 7): lê os escopos da credencial por GET /authentication/details, só leitura, e só onde a escrita de
 * reservas está pronta (o deploy de produção, a chave e o refresh token). `leitorDe` é o leitor real por padrão, que
 * devolve null fora dessa condição; os testes passam a versão falsa. Nada é gravado: a tela mostra o que leu agora.
 */
export async function conferirEscoposReservasBeds24(env: NodeJS.ProcessEnv, leitorDe: (env: NodeJS.ProcessEnv) => LeitorCredencialBeds24 | null = leitorDeCredencialDoAmbiente): Promise<EscoposDaCredencial> {
  if (!ambienteDeEscritaDeReservas(env)) return { lidos: false, motivo: "fora_da_producao" };
  if (!escritaReservasBeds24Ligada(env)) return { lidos: false, motivo: "chave_desligada" };
  if (!env.BEDS24_REFRESH_TOKEN?.trim()) return { lidos: false, motivo: "sem_refresh_token" };
  const leitor = leitorDe(env);
  if (!leitor) return { lidos: false, motivo: "fora_da_producao" };
  try {
    const c = await leitor.credencial();
    return { lidos: true, avaliacao: avaliarEscoposBeds24(c), escopos: c.escopos ?? [], ilegiveis: c.ilegiveis, lidoEm: c.lidoEm };
  } catch (e) {
    return { lidos: false, motivo: "falhou", erro: e instanceof ErroBeds24 ? e.message : "Não foi possível ler a credencial no Beds24." };
  }
}
