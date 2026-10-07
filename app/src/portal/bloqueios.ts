/**
 * Calendário do proprietário no portal (M5.5): bloqueio de uso próprio e liberação das datas,
 * conforme a permissão do contrato em vigor. A mudança entra no SCL na hora (como um bloqueio
 * manual da equipe, com fonte "proprietario") e segue para o Beds24/OTAs pelo envio de
 * calendário (M3.7). Toda decisão é tomada no servidor, a partir da sessão autenticada.
 */
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { exigir, type Sessao } from "@/acesso/politica";
import { contratoVigente, vigenteEm } from "@/contratos/regras";
import { contratos, bloqueios, imoveis, proprietarioImoveis, type TipoContrato } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { criarBloqueio, excluirBloqueio, type ResultadoBloqueio, type ResultadoRemocao, validarBloqueio } from "@/reservas/bloqueios";
import { proprietariosDoUsuario } from "./resumo";

export type EntradaBloqueioPortal = { imovelId: string; inicio: string; fim: string; motivo: string };
/** `proprio`: feito por um titular da conta dele (não pelo titular anterior do imóvel). */
/** Quem fechou as datas, como o portal mostra: o proprietário, a empresa ou os canais (sem o nome interno da importação). */
export type QuemBloqueou = "proprietario" | "empresa" | "canais";
export const quemBloqueou = (fonte: string): QuemBloqueou => (fonte === "proprietario" ? "proprietario" : fonte === "beds24" ? "canais" : "empresa");

export type BloqueioDoProprietario = { id: string; imovelId: string; codigo: string; inicio: string; fim: string; motivo: string; quem: QuemBloqueou; proprio: boolean; liberavel: boolean };

const SEM_PERMISSAO = "Seu contrato não prevê bloqueio de datas pelo portal. Fale com a empresa.";
const SEM_TITULAR = "Não foi possível identificar o titular deste imóvel na sua conta. Fale com a empresa.";

/** Titulares (proprietários ativos) ligados ao usuário da sessão. */
async function titularesDaSessao(db: Db, sessao: Sessao): Promise<string[]> {
  return (await proprietariosDoUsuario(db, sessao.organizacaoId, sessao.usuarioId)).map((p) => p.id);
}
const SEM_CONTRATO = "Não há contrato em vigor cobrindo todas essas datas. Fale com a empresa.";

type ContratoDoImovel = { imovelId: string; tipo: TipoContrato; comissaoBp: number | null; inicio: string; fim: string | null; proprietarioBloqueia: boolean };

async function contratosDosImoveis(db: Db, organizacaoId: string, imovelIds: readonly string[]): Promise<ContratoDoImovel[]> {
  if (!imovelIds.length) return [];
  return db
    .select({ imovelId: contratos.imovelId, tipo: contratos.tipo, comissaoBp: contratos.comissaoBp, inicio: contratos.inicio, fim: contratos.fim, proprietarioBloqueia: contratos.proprietarioBloqueia })
    .from(contratos)
    .where(and(eq(contratos.organizacaoId, organizacaoId), inArray(contratos.imovelId, [...imovelIds])));
}

/**
 * Permissão para bloquear da primeira à última noite: **um só** contrato precisa cobrir todas as noites
 * (contratos não se sobrepõem, então o que vale na primeira noite tem de valer ainda na última). `null` =
 * nenhum contrato cobre todas as noites (buraco entre contratos conta como sem contrato); `false` = o
 * contrato cobre mas não permite.
 */
export function permissaoNoIntervalo(lista: readonly ContratoDoImovel[], inicio: string, ultimaNoite: string): boolean | null {
  const c = contratoVigente(lista, inicio);
  if (!c || !vigenteEm(c, ultimaNoite)) return null;
  return c.proprietarioBloqueia;
}

/**
 * Pode bloquear alguma data de `hoje` em diante? `true` se algum contrato em vigor ou futuro permite,
 * `false` se há contrato daí em diante mas nenhum permite, `null` se não há contrato daí em diante. Serve
 * para montar a lista de imóveis do formulário; a data pedida é conferida no servidor por `permissaoNoIntervalo`.
 */
export function permissaoAPartirDe(lista: readonly ContratoDoImovel[], hoje: string): boolean | null {
  const adiante = lista.filter((c) => c.fim === null || c.fim >= hoje);
  if (!adiante.length) return null;
  return adiante.some((c) => c.proprietarioBloqueia);
}

/** `permissaoAPartirDe` por imóvel (uma regra, um lugar: o portal monta a lista e o servidor decide pela mesma tabela). */
export async function permissoesDeBloqueio(db: Db, organizacaoId: string, imovelIds: readonly string[], hoje: string): Promise<Map<string, boolean | null>> {
  const ids = imovelIds.filter(uuidValido);
  const lista = await contratosDosImoveis(db, organizacaoId, ids);
  return new Map(ids.map((id) => [id, permissaoAPartirDe(lista.filter((c) => c.imovelId === id), hoje)]));
}

/** Bloqueia datas de uso próprio num imóvel do proprietário da sessão. Exige `bloqueio:proprio` no imóvel. */
export async function bloquearPeloProprietario(db: Db, sessao: Sessao, e: EntradaBloqueioPortal, agora = new Date()): Promise<ResultadoBloqueio> {
  const v = validarBloqueio(e);
  if (!v.ok) return v;
  exigir(sessao, "bloqueio:proprio", { organizacaoId: sessao.organizacaoId, imovelId: v.dados.imovelId });
  const [im] = await db.select({ id: imoveis.id, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.id, v.dados.imovelId), eq(imoveis.organizacaoId, sessao.organizacaoId)));
  if (!im) return { ok: false, erro: "Imóvel não encontrado." };
  // Nunca no passado: o passado não é recalculado nem enviado (data no fuso do imóvel).
  if (v.dados.inicio < hojeISO(im.fuso, agora)) return { ok: false, erro: "Só é possível bloquear a partir de hoje." };
  // Um só contrato tem de cobrir todas as noites (da primeira à última) e permitir o bloqueio.
  const ultimaNoite = new Date(Date.parse(`${v.dados.fim}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const permissao = permissaoNoIntervalo(await contratosDosImoveis(db, sessao.organizacaoId, [im.id]), v.dados.inicio, ultimaNoite);
  if (permissao === null) return { ok: false, erro: SEM_CONTRATO };
  if (!permissao) return { ok: false, erro: SEM_PERMISSAO };
  // O bloqueio fica ligado ao titular (proprietário) do imóvel na conta dele: só esse titular libera depois
  // (uma troca de titular não passa os bloqueios do anterior ao novo). Sem titular único identificável, avisa.
  const meus = await titularesDaSessao(db, sessao);
  const titulares = meus.length
    ? await db.select({ id: proprietarioImoveis.proprietarioId }).from(proprietarioImoveis).where(and(eq(proprietarioImoveis.imovelId, im.id), inArray(proprietarioImoveis.proprietarioId, meus)))
    : [];
  if (titulares.length !== 1) return { ok: false, erro: SEM_TITULAR };
  return criarBloqueio(db, sessao.organizacaoId, { ...v.dados, motivo: v.dados.motivo || "Uso próprio" }, sessao.usuarioId, { fonte: "proprietario", semReserva: true, proprietarioId: titulares[0].id });
}

/** Libera datas que o próprio proprietário bloqueou (bloqueio da empresa ou do Beds24 não é dele para liberar). */
export async function liberarPeloProprietario(db: Db, sessao: Sessao, bloqueioId: string, agora = new Date()): Promise<ResultadoRemocao> {
  if (!uuidValido(bloqueioId)) return { ok: false, erro: "Bloqueio não encontrado." };
  const [b] = await db
    .select({ id: bloqueios.id, imovelId: bloqueios.imovelId, fim: bloqueios.fim, fonte: bloqueios.fonte, fuso: imoveis.fuso })
    .from(bloqueios)
    .innerJoin(imoveis, eq(imoveis.id, bloqueios.imovelId))
    .where(and(eq(bloqueios.id, bloqueioId), eq(bloqueios.organizacaoId, sessao.organizacaoId)));
  if (!b) return { ok: false, erro: "Bloqueio não encontrado." };
  exigir(sessao, "bloqueio:proprio", { organizacaoId: sessao.organizacaoId, imovelId: b.imovelId });
  if (b.fim <= hojeISO(b.fuso, agora)) return { ok: false, erro: "Esse bloqueio já passou; não há datas a liberar." };
  return excluirBloqueio(db, sessao.organizacaoId, bloqueioId, sessao.usuarioId, { somenteFonte: "proprietario", imovelIds: sessao.imovelIds, proprietarioIds: await titularesDaSessao(db, sessao) });
}

/**
 * Bloqueios atuais e futuros dos imóveis do proprietário, com quem fez cada um; só os dele, e só os que ainda
 * não acabaram, são liberáveis. "Hoje" é o de cada imóvel (fuso do imóvel), a mesma data que a liberação usa.
 */
/** O que o portal mostra como motivo de um bloqueio vindo dos canais (Airbnb, Booking), no lugar do texto interno. */
export const MOTIVO_BLOQUEIO_DOS_CANAIS = "Datas fechadas nos canais (Airbnb, Booking)";

export async function bloqueiosDoProprietario(db: Db, sessao: Sessao, agora = new Date()): Promise<BloqueioDoProprietario[]> {
  const ids = sessao.imovelIds.filter(uuidValido);
  if (!ids.length) return [];
  // Filtro largo no banco (um dia antes da data UTC cobre qualquer fuso); a data certa de cada imóvel decide abaixo.
  const limite = new Date(agora.getTime() - 86_400_000).toISOString().slice(0, 10);
  const meus = await titularesDaSessao(db, sessao);
  const linhas = await db
    .select({ id: bloqueios.id, imovelId: bloqueios.imovelId, codigo: imoveis.codigo, fuso: imoveis.fuso, inicio: bloqueios.inicio, fim: bloqueios.fim, motivo: bloqueios.motivo, fonte: bloqueios.fonte, proprietarioId: bloqueios.proprietarioId })
    .from(bloqueios)
    .innerJoin(imoveis, eq(imoveis.id, bloqueios.imovelId))
    .where(and(eq(bloqueios.organizacaoId, sessao.organizacaoId), inArray(bloqueios.imovelId, ids), gte(bloqueios.fim, limite)))
    .orderBy(asc(bloqueios.inicio), asc(imoveis.codigo));
  return linhas.flatMap(({ fuso, proprietarioId, fonte, ...b }) => {
    const hoje = hojeISO(fuso, agora);
    const quem = quemBloqueou(fonte);
    const proprio = quem === "proprietario" && proprietarioId !== null && meus.includes(proprietarioId);
    // Bloqueio vindo dos canais: o motivo gravado na importação é interno (cita o Beds24); o proprietário lê só que
    // as datas foram fechadas nos canais (M5.9). A fonte em si também não vai: só quem bloqueou.
    const motivo = quem === "canais" ? MOTIVO_BLOQUEIO_DOS_CANAIS : b.motivo;
    return b.fim >= hoje ? [{ ...b, motivo, quem, proprio, liberavel: proprio && b.fim > hoje }] : [];
  });
}
