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
import { lerRegrasCalendario, type RegrasCalendario } from "@/calendario/regras-config";
import { type ContratoVigencia, contratoVigente } from "@/contratos/regras";
import { listarContratos } from "@/contratos/repositorio";
import { beds24Envios, beds24EnvioNoites, imoveis, imoveisPeriodos, limpezas, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { type Detalhes, type ErrosDetalhes, criarPeriodo, entradaDeDetalhes, excluirPeriodo, lerDetalhes, listarPeriodos, salvarDetalhes, validarDetalhes } from "@/imoveis/detalhes";
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

/** Campos do cadastro que o proprietário marketplace edita pelo portal (o resto fica como está). */
export const CAMPOS_PORTAL = ["precoBase", "taxaLimpeza", "hospedeExtraValor", "hospedeExtraAPartirDe", "estadiaMinima", "estadiaMaxima", "antecedenciaMinima", "janelaMaxima", "diasChegada", "diasSaida", "checkinAPartirDe", "checkoutAte"] as const;
export type CampoPortal = (typeof CAMPOS_PORTAL)[number];
const CAMPOS_LISTA: readonly CampoPortal[] = ["diasChegada", "diasSaida"];

export type SituacaoEnvio = {
  /** O imóvel está na lista de envio ao Beds24 (Configurações → Calendário e preços). */
  naLista: boolean;
  /** O envio roda sozinho todo dia. */
  automatico: boolean;
  /** Último envio (de verdade, não simulação) que tocou este imóvel. */
  ultimo: { em: Date; situacao: string } | null;
};

export type ImovelMarketplace = {
  id: string;
  codigo: string;
  nome: string;
  fuso: string;
  fontePrecos: FontePrecos;
  detalhes: Detalhes;
  periodos: (Periodo & { id: string })[];
  envio: SituacaoEnvio;
};

export type ResultadoPortal = { ok: true } | { ok: false; erro: string; erros?: ErrosDetalhes };

type ContratoLinha = ContratoVigencia & { tipo: string };
/** Em contrato marketplace no dia? (contratos não se sobrepõem; vale o vigente no dia) */
export const emMarketplaceEm = (contratos: readonly ContratoLinha[], dia: string) => contratoVigente(contratos, dia)?.tipo === "marketplace";

/** Imóvel da organização, da sessão (política) e em contrato marketplace no dia; senão, o motivo. */
async function imovelOperavel(db: Db, sessao: Sessao, imovelId: string, dia: string): Promise<{ ok: true; imovel: { id: string; codigo: string; fuso: string } } | { ok: false; erro: string }> {
  if (!uuidValido(imovelId)) return { ok: false, erro: SEM_IMOVEL };
  exigir(sessao, "marketplace:operar", { organizacaoId: sessao.organizacaoId, imovelId });
  const [im] = await db.select({ id: imoveis.id, codigo: imoveis.codigo, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, sessao.organizacaoId)));
  if (!im) return { ok: false, erro: SEM_IMOVEL };
  if (!emMarketplaceEm(await listarContratos(db, sessao.organizacaoId, im.id), dia)) return { ok: false, erro: NAO_MARKETPLACE };
  return { ok: true, imovel: im };
}

/** Situação do envio ao Beds24 para um imóvel: na lista? automático? último envio real que o tocou. */
export async function situacaoDoEnvio(db: Db, organizacaoId: string, regras: RegrasCalendario, imovelId: string): Promise<SituacaoEnvio> {
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
  return { naLista: regras.envio.imoveis.includes(imovelId), automatico: regras.envio.automatico, ultimo: ultimo ? { em: ultimo.em, situacao: ultimo.situacao } : null };
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
  const saida: ImovelMarketplace[] = [];
  for (const im of linhas) {
    if (!emMarketplaceEm(await listarContratos(db, sessao.organizacaoId, im.id), hojeISO(im.fuso, agora))) continue;
    const [detalhes, periodos, envio] = await Promise.all([lerDetalhes(db, sessao.organizacaoId, im.id), listarPeriodos(db, sessao.organizacaoId, im.id), situacaoDoEnvio(db, sessao.organizacaoId, regras, im.id)]);
    saida.push({ ...im, fontePrecos: detalhes.fontePrecos, detalhes, periodos, envio });
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
 * cadastro preservado. Com os preços definidos no Beds24 (M3.9), o preço da noite é editado lá:
 * aqui só limpeza, hóspede extra, regras e horários.
 */
export async function salvarPrecosPeloProprietario(db: Db, sessao: Sessao, imovelId: string, entrada: Record<string, string | string[]>, agora = new Date()): Promise<ResultadoPortal> {
  const r = await imovelOperavel(db, sessao, imovelId, hojeISO(undefined, agora));
  if (!r.ok) return r;
  const atual = await lerDetalhes(db, sessao.organizacaoId, r.imovel.id);
  const completa: Record<string, string | string[]> = entradaDeDetalhes(atual);
  for (const campo of CAMPOS_PORTAL) {
    const v = entrada[campo];
    completa[campo] = CAMPOS_LISTA.includes(campo) ? (Array.isArray(v) ? v : v === undefined || v === "" ? [] : [v]) : Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  }
  const v = validarDetalhes(completa);
  if (!v.ok) return { ok: false, erro: "Confira os campos destacados.", erros: v.erros };
  if (atual.fontePrecos === "beds24" && v.dados.precoBase !== atual.precoBase) {
    return { ok: false, erro: "Confira os campos destacados.", erros: { precoBase: "Os preços deste imóvel são definidos no Beds24: o preço da noite é editado lá. Limpeza, hóspede extra, regras e horários podem ser editados aqui." } };
  }
  const salvo = await salvarDetalhes(db, sessao.organizacaoId, r.imovel.id, v.dados, sessao.usuarioId, agora);
  if (salvo === false) return { ok: false, erro: SEM_IMOVEL };
  if (typeof salvo === "string") return { ok: false, erro: salvo };
  return { ok: true };
}

export async function criarPeriodoPeloProprietario(db: Db, sessao: Sessao, imovelId: string, entrada: Record<string, unknown>, agora = new Date()): Promise<ResultadoPortal> {
  const r = await imovelOperavel(db, sessao, imovelId, hojeISO(undefined, agora));
  if (!r.ok) return r;
  const atual = await lerDetalhes(db, sessao.organizacaoId, r.imovel.id);
  const preco = typeof entrada.precoNoite === "string" ? entrada.precoNoite.trim() : "";
  if (atual.fontePrecos === "beds24" && preco) return { ok: false, erro: "Os preços deste imóvel são definidos no Beds24: aqui o período só pode ter estadia mínima. Deixe o preço em branco." };
  return criarPeriodo(db, sessao.organizacaoId, r.imovel.id, entrada, sessao.usuarioId);
}

export async function excluirPeriodoPeloProprietario(db: Db, sessao: Sessao, periodoId: string, agora = new Date()): Promise<ResultadoPortal> {
  if (!uuidValido(periodoId)) return { ok: false, erro: "Período não encontrado." };
  const [p] = await db.select({ imovelId: imoveisPeriodos.imovelId }).from(imoveisPeriodos).where(and(eq(imoveisPeriodos.id, periodoId), eq(imoveisPeriodos.organizacaoId, sessao.organizacaoId)));
  if (!p) return { ok: false, erro: "Período não encontrado." };
  const r = await imovelOperavel(db, sessao, p.imovelId, hojeISO(undefined, agora));
  if (!r.ok) return r;
  return (await excluirPeriodo(db, sessao.organizacaoId, periodoId, sessao.usuarioId)) ? { ok: true } : { ok: false, erro: "Período não encontrado." };
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
  /** Já passou do dia e ainda não foi marcada como feita. */
  atrasada: boolean;
};

/**
 * Limpezas (saídas) dos imóveis marketplace da sessão, de alguns dias atrás até as próximas duas
 * semanas — só as de imóvel em contrato marketplace na data da limpeza. Sem custo nem financeiro.
 */
export async function limpezasDoProprietario(db: Db, sessao: Sessao, hoje: string): Promise<LimpezaDoProprietario[]> {
  const ids = sessao.imovelIds.filter(uuidValido);
  if (!ids.length || sessao.papel !== "proprietario") return [];
  const linhas = await db
    .select({ id: limpezas.id, data: limpezas.data, estado: limpezas.estado, imovelId: limpezas.imovelId, imovelCodigo: imoveis.codigo, imovelNome: imoveis.nome, reservaCodigo: reservas.codigo })
    .from(limpezas)
    .innerJoin(imoveis, eq(imoveis.id, limpezas.imovelId))
    .leftJoin(reservas, eq(reservas.id, limpezas.reservaId))
    .where(and(eq(limpezas.organizacaoId, sessao.organizacaoId), inArray(limpezas.imovelId, ids), inArray(limpezas.estado, ["pedida", "confirmada", "realizada"]), gte(limpezas.data, somaDias(hoje, -DIAS_ANTES)), lt(limpezas.data, somaDias(hoje, DIAS_DEPOIS + 1))))
    .orderBy(asc(limpezas.data), asc(imoveis.codigo));
  if (!linhas.length) return [];
  const contratos = new Map<string, ContratoLinha[]>();
  for (const id of new Set(linhas.map((l) => l.imovelId))) contratos.set(id, await listarContratos(db, sessao.organizacaoId, id));
  const minhas = linhas.filter((l) => emMarketplaceEm(contratos.get(l.imovelId) ?? [], l.data));
  if (!minhas.length) return [];
  const entradas = await db
    .selectDistinct({ imovelId: reservas.imovelId, checkin: reservas.checkin })
    .from(reservas)
    .where(and(eq(reservas.organizacaoId, sessao.organizacaoId), eq(reservas.estado, "confirmada"), inArray(reservas.imovelId, [...new Set(minhas.map((l) => l.imovelId))]), inArray(reservas.checkin, [...new Set(minhas.map((l) => l.data))])));
  return minhas.map((l) => ({
    ...l,
    estado: l.estado as LimpezaDoProprietario["estado"],
    entraNoDia: entradas.some((e) => e.imovelId === l.imovelId && e.checkin === l.data),
    atrasada: l.estado !== "realizada" && l.data < hoje,
  }));
}

/** O proprietário marca a limpeza do imóvel marketplace como feita (a partir do dia dela; sem custo para a empresa). */
export async function marcarLimpezaFeitaPeloProprietario(db: Db, sessao: Sessao, limpezaId: string, hoje: string): Promise<ResultadoPortal> {
  if (!uuidValido(limpezaId)) return { ok: false, erro: "Limpeza não encontrada." };
  const [l] = await db.select({ imovelId: limpezas.imovelId, data: limpezas.data }).from(limpezas).where(and(eq(limpezas.id, limpezaId), eq(limpezas.organizacaoId, sessao.organizacaoId)));
  if (!l) return { ok: false, erro: "Limpeza não encontrada." };
  const r = await imovelOperavel(db, sessao, l.imovelId, l.data);
  if (!r.ok) return r;
  return realizarPeloProprietario(db, sessao.organizacaoId, limpezaId, hoje, sessao.usuarioId);
}

export type ManutencaoDoProprietario = { id: string; imovelCodigo: string; titulo: string; descricao: string; estado: string; dataRealizada: string | null; porContaPropria: boolean };

/** Manutenções dos imóveis marketplace da sessão (as mais recentes), sem valores da empresa. */
export async function manutencoesDoProprietario(db: Db, sessao: Sessao, agora = new Date(), limite = 20): Promise<ManutencaoDoProprietario[]> {
  const meus = await imoveisMarketplaceDaSessao(db, sessao, agora);
  if (!meus.length) return [];
  const lista = await listarManutencoes(db, sessao.organizacaoId, { imovelIds: meus.map((i) => i.id) });
  return lista.slice(0, limite).map((m) => ({ id: m.id, imovelCodigo: m.imovelCodigo, titulo: m.titulo, descricao: m.descricao, estado: m.estado, dataRealizada: m.dataRealizada, porContaPropria: m.responsavel === "proprietario" }));
}

/** O proprietário registra uma manutenção que ele mesmo fez no imóvel marketplace (nasce realizada, por conta dele). */
export async function registrarManutencaoPeloProprietario(db: Db, sessao: Sessao, d: { imovelId: string; titulo: string; descricao: string; data: string }, hoje: string): Promise<ResultadoPortal> {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(d.data) ? d.data : hoje;
  const r = await imovelOperavel(db, sessao, d.imovelId, dia);
  if (!r.ok) return r;
  const feito = await registrarFeitaPeloProprietario(db, sessao.organizacaoId, d, hoje, sessao.usuarioId);
  return feito.ok ? { ok: true } : feito;
}
