/**
 * Documentos de portaria (M6.4). Só a lista de controle — nenhum documento, número ou foto é
 * guardado no sistema nem no Git (DECISOES-OPERACIONAIS: "somente apartamento 403").
 *
 * Ritmo dos pedidos: aviso inicial na reserva; segundo pedido entre 5 e 7 dias antes da entrada,
 * se faltarem documentos; pedido final na véspera, se ainda faltar. Reserva de última hora não
 * recebe os três pedidos comprimidos. Depois da entrada, nada de cobrança: só o registro factual
 * do que falta. Encaminhar exige o destinatário conferido; entrega não é aprovação da portaria.
 */
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import { imoveis, portariaChecklists, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";

export type Checklist = typeof portariaChecklists.$inferSelect;
export type Resultado = { ok: true } | { ok: false; erro: string };

const dia = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const somaDias = (d: string, n: number) => new Date(dia(d) + n * 86_400_000).toISOString().slice(0, 10);
const diasEntre = (de: string, ate: string) => Math.round((dia(ate) - dia(de)) / 86_400_000);
const br = (d: string) => d.split("-").reverse().join("/");

// ——— Quais imóveis exigem documentos (editável no painel; nada fixo no código) ———

export async function imoveisComPortaria(db: Db, organizacaoId: string): Promise<string[]> {
  const c = await lerConfig(db, organizacaoId, "portaria");
  return Array.isArray(c?.imovelIds) ? (c.imovelIds as unknown[]).filter((x): x is string => typeof x === "string" && uuidValido(x)) : [];
}

export async function salvarImoveisComPortaria(db: Db, organizacaoId: string, imovelIds: string[], autorId: string | null): Promise<Resultado> {
  const ids = [...new Set(imovelIds.filter(uuidValido))].sort();
  if (ids.length) {
    const achados = await db
      .select({ id: imoveis.id })
      .from(imoveis)
      .where(and(eq(imoveis.organizacaoId, organizacaoId), inArray(imoveis.id, ids)));
    if (achados.length !== ids.length) return { ok: false, erro: "Imóvel não encontrado." };
  }
  await db.transaction((tx) => gravarConfig(tx, organizacaoId, "portaria", { imovelIds: ids }, autorId));
  return { ok: true };
}

// ——— Próximo passo (regra pura) ———

export type Passo = "aviso_inicial" | "segundo_pedido" | "pedido_final" | "aguardar" | "encaminhar" | "confirmar_entrega" | "concluido" | "entrada_passou";

export type EstadoPortaria = {
  checkin: string;
  /** Dia em que a reserva entrou no sistema (para não comprimir pedidos na última hora). */
  reservadaEm: string;
  hospedes: number | null;
  documentosRecebidos: number;
  avisoInicialEm: string | null;
  segundoPedidoEm: string | null;
  pedidoFinalEm: string | null;
  encaminhadoEm: string | null;
  entregaConfirmadaEm: string | null;
};

/** O que fazer agora, com a explicação para a tela. Nunca inventa aprovação nem proibição. */
export function proximoPasso(e: EstadoPortaria, hoje: string): { passo: Passo; texto: string } {
  const faltam = e.hospedes === null ? null : Math.max(0, e.hospedes - e.documentosRecebidos);
  const completo = faltam === 0;
  if (completo) {
    if (!e.encaminhadoEm) return { passo: "encaminhar", texto: "Documentos completos: confira o destinatário e encaminhe à portaria." };
    if (!e.entregaConfirmadaEm) return { passo: "confirmar_entrega", texto: `Encaminhado em ${br(e.encaminhadoEm)}: confirme a entrega (entrega não é aprovação da portaria).` };
    return { passo: "concluido", texto: `Entregue em ${br(e.entregaConfirmadaEm)}.` };
  }
  const quantos = faltam === null ? "Número de hóspedes não informado na reserva: confira quantos documentos são necessários." : `Faltam ${faltam} documento(s).`;
  if (hoje >= e.checkin) return { passo: "entrada_passou", texto: `A entrada já aconteceu. ${quantos} Sem novas cobranças: registre só a pendência concreta, se houver.` };
  const dias = diasEntre(hoje, e.checkin);
  const antecedencia = diasEntre(e.reservadaEm, e.checkin);
  if (!e.avisoInicialEm) return { passo: "aviso_inicial", texto: `${quantos} Faça o aviso inicial pedindo os documentos.` };
  // Segundo pedido só existe se a reserva foi feita antes da janela (senão comprimiria os pedidos).
  const temSegundo = antecedencia > 7;
  const pedidoHoje = [e.avisoInicialEm, e.segundoPedidoEm].includes(hoje);
  if (temSegundo && !e.segundoPedidoEm && dias >= 5 && dias <= 7 && !pedidoHoje) return { passo: "segundo_pedido", texto: `${quantos} Faça o segundo pedido (entre 5 e 7 dias antes da entrada).` };
  if (dias === 1 && !e.pedidoFinalEm && !pedidoHoje) return { passo: "pedido_final", texto: `${quantos} Faça o pedido final (véspera da entrada).` };
  const proximo =
    temSegundo && !e.segundoPedidoEm && dias > 7
      ? ` Segundo pedido entre ${br(somaDias(e.checkin, -7))} e ${br(somaDias(e.checkin, -5))}.`
      : !e.pedidoFinalEm && dias > 1
        ? ` Pedido final na véspera (${br(somaDias(e.checkin, -1))}).`
        : "";
  return { passo: "aguardar", texto: `${quantos} Aguardando.${proximo}` };
}

// ——— Lista e registro ———

export type LinhaPortaria = EstadoPortaria & {
  reservaId: string;
  codigo: string;
  imovelCodigo: string;
  hospede: string;
  checkout: string;
  checklist: Checklist | null;
  destinatarioConferido: boolean;
  pendencia: string;
  passo: Passo;
  texto: string;
};

/** Reservas confirmadas dos imóveis com portaria, com saída de hoje em diante e entrada até `ate`. */
export async function listarPortaria(db: Db, organizacaoId: string, f: { hoje: string; ate: string; imovelIds?: string[] }): Promise<LinhaPortaria[]> {
  const comPortaria = await imoveisComPortaria(db, organizacaoId);
  const ids = f.imovelIds ? comPortaria.filter((i) => f.imovelIds!.includes(i)) : comPortaria;
  if (!ids.length) return [];
  const linhas = await db
    .select({ r: reservas, imovelCodigo: imoveis.codigo, c: portariaChecklists })
    .from(reservas)
    .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
    .leftJoin(portariaChecklists, eq(portariaChecklists.reservaId, reservas.id))
    .where(
      and(
        eq(reservas.organizacaoId, organizacaoId),
        eq(reservas.estado, "confirmada"),
        inArray(reservas.imovelId, ids),
        gte(reservas.checkout, f.hoje),
        lt(reservas.checkin, f.ate),
      ),
    )
    .orderBy(asc(reservas.checkin), asc(imoveis.codigo));
  return linhas.map(({ r, imovelCodigo, c }) => {
    const estado: EstadoPortaria = {
      checkin: r.checkin,
      reservadaEm: r.criadoEm.toISOString().slice(0, 10),
      hospedes: r.hospedes,
      documentosRecebidos: c?.documentosRecebidos ?? 0,
      avisoInicialEm: c?.avisoInicialEm ?? null,
      segundoPedidoEm: c?.segundoPedidoEm ?? null,
      pedidoFinalEm: c?.pedidoFinalEm ?? null,
      encaminhadoEm: c?.encaminhadoEm ?? null,
      entregaConfirmadaEm: c?.entregaConfirmadaEm ?? null,
    };
    return {
      ...estado,
      ...proximoPasso(estado, f.hoje),
      reservaId: r.id,
      codigo: r.codigo,
      imovelCodigo,
      hospede: r.hospedeNome,
      checkout: r.checkout,
      checklist: c,
      destinatarioConferido: c?.destinatarioConferido ?? false,
      pendencia: c?.pendencia ?? "",
    };
  });
}

export type Registro =
  | { tipo: "aviso_inicial" | "segundo_pedido" | "pedido_final" | "encaminhado" | "entrega_confirmada"; data: string }
  | { tipo: "documentos"; recebidos: number }
  | { tipo: "destinatario"; conferido: boolean }
  | { tipo: "pendencia"; texto: string };

const CAMPO_DATA = {
  aviso_inicial: "avisoInicialEm",
  segundo_pedido: "segundoPedidoEm",
  pedido_final: "pedidoFinalEm",
  encaminhado: "encaminhadoEm",
  entrega_confirmada: "entregaConfirmadaEm",
} as const;

/** Registra um passo da lista (cria a lista da reserva na primeira vez). Com trava e histórico. */
export async function registrarPortaria(db: Db, organizacaoId: string, reservaId: string, reg: Registro, hoje: string, autorId: string | null): Promise<Resultado> {
  if (!uuidValido(reservaId)) return { ok: false, erro: "Reserva não encontrada." };
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ id: reservas.id, imovelId: reservas.imovelId, hospedes: reservas.hospedes, estado: reservas.estado })
      .from(reservas)
      .where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)))
      .for("update");
    if (!r) return { ok: false as const, erro: "Reserva não encontrada." };
    if (!(await imoveisComPortaria(tx, organizacaoId)).includes(r.imovelId)) return { ok: false as const, erro: "Este imóvel não exige documentos de portaria." };
    await tx.insert(portariaChecklists).values({ organizacaoId, reservaId }).onConflictDoNothing();
    const [antes] = await tx.select().from(portariaChecklists).where(eq(portariaChecklists.reservaId, reservaId)).for("update");

    let novo: Partial<Checklist>;
    if (reg.tipo === "documentos") {
      if (!Number.isSafeInteger(reg.recebidos) || reg.recebidos < 0 || reg.recebidos > 50) return { ok: false as const, erro: "Quantidade inválida." };
      if (r.hospedes !== null && reg.recebidos > r.hospedes) return { ok: false as const, erro: `A reserva tem ${r.hospedes} hóspede(s): confira a quantidade.` };
      novo = { documentosRecebidos: reg.recebidos };
    } else if (reg.tipo === "destinatario") {
      novo = { destinatarioConferido: reg.conferido };
    } else if (reg.tipo === "pendencia") {
      if (reg.texto.length > 500) return { ok: false as const, erro: "Pendência longa demais (até 500 caracteres)." };
      novo = { pendencia: reg.texto.trim() };
    } else {
      if (!dataValida(reg.data) || reg.data > hoje) return { ok: false as const, erro: "Data inválida (não pode ser no futuro)." };
      if (reg.tipo === "encaminhado") {
        if (!antes.destinatarioConferido) return { ok: false as const, erro: "Confira o destinatário da portaria antes de encaminhar." };
        if (r.hospedes === null || antes.documentosRecebidos < r.hospedes) return { ok: false as const, erro: "Ainda faltam documentos (ou o número de hóspedes não está na reserva)." };
      }
      if (reg.tipo === "entrega_confirmada" && !antes.encaminhadoEm) return { ok: false as const, erro: "Registre o encaminhamento antes de confirmar a entrega." };
      novo = { [CAMPO_DATA[reg.tipo]]: reg.data };
    }
    const [depois] = await tx
      .update(portariaChecklists)
      .set({ ...novo, atualizadoEm: new Date() })
      .where(eq(portariaChecklists.id, antes.id))
      .returning();
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: `portaria.${reg.tipo}`, entidade: "reserva", entidadeId: reservaId, mudancas: calcularMudancas(antes, depois) });
    return { ok: true as const };
  });
}
