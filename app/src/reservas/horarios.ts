/** Registro manual, restrito à operação. Não lê conversas nem envia mensagens.
 * Uma chave por reserva no armazém JSON existente evita migração e mantém isolamento por organização.
 * Pedidos e acordos são separados; datas/imóvel e a confirmação da reserva fazem parte do acordo e
 * impedem reutilização após alteração (cancelar e reconfirmar exige acordo novo).
 */
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { exigir, type Sessao } from "@/acesso/politica";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { auditoria, configuracoes, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";

export const CANAIS_HORARIO = ["Airbnb", "WhatsApp", "Booking.com", "Inbox SCL", "Outro"] as const;
export type TipoHorario = "entrada" | "saida";
type Reserva = Pick<typeof reservas.$inferSelect, "id" | "imovelId" | "checkin" | "checkout" | "estado">;
export type RegistroHorario = {
  id: string; hora: string; canal: string; referencia: string; registradoEm: string;
  registradoPor: string; imovelId: string; checkin: string; checkout: string;
  /** Quantas confirmações a reserva tinha no histórico quando o registro foi feito (ver `confirmacoes`). */
  confirmacaoReserva: number;
  confirmadoEm?: string; confirmadoPor?: string; referenciaPedido?: string;
};
export type HorariosReserva = {
  versao: number;
  entrada: { pedido?: RegistroHorario; acordo?: RegistroHorario };
  saida: { pedido?: RegistroHorario; acordo?: RegistroHorario };
  /** Confirmações da reserva no histórico agora (lido, não gravado): muda a cada reconfirmação. */
  confirmacoes: number;
};
const vazio = (confirmacoes = 0): HorariosReserva => ({ versao: 0, entrada: {}, saida: {}, confirmacoes });
/** O que vai para o armazém: a contagem de confirmações é da reserva, não do registro. */
const persistir = ({ versao, entrada, saida }: HorariosReserva) => ({ versao, entrada, saida });
const chave = (id: string) => `horarios_reserva:${id}`;
const horaValida = (h: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
const vigente = (h: RegistroHorario, r: Reserva, confirmacoes: number) =>
  h.imovelId === r.imovelId && h.checkin === r.checkin && h.checkout === r.checkout && h.confirmacaoReserva === confirmacoes;

/** Quantas vezes cada reserva passou a "confirmada" segundo o histórico (criada confirmada conta).
 * É o mesmo sinal que a agenda usa para "reserva nova". Serve de versão da confirmação: a data
 * `confirmadaEm` não serve, porque a reconfirmação vinda do Beds24 a deixa vazia de propósito. */
async function confirmacoesNoHistorico(db: Db, organizacaoId: string, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const linhas = await db.select({ id: auditoria.entidadeId, n: count() }).from(auditoria)
    .where(and(eq(auditoria.organizacaoId, organizacaoId), eq(auditoria.entidade, "reserva"), inArray(auditoria.entidadeId, ids),
      sql`${auditoria.mudancas} -> 'estado' ->> 1 = 'confirmada'`))
    .groupBy(auditoria.entidadeId);
  return new Map(linhas.map((x) => [x.id, Number(x.n)]));
}

/** Somente registros produzidos por este fluxo; JSON desconhecido nunca vira acordo. */
function lerValor(v: unknown, confirmacoes: number): HorariosReserva {
  if (!v || typeof v !== "object") return vazio(confirmacoes);
  const x = v as HorariosReserva;
  if (!Number.isSafeInteger(x.versao) || x.versao < 0) return vazio(confirmacoes);
  const r = vazio(confirmacoes);
  r.versao = x.versao;
  for (const tipo of ["entrada", "saida"] as const) for (const estado of ["pedido", "acordo"] as const) {
    const h = x[tipo]?.[estado];
    if (h && typeof h.hora === "string" && horaValida(h.hora) && typeof h.referencia === "string" && h.referencia.trim() &&
        CANAIS_HORARIO.includes(h.canal as typeof CANAIS_HORARIO[number]) && uuidValido(h.id) && uuidValido(h.registradoPor) &&
        Number.isSafeInteger(h.confirmacaoReserva) && h.confirmacaoReserva >= 0 &&
        (estado !== "acordo" || (uuidValido(h.confirmadoPor) && h.confirmadoEm))) r[tipo][estado] = h;
  }
  return r;
}

async function ler(db: Db, organizacaoId: string, ids: string[]): Promise<{ registros: Map<string, HorariosReserva>; confirmacoes: Map<string, number> }> {
  const validos = ids.filter(uuidValido);
  if (!validos.length) return { registros: new Map(), confirmacoes: new Map() };
  const linhas = await db.select({ chave: configuracoes.chave, valor: configuracoes.valor }).from(configuracoes)
    .where(and(eq(configuracoes.organizacaoId, organizacaoId), inArray(configuracoes.chave, validos.map(chave))));
  const confirmacoes = await confirmacoesNoHistorico(db, organizacaoId, validos);
  const registros = new Map(linhas.map((x) => {
    const id = x.chave.slice("horarios_reserva:".length);
    return [id, lerValor(x.valor, confirmacoes.get(id) ?? 0)];
  }));
  return { registros, confirmacoes };
}

export async function lerHorariosReservas(db: Db, organizacaoId: string, ids: string[]): Promise<Map<string, HorariosReserva>> {
  return (await ler(db, organizacaoId, ids)).registros;
}

export function acordoVigente(h: HorariosReserva | undefined, tipo: TipoHorario, r: Reserva): boolean {
  const acordo = h?.[tipo].acordo;
  return Boolean(h && acordo && r.estado === "confirmada" && vigente(acordo, r, h.confirmacoes));
}

export function horarioEfetivo(h: HorariosReserva | undefined, tipo: TipoHorario, r: Reserva, padrao: string): string {
  const acordo = h?.[tipo].acordo;
  if (acordo && acordoVigente(h, tipo, r)) return `${acordo.hora} (confirmado com hóspede)`;
  return `${padrao} (padrão${acordo ? "; acordo anterior precisa reconfirmação" : ""})`;
}

export type AlteracaoHorario = {
  reservaId: string; tipo: string; acao: string; versao: number;
  hora?: string; canal?: string; referencia?: string; aceiteExplicito?: boolean;
};

/** Autorização no serviço e reserva travada: um formulário antigo não sobrescreve nova decisão. */
export async function alterarHorario(db: Db, sessao: Sessao, d: AlteracaoHorario): Promise<{ ok: boolean; erro?: string }> {
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  if (!uuidValido(d.reservaId) || !["entrada", "saida"].includes(d.tipo) || !["pedir", "confirmar", "descartar", "revogar"].includes(d.acao))
    return { ok: false, erro: "Registro de horário inválido." };
  const tipo = d.tipo as TipoHorario;
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservas).where(and(eq(reservas.organizacaoId, sessao.organizacaoId), eq(reservas.id, d.reservaId))).for("update");
    if (!r || r.estado !== "confirmada") return { ok: false, erro: "A reserva precisa estar confirmada." };
    const lido = await ler(tx, sessao.organizacaoId, [r.id]);
    const h = lido.registros.get(r.id) ?? vazio(lido.confirmacoes.get(r.id) ?? 0);
    if (h.versao !== d.versao) return { ok: false, erro: "O registro mudou. Recarregue a reserva antes de continuar." };
    const atual = h[tipo];
    const em = new Date().toISOString();
    const referencia = d.referencia?.trim() ?? "";
    if (d.acao === "pedir") {
      if (!horaValida(d.hora ?? "") || !CANAIS_HORARIO.includes(d.canal as typeof CANAIS_HORARIO[number]) || !referencia || referencia.length > 500)
        return { ok: false, erro: "Informe horário, canal e referência da conversa (até 500 caracteres)." };
      atual.pedido = { id: randomUUID(), hora: d.hora!, canal: d.canal!, referencia, registradoEm: em, registradoPor: sessao.usuarioId,
        imovelId: r.imovelId, checkin: r.checkin, checkout: r.checkout, confirmacaoReserva: h.confirmacoes };
    } else if (d.acao === "confirmar") {
      if (!atual.pedido || !vigente(atual.pedido, r, h.confirmacoes)) return { ok: false, erro: "Registre o pedido para as datas e imóvel atuais." };
      if (d.aceiteExplicito !== true || !referencia || referencia.length > 500 || !CANAIS_HORARIO.includes(d.canal as typeof CANAIS_HORARIO[number]))
        return { ok: false, erro: "Confirme o acordo explícito com o hóspede e informe a referência do aceite." };
      atual.acordo = { ...atual.pedido, canal: d.canal!, referenciaPedido: atual.pedido.referencia, referencia, confirmadoEm: em, confirmadoPor: sessao.usuarioId };
      delete atual.pedido;
    } else if (d.acao === "descartar") {
      delete atual.pedido;
    } else {
      delete atual.acordo;
    }
    h.versao++;
    const valor = persistir(h);
    await tx.insert(configuracoes).values({ organizacaoId: sessao.organizacaoId, chave: chave(r.id), valor, atualizadoPor: sessao.usuarioId })
      .onConflictDoUpdate({ target: [configuracoes.organizacaoId, configuracoes.chave], set: { valor, atualizadoPor: sessao.usuarioId, atualizadoEm: new Date() } });
    // Evidência permanece no cadastro restrito, não em logs/auditoria geral.
    await registrarAuditoria(tx, { organizacaoId: sessao.organizacaoId, usuarioId: sessao.usuarioId, entidade: "reserva", entidadeId: r.id,
      acao: `reserva.horario.${d.acao}`, mudancas: { horario: [null, `${tipo}: ${d.acao} (versão ${h.versao})`] } });
    return { ok: true };
  });
}
