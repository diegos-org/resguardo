/**
 * Portal do proprietário marketplace (M12.4): o dono faz a operação física e cuida dos preços e
 * regras de venda do próprio imóvel; a SCL faz o online. Tudo aqui só vale para imóvel da sessão
 * com contrato **marketplace** em vigor na data (deny-by-default, decidido no servidor), e grava
 * pelas mesmas funções do painel (cadastro do imóvel, períodos, limpezas, manutenção): uma regra,
 * um lugar. Preço, regra ou bloqueio editado aqui só chega ao Airbnb e ao Booking pelo envio de
 * calendário da SCL (M3.7) — a situação desse envio é mostrada ao proprietário, nunca suposta.
 */
import { and, asc, desc, eq, exists, gte, inArray, lt, sql } from "drizzle-orm";
import { exigir, type Sessao } from "@/acesso/politica";
import { listarMapeamentosBeds24 } from "@/beds24/configuracao";
import { escritaBeds24Ligada } from "@/beds24/http";
import { lerRegrasCalendario, type RegrasCalendario } from "@/calendario/regras-config";
import { type ContratoVigencia, contratoVigente } from "@/contratos/regras";
import { listarContratos } from "@/contratos/repositorio";
import { beds24Envios, beds24EnvioNoites, imoveis, imoveisPeriodos, limpezas, proprietarioImoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { type Detalhes, type ErrosDetalhes, criarPeriodo, entradaDeDetalhes, excluirPeriodo, lerDetalhes, listarPeriodos, salvarDetalhesComLeitura, validarDetalhes } from "@/imoveis/detalhes";
import type { FontePrecos } from "@/imoveis/fonte-precos";
import type { Periodo } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { realizarPeloProprietario } from "@/limpezas/limpezas";
import { listarManutencoes, registrarFeitaPeloProprietario } from "@/manutencao/manutencao";
import { lerPrecosMarketplace } from "@/marketplace/precos-config";
import { type PrecosMarketplace, simular } from "@/marketplace/precos";

export const NAO_MARKETPLACE = "Este imóvel não está em contrato marketplace nesta data: preços, regras, limpezas e manutenção são combinados com a empresa.";
const SEM_IMOVEL = "Imóvel não encontrado.";
const dataBr = (d: string) => d.split("-").reverse().join("/");
export const ANTES_DA_POSSE = (desde: string) => `Isso é de antes de o imóvel passar a ser seu (${dataBr(desde)}): fica com a empresa e com o dono da época.`;

/**
 * Desde quando cada imóvel é do dono atual (data do vínculo, no fuso de São Paulo — a mesma régua de
 * `noPeriodoDosDonos` no resto do portal). Um proprietário por imóvel: o vínculo que existe é o do dono de agora.
 */
async function posseDesde(db: Db, imovelIds: readonly string[]): Promise<Map<string, string>> {
  const ids = imovelIds.filter(uuidValido);
  if (!ids.length) return new Map();
  const linhas = await db.select({ imovelId: proprietarioImoveis.imovelId, criadoEm: proprietarioImoveis.criadoEm }).from(proprietarioImoveis).where(inArray(proprietarioImoveis.imovelId, ids));
  return new Map(linhas.map((l) => [l.imovelId, hojeISO("America/Sao_Paulo", l.criadoEm)]));
}

/** Campos do cadastro que o proprietário marketplace edita pelo portal (o resto fica como está). */
export const CAMPOS_PORTAL = ["precoBase", "taxaLimpeza", "hospedeExtraValor", "hospedeExtraAPartirDe", "estadiaMinima", "estadiaMaxima", "antecedenciaMinima", "janelaMaxima", "diasChegada", "diasSaida", "checkinAPartirDe", "checkoutAte"] as const;
export type CampoPortal = (typeof CAMPOS_PORTAL)[number];
const CAMPOS_LISTA: readonly CampoPortal[] = ["diasChegada", "diasSaida"];

export type SituacaoEnvio = {
  /** O imóvel está na lista de envio ao Beds24 (Configurações → Calendário e preços). */
  naLista: boolean;
  /** O imóvel tem vínculo ativo com o Beds24 (propriedade e quarto numéricos, em Integrações): sem ele o envio o pula. */
  vinculado: boolean;
  /** A chave de escrita do Beds24 está ligada no ambiente (`BEDS24_ESCRITA`): sem ela nada sai, nem no envio automático. */
  escritaLigada: boolean;
  /** O envio roda sozinho todo dia. */
  automatico: boolean;
  /** Último envio (de verdade, não simulação) que tocou este imóvel. */
  ultimo: { em: Date; situacao: string } | null;
};

/** Só com as três condições o que se muda aqui chega de fato às OTAs no próximo envio. */
export const envioPronto = (e: Pick<SituacaoEnvio, "naLista" | "vinculado" | "escritaLigada">) => e.naLista && e.vinculado && e.escritaLigada;

export type ImovelMarketplace = {
  id: string;
  codigo: string;
  nome: string;
  fuso: string;
  /** Desde quando é do dono atual (AAAA-MM-DD): limpezas, manutenções e datas de antes disso não são dele. */
  posseDesde: string | null;
  fontePrecos: FontePrecos;
  detalhes: Detalhes;
  periodos: (Periodo & { id: string })[];
  envio: SituacaoEnvio;
};

export type ResultadoPortal = { ok: true } | { ok: false; erro: string; erros?: ErrosDetalhes };

type ContratoLinha = ContratoVigencia & { tipo: string };
/** Em contrato marketplace no dia? (contratos não se sobrepõem; vale o vigente no dia) */
export const emMarketplaceEm = (contratos: readonly ContratoLinha[], dia: string) => contratoVigente(contratos, dia)?.tipo === "marketplace";

/**
 * Imóvel da organização, da sessão (política) e em contrato marketplace no dia; senão, o motivo.
 * `quando`: uma data (AAAA-MM-DD, ex.: o dia da limpeza) ou o instante — aí o dia é o do fuso do
 * imóvel, o mesmo que `imoveisMarketplaceDaSessao` usa para mostrar a seção.
 */
async function imovelOperavel(db: Db, sessao: Sessao, imovelId: string, quando: Date | string): Promise<{ ok: true; imovel: { id: string; codigo: string; fuso: string }; dia: string; posseDesde: string | null } | { ok: false; erro: string }> {
  if (!uuidValido(imovelId)) return { ok: false, erro: SEM_IMOVEL };
  exigir(sessao, "marketplace:operar", { organizacaoId: sessao.organizacaoId, imovelId });
  const [im] = await db.select({ id: imoveis.id, codigo: imoveis.codigo, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, sessao.organizacaoId)));
  if (!im) return { ok: false, erro: SEM_IMOVEL };
  const dia = typeof quando === "string" ? quando : hojeISO(im.fuso, quando);
  if (!emMarketplaceEm(await listarContratos(db, sessao.organizacaoId, im.id), dia)) return { ok: false, erro: NAO_MARKETPLACE };
  return { ok: true, imovel: im, dia, posseDesde: (await posseDesde(db, [im.id])).get(im.id) ?? null };
}

/**
 * Reconfere o contrato marketplace DENTRO da transação que grava, com a linha do imóvel travada: a
 * autorização lida antes (`imovelOperavel`) pode ter mudado no meio (contrato encerrado ou trocado no
 * painel). Toda escrita do portal passa por aqui; recusa = a mesma mensagem da conferência inicial.
 */
async function conferirContratoNaTransacao(tx: Db, organizacaoId: string, imovelId: string, dia: string): Promise<string | null> {
  await tx
    .select({ id: imoveis.id })
    .from(imoveis)
    .where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, organizacaoId)))
    .for("update");
  return emMarketplaceEm(await listarContratos(tx, organizacaoId, imovelId), dia) ? null : NAO_MARKETPLACE;
}

/** Situação do envio ao Beds24 para um imóvel: na lista? vinculado? escrita ligada? automático? último envio real que o tocou. */
export async function situacaoDoEnvio(db: Db, organizacaoId: string, regras: RegrasCalendario, imovelId: string, env: NodeJS.ProcessEnv = process.env): Promise<SituacaoEnvio> {
  // A mesma régua do envio (`calendario/envio.ts`): vínculo ativo com propriedade e quarto numéricos.
  const vinculado = (await listarMapeamentosBeds24(db, organizacaoId)).some((m) => m.imovelId === imovelId && m.ativo && /^\d+$/.test(m.propertyId) && /^\d+$/.test(m.roomId));
  const [ultimo] = await db
    .select({ em: beds24Envios.iniciadoEm, situacao: beds24Envios.situacao })
    .from(beds24Envios)
    .where(
      and(
        eq(beds24Envios.organizacaoId, organizacaoId),
        eq(beds24Envios.modo, "envio"),
        exists(db.select({ um: sql`1` }).from(beds24EnvioNoites).where(and(eq(beds24EnvioNoites.envioId, beds24Envios.id), eq(beds24EnvioNoites.imovelId, imovelId)))),
      ),
    )
    .orderBy(desc(beds24Envios.iniciadoEm))
    .limit(1);
  return { naLista: regras.envio.imoveis.includes(imovelId), vinculado, escritaLigada: escritaBeds24Ligada(env), automatico: regras.envio.automatico, ultimo: ultimo ? { em: ultimo.em, situacao: ultimo.situacao } : null };
}

/**
 * Imóveis da sessão em contrato marketplace hoje (no fuso de cada um), com o cadastro, os períodos e
 * a situação do envio. Imóvel de gestão total ou online fica de fora: nele quem cuida é a empresa.
 */
export async function imoveisMarketplaceDaSessao(db: Db, sessao: Sessao, agora = new Date()): Promise<ImovelMarketplace[]> {
  const ids = sessao.imovelIds.filter(uuidValido);
  if (!ids.length || sessao.papel !== "proprietario") return [];
  const linhas = await db.select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.organizacaoId, sessao.organizacaoId), inArray(imoveis.id, ids))).orderBy(asc(imoveis.codigo));
  const regras = await lerRegrasCalendario(db, sessao.organizacaoId);
  const posse = await posseDesde(db, linhas.map((i) => i.id));
  const saida: ImovelMarketplace[] = [];
  for (const im of linhas) {
    if (!emMarketplaceEm(await listarContratos(db, sessao.organizacaoId, im.id), hojeISO(im.fuso, agora))) continue;
    const [detalhes, periodos, envio] = await Promise.all([lerDetalhes(db, sessao.organizacaoId, im.id), listarPeriodos(db, sessao.organizacaoId, im.id), situacaoDoEnvio(db, sessao.organizacaoId, regras, im.id)]);
    saida.push({ ...im, posseDesde: posse.get(im.id) ?? null, fontePrecos: detalhes.fontePrecos, detalhes, periodos, envio });
  }
  return saida;
}

/** Regra do modelo B (M12.1) para o proprietário ver o que o site faz com o preço dele. */
export async function precosDoMarketplace(db: Db, organizacaoId: string): Promise<PrecosMarketplace> {
  return lerPrecosMarketplace(db, organizacaoId);
}
export { simular };

/**
 * Salva os campos do portal no cadastro do imóvel, passando pela validação do painel com o resto do
 * cadastro preservado — lido e mesclado dentro da transação de gravação, com o imóvel travado, para
 * não gravar uma foto velha por cima de uma edição do painel feita no meio. Com os preços definidos no
 * Beds24 (M3.9), o preço da noite é editado lá: aqui só limpeza, hóspede extra, regras e horários.
 */
export async function salvarPrecosPeloProprietario(db: Db, sessao: Sessao, imovelId: string, entrada: Record<string, string | string[]>, agora = new Date()): Promise<ResultadoPortal> {
  const r = await imovelOperavel(db, sessao, imovelId, agora);
  if (!r.ok) return r;
  return salvarDetalhesComLeitura(
    db,
    sessao.organizacaoId,
    r.imovel.id,
    (atual) => {
      const completa: Record<string, string | string[]> = entradaDeDetalhes(atual);
      for (const campo of CAMPOS_PORTAL) {
        const v = entrada[campo];
        completa[campo] = CAMPOS_LISTA.includes(campo) ? (Array.isArray(v) ? v : v === undefined || v === "" ? [] : [v]) : Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
      }
      const v = validarDetalhes(completa);
      if (!v.ok) return { erro: "Confira os campos destacados.", erros: v.erros };
      if (atual.fontePrecos === "beds24" && v.dados.precoBase !== atual.precoBase) {
        return { erro: "Confira os campos destacados.", erros: { precoBase: "Os preços deste imóvel são definidos no Beds24: o preço da noite é editado lá. Limpeza, hóspede extra, regras e horários podem ser editados aqui." } };
      }
      return v.dados;
    },
    sessao.usuarioId,
    agora,
    { conferir: (tx) => conferirContratoNaTransacao(tx, sessao.organizacaoId, r.imovel.id, r.dia) },
  );
}

export async function criarPeriodoPeloProprietario(db: Db, sessao: Sessao, imovelId: string, entrada: Record<string, unknown>, agora = new Date()): Promise<ResultadoPortal> {
  const r = await imovelOperavel(db, sessao, imovelId, agora);
  if (!r.ok) return r;
  const preco = typeof entrada.precoNoite === "string" ? entrada.precoNoite.trim() : "";
  // Contrato e fonte de preços são conferidos dentro da transação que grava o período, com o imóvel travado (o painel pode tê-los mudado no meio).
  return criarPeriodo(db, sessao.organizacaoId, r.imovel.id, entrada, sessao.usuarioId, {
    conferir: async (atual, tx) =>
      (await conferirContratoNaTransacao(tx, sessao.organizacaoId, r.imovel.id, r.dia)) ?? (atual.fontePrecos === "beds24" && preco ? "Os preços deste imóvel são definidos no Beds24: aqui o período só pode ter estadia mínima. Deixe o preço em branco." : null),
  });
}

export async function excluirPeriodoPeloProprietario(db: Db, sessao: Sessao, periodoId: string, agora = new Date()): Promise<ResultadoPortal> {
  if (!uuidValido(periodoId)) return { ok: false, erro: "Período não encontrado." };
  const [p] = await db.select({ imovelId: imoveisPeriodos.imovelId }).from(imoveisPeriodos).where(and(eq(imoveisPeriodos.id, periodoId), eq(imoveisPeriodos.organizacaoId, sessao.organizacaoId)));
  if (!p) return { ok: false, erro: "Período não encontrado." };
  const r = await imovelOperavel(db, sessao, p.imovelId, agora);
  if (!r.ok) return r;
  const feito = await excluirPeriodo(db, sessao.organizacaoId, periodoId, sessao.usuarioId, { conferir: (tx, imovelId) => conferirContratoNaTransacao(tx, sessao.organizacaoId, imovelId, r.dia) });
  if (typeof feito === "string") return { ok: false, erro: feito };
  return feito ? { ok: true } : { ok: false, erro: "Período não encontrado." };
}

// --- Limpezas e manutenção por conta própria ---------------------------------------------------

export const DIAS_ANTES = 3;
export const DIAS_DEPOIS = 14;
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type LimpezaDoProprietario = {
  id: string;
  data: string;
  estado: "pedida" | "confirmada" | "realizada";
  imovelId: string;
  imovelCodigo: string;
  imovelNome: string;
  reservaCodigo: string | null;
  /** Alguém entra no imóvel no mesmo dia: deixar pronto até a hora de entrada. */
  entraNoDia: boolean;
  /** Já passou do dia (no fuso do imóvel) e ainda não foi marcada como feita. */
  atrasada: boolean;
  /** Já chegou o dia dela (no fuso do imóvel) e ainda não foi marcada: o botão "marcar como feita" aparece. */
  podeMarcar: boolean;
};

/**
 * Limpezas (saídas) dos imóveis marketplace da sessão, de alguns dias atrás até as próximas duas
 * semanas — só as de imóvel em contrato marketplace na data da limpeza e do tempo em que o imóvel é
 * do dono atual (as de antes do vínculo ficam com a empresa e com o dono da época). "Hoje", a janela, o
 * atraso e o "pode marcar" são no fuso de cada imóvel, a mesma régua que a ação de marcar usa. Sem custo nem financeiro.
 */
export async function limpezasDoProprietario(db: Db, sessao: Sessao, agora = new Date()): Promise<LimpezaDoProprietario[]> {
  const ids = sessao.imovelIds.filter(uuidValido);
  if (!ids.length || sessao.papel !== "proprietario") return [];
  // A consulta pega um dia a mais de cada lado (fusos diferentes de São Paulo); a janela certa é por imóvel, abaixo.
  const hojeSp = hojeISO(undefined, agora);
  const linhas = await db
    .select({ id: limpezas.id, data: limpezas.data, estado: limpezas.estado, imovelId: limpezas.imovelId, imovelCodigo: imoveis.codigo, imovelNome: imoveis.nome, fuso: imoveis.fuso, reservaCodigo: reservas.codigo })
    .from(limpezas)
    .innerJoin(imoveis, eq(imoveis.id, limpezas.imovelId))
    .leftJoin(reservas, eq(reservas.id, limpezas.reservaId))
    .where(and(eq(limpezas.organizacaoId, sessao.organizacaoId), inArray(limpezas.imovelId, ids), inArray(limpezas.estado, ["pedida", "confirmada", "realizada"]), gte(limpezas.data, somaDias(hojeSp, -DIAS_ANTES - 1)), lt(limpezas.data, somaDias(hojeSp, DIAS_DEPOIS + 2))))
    .orderBy(asc(limpezas.data), asc(imoveis.codigo));
  if (!linhas.length) return [];
  const contratos = new Map<string, ContratoLinha[]>();
  for (const id of new Set(linhas.map((l) => l.imovelId))) contratos.set(id, await listarContratos(db, sessao.organizacaoId, id));
  const posse = await posseDesde(db, [...new Set(linhas.map((l) => l.imovelId))]);
  const minhas = linhas.filter((l) => emMarketplaceEm(contratos.get(l.imovelId) ?? [], l.data) && l.data >= (posse.get(l.imovelId) ?? "9999-12-31"));
  if (!minhas.length) return [];
  const entradas = await db
    .selectDistinct({ imovelId: reservas.imovelId, checkin: reservas.checkin })
    .from(reservas)
    .where(and(eq(reservas.organizacaoId, sessao.organizacaoId), eq(reservas.estado, "confirmada"), inArray(reservas.imovelId, [...new Set(minhas.map((l) => l.imovelId))]), inArray(reservas.checkin, [...new Set(minhas.map((l) => l.data))])));
  return minhas.flatMap(({ fuso, ...l }) => {
    const hoje = hojeISO(fuso, agora);
    if (l.data < somaDias(hoje, -DIAS_ANTES) || l.data > somaDias(hoje, DIAS_DEPOIS)) return [];
    const estado = l.estado as LimpezaDoProprietario["estado"];
    return [{ ...l, estado, entraNoDia: entradas.some((e) => e.imovelId === l.imovelId && e.checkin === l.data), atrasada: estado !== "realizada" && l.data < hoje, podeMarcar: estado !== "realizada" && l.data <= hoje }];
  });
}

/** O proprietário marca a limpeza do imóvel marketplace como feita (a partir do dia dela, no fuso do imóvel; sem custo para a empresa). */
export async function marcarLimpezaFeitaPeloProprietario(db: Db, sessao: Sessao, limpezaId: string, agora = new Date()): Promise<ResultadoPortal> {
  if (!uuidValido(limpezaId)) return { ok: false, erro: "Limpeza não encontrada." };
  const [l] = await db.select({ imovelId: limpezas.imovelId, data: limpezas.data }).from(limpezas).where(and(eq(limpezas.id, limpezaId), eq(limpezas.organizacaoId, sessao.organizacaoId)));
  if (!l) return { ok: false, erro: "Limpeza não encontrada." };
  const r = await imovelOperavel(db, sessao, l.imovelId, l.data);
  if (!r.ok) return r;
  if (!r.posseDesde || l.data < r.posseDesde) return { ok: false, erro: ANTES_DA_POSSE(r.posseDesde ?? l.data) };
  return realizarPeloProprietario(db, sessao.organizacaoId, limpezaId, hojeISO(r.imovel.fuso, agora), sessao.usuarioId, (atual, tx) => conferirContratoNaTransacao(tx, sessao.organizacaoId, atual.imovelId, atual.data));
}

export type ManutencaoDoProprietario = { id: string; imovelCodigo: string; titulo: string; descricao: string; estado: string; dataRealizada: string | null; porContaPropria: boolean };

/** Manutenções dos imóveis marketplace da sessão — as mais recentes (por registro) do tempo em que o imóvel é do dono atual, sem valores da empresa. */
export async function manutencoesDoProprietario(db: Db, sessao: Sessao, agora = new Date(), limite = 20): Promise<ManutencaoDoProprietario[]> {
  const meus = await imoveisMarketplaceDaSessao(db, sessao, agora);
  if (!meus.length) return [];
  const posse = new Map(meus.map((i) => [i.id, i.posseDesde ?? "9999-12-31"]));
  // `listarManutencoes` ordena pelo que pede ação (fila do painel); aqui é histórico: as últimas registradas primeiro.
  // Só do tempo do dono atual (pela data do serviço ou, sem ela, do registro): a manutenção do dono anterior não é dele.
  const lista = [...(await listarManutencoes(db, sessao.organizacaoId, { imovelIds: meus.map((i) => i.id) }))]
    .filter((m) => (m.dataRealizada ?? hojeISO("America/Sao_Paulo", m.criadoEm)) >= (posse.get(m.imovelId) ?? "9999-12-31"))
    .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
  return lista.slice(0, limite).map((m) => ({ id: m.id, imovelCodigo: m.imovelCodigo, titulo: m.titulo, descricao: m.descricao, estado: m.estado, dataRealizada: m.dataRealizada, porContaPropria: m.semCusto }));
}

/** O proprietário registra uma manutenção que ele mesmo fez no imóvel marketplace (nasce realizada, por conta dele; "hoje" no fuso do imóvel). */
export async function registrarManutencaoPeloProprietario(db: Db, sessao: Sessao, d: { imovelId: string; titulo: string; descricao: string; data: string }, agora = new Date()): Promise<ResultadoPortal> {
  const r = await imovelOperavel(db, sessao, d.imovelId, /^\d{4}-\d{2}-\d{2}$/.test(d.data) ? d.data : agora);
  if (!r.ok) return r;
  if (!r.posseDesde || (/^\d{4}-\d{2}-\d{2}$/.test(d.data) && d.data < r.posseDesde)) return { ok: false, erro: ANTES_DA_POSSE(r.posseDesde ?? d.data) };
  const feito = await registrarFeitaPeloProprietario(db, sessao.organizacaoId, d, hojeISO(r.imovel.fuso, agora), sessao.usuarioId, (tx) => conferirContratoNaTransacao(tx, sessao.organizacaoId, r.imovel.id, r.dia));
  return feito.ok ? { ok: true } : feito;
}
