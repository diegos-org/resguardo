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
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";

export type Checklist = typeof portariaChecklists.$inferSelect;
export type Resultado = { ok: true } | { ok: false; erro: string };

const dia = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const somaDias = (d: string, n: number) => new Date(dia(d) + n * 86_400_000).toISOString().slice(0, 10);
const diasEntre = (de: string, ate: string) => Math.round((dia(ate) - dia(de)) / 86_400_000);
const br = (d: string) => d.split("-").reverse().join("/");

/** Dia (no fuso da operação) em que a reserva entrou no sistema. */
const diaDaReserva = (criadoEm: Date) => hojeISO("America/Sao_Paulo", criadoEm);

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
      reservadaEm: diaDaReserva(r.criadoEm),
      hospedes: r.hospedes,
      // Hóspedes mudaram (nome do titular ou quantidade): os documentos contados eram de outra lista.
      documentosRecebidos: hospedesMudaram(c, r) ? 0 : (c?.documentosRecebidos ?? 0),
      // Pedido feito para uma entrada que mudou (reserva adiada/antecipada) não vale mais.
      ...pedidosVigentes(c, r.checkin, diaDaReserva(r.criadoEm)),
      // Encaminhado para outras datas da estada: precisa encaminhar de novo.
      ...envioVigente(c, r),
    };
    const passo = proximoPasso(estado, f.hoje);
    if (hospedesMudaram(c, r)) passo.texto = `Os hóspedes da reserva mudaram depois do último registro: confira os documentos de novo. ${passo.texto}`;
    return {
      ...estado,
      ...passo,
      reservaId: r.id,
      codigo: r.codigo,
      imovelCodigo,
      hospede: r.hospedeNome,
      checkout: r.checkout,
      checklist: c,
      destinatarioConferido: destinatarioVigente(c, r),
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

/** Cada sequência precisa de datas em ordem: pedidos (aviso → segundo → final) e encaminhamento → entrega. */
const SEQUENCIAS: (keyof typeof CAMPO_DATA)[][] = [
  ["aviso_inicial", "segundo_pedido", "pedido_final"],
  ["encaminhado", "entrega_confirmada"],
];
const NOME_PASSO: Record<keyof typeof CAMPO_DATA, string> = {
  aviso_inicial: "do aviso inicial",
  segundo_pedido: "do segundo pedido",
  pedido_final: "do pedido final",
  encaminhado: "do encaminhamento",
  entrega_confirmada: "da entrega",
};

/** Mensagem se a data quebra a ordem da sequência (comparada com os passos já registrados). */
function foraDeOrdem(c: Checklist, tipo: keyof typeof CAMPO_DATA, data: string): string | null {
  const seq = SEQUENCIAS.find((x) => x.includes(tipo))!;
  const i = seq.indexOf(tipo);
  // Pedidos em dias diferentes (nunca dois pedidos no mesmo dia); encaminhar e entregar podem ser no mesmo dia.
  const pedidos = seq === SEQUENCIAS[0];
  for (const antes of seq.slice(0, i)) {
    const d = c[CAMPO_DATA[antes]];
    if (d && (data < d || (pedidos && data === d))) return `A data precisa ser ${pedidos ? "depois" : "no dia ou depois"} ${NOME_PASSO[antes]} (${br(d)}).`;
  }
  for (const depois of seq.slice(i + 1)) {
    const d = c[CAMPO_DATA[depois]];
    if (d && (data > d || (pedidos && data === d))) return `A data precisa ser ${pedidos ? "antes" : "no dia ou antes"} ${NOME_PASSO[depois]} (${br(d)}).`;
  }
  return null;
}

/** Mensagem se a data do pedido está fora da janela do ritmo (aviso → 5 a 7 dias antes → véspera). */
function foraDaJanela(tipo: "aviso_inicial" | "segundo_pedido" | "pedido_final", data: string, checkin: string, reservadaEm: string): string | null {
  if (tipo === "aviso_inicial") return data < checkin ? null : "O aviso inicial é antes da entrada: depois dela não há cobrança, só a pendência.";
  if (tipo === "pedido_final") return data === somaDias(checkin, -1) ? null : `O pedido final é na véspera da entrada (${br(somaDias(checkin, -1))}).`;
  if (diasEntre(reservadaEm, checkin) <= 7) return "Reserva feita a 7 dias ou menos da entrada: não tem segundo pedido.";
  const de = somaDias(checkin, -7);
  const ate = somaDias(checkin, -5);
  return data >= de && data <= ate ? null : `O segundo pedido é entre ${br(de)} e ${br(ate)} (5 a 7 dias antes da entrada).`;
}

/**
 * Datas dos pedidos que ainda valem para a entrada atual: se a reserva mudou de data depois de um
 * pedido, o que ficou fora da janela nova deixa de contar (e o passo volta a pedir).
 */
function pedidosVigentes(
  c: Pick<Checklist, "avisoInicialEm" | "segundoPedidoEm" | "pedidoFinalEm"> | null,
  checkin: string,
  reservadaEm: string,
): Pick<Checklist, "avisoInicialEm" | "segundoPedidoEm" | "pedidoFinalEm"> {
  const vale = (tipo: "aviso_inicial" | "segundo_pedido" | "pedido_final", d: string | null | undefined) => (d && !foraDaJanela(tipo, d, checkin, reservadaEm) ? d : null);
  return {
    avisoInicialEm: vale("aviso_inicial", c?.avisoInicialEm),
    segundoPedidoEm: vale("segundo_pedido", c?.segundoPedidoEm),
    pedidoFinalEm: vale("pedido_final", c?.pedidoFinalEm),
  };
}

type Envio = Pick<Checklist, "encaminhadoEm" | "entregaConfirmadaEm" | "encaminhadoCheckin" | "encaminhadoCheckout">;
const SEM_ENVIO: Envio = { encaminhadoEm: null, entregaConfirmadaEm: null, encaminhadoCheckin: null, encaminhadoCheckout: null };
type ReservaAtual = { imovelId: string; checkin: string; checkout: string; hospedeNome: string; hospedes: number | null };

/** Quem são os hóspedes da reserva (nome do titular e quantidade), para saber se mudaram. */
const referenciaHospedes = (r: ReservaAtual) => `${r.hospedeNome.trim()}|${r.hospedes ?? ""}`;

/** Os hóspedes mudaram depois do último registro? Documentos e envio eram de outra lista. */
const hospedesMudaram = (c: Pick<Checklist, "hospedesReferencia"> | null, r: ReservaAtual) =>
  Boolean(c?.hospedesReferencia && c.hospedesReferencia !== referenciaHospedes(r));

/** A lista foi mexida com a reserva em outro imóvel (portaria e destinatário são de outro prédio)? */
const outroImovel = (c: Pick<Checklist, "imovelId"> | null, r: ReservaAtual) => Boolean(c?.imovelId && c.imovelId !== r.imovelId);

/** Destinatário conferido só vale para o imóvel em que foi conferido. */
function destinatarioVigente(c: Pick<Checklist, "imovelId" | "destinatarioConferido"> | null, r: ReservaAtual): boolean {
  return Boolean(c?.destinatarioConferido) && !outroImovel(c, r);
}

/** Encaminhamento e entrega só valem para o imóvel e as datas da estada com que foram feitos. */
function envioVigente(c: (Envio & Pick<Checklist, "imovelId" | "hospedesReferencia">) | null, r: ReservaAtual): Envio {
  if (!c?.encaminhadoEm || outroImovel(c, r) || hospedesMudaram(c, r)) return SEM_ENVIO;
  if (c.encaminhadoCheckin !== r.checkin || c.encaminhadoCheckout !== r.checkout) return SEM_ENVIO;
  return { encaminhadoEm: c.encaminhadoEm, entregaConfirmadaEm: c.entregaConfirmadaEm, encaminhadoCheckin: c.encaminhadoCheckin, encaminhadoCheckout: c.encaminhadoCheckout };
}

/** Registra um passo da lista (cria a lista da reserva na primeira vez). Com trava e histórico. */
export async function registrarPortaria(db: Db, organizacaoId: string, reservaId: string, reg: Registro, hoje: string, autorId: string | null): Promise<Resultado> {
  if (!uuidValido(reservaId)) return { ok: false, erro: "Reserva não encontrada." };
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ id: reservas.id, imovelId: reservas.imovelId, hospedes: reservas.hospedes, hospedeNome: reservas.hospedeNome, estado: reservas.estado, checkin: reservas.checkin, checkout: reservas.checkout, criadoEm: reservas.criadoEm })
      .from(reservas)
      .where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)))
      .for("update");
    if (!r) return { ok: false as const, erro: "Reserva não encontrada." };
    if (r.estado !== "confirmada") return { ok: false as const, erro: "A reserva não está confirmada: a lista de portaria só vale para reservas confirmadas." };
    if (!(await imoveisComPortaria(tx, organizacaoId)).includes(r.imovelId)) return { ok: false as const, erro: "Este imóvel não exige documentos de portaria." };
    await tx.insert(portariaChecklists).values({ organizacaoId, reservaId }).onConflictDoNothing();
    const [antes] = await tx.select().from(portariaChecklists).where(eq(portariaChecklists.reservaId, reservaId)).for("update");
    // Pedidos feitos para uma entrada antiga saem (o histórico guarda as datas) e não contam na ordem.
    // Idem para o encaminhamento feito para outras datas da estada.
    // E o que foi conferido/encaminhado com a reserva em outro imóvel. A lista passa a ser deste imóvel.
    const vigentes = {
      ...pedidosVigentes(antes, r.checkin, diaDaReserva(r.criadoEm)),
      ...envioVigente(antes, r),
      destinatarioConferido: destinatarioVigente(antes, r),
      documentosRecebidos: hospedesMudaram(antes, r) ? 0 : antes.documentosRecebidos,
      imovelId: r.imovelId,
      hospedesReferencia: referenciaHospedes(r),
    };
    const atual: Checklist = { ...antes, ...vigentes };

    let novo: Partial<Checklist>;
    // Encaminhamento e entrega valem só com o destinatário conferido e os documentos completos:
    // se uma correção desfaz isso, os dois saem (o histórico guarda as datas) e o passo volta.
    const desfazEnvio = SEM_ENVIO;
    if (reg.tipo === "documentos") {
      if (!Number.isSafeInteger(reg.recebidos) || reg.recebidos < 0 || reg.recebidos > 50) return { ok: false as const, erro: "Quantidade inválida." };
      if (r.hospedes !== null && reg.recebidos > r.hospedes) return { ok: false as const, erro: `A reserva tem ${r.hospedes} hóspede(s): confira a quantidade.` };
      // Qualquer mudança na contagem depois do encaminhamento pede novo encaminhamento (e entrega).
      const mudou = reg.recebidos !== atual.documentosRecebidos && atual.encaminhadoEm !== null;
      novo = { documentosRecebidos: reg.recebidos, ...(mudou || r.hospedes === null || reg.recebidos < r.hospedes ? desfazEnvio : {}) };
    } else if (reg.tipo === "destinatario") {
      novo = { destinatarioConferido: reg.conferido, ...(reg.conferido ? {} : desfazEnvio) };
    } else if (reg.tipo === "pendencia") {
      if (reg.texto.length > 500) return { ok: false as const, erro: "Pendência longa demais (até 500 caracteres)." };
      novo = { pendencia: reg.texto.trim() };
    } else {
      if (!dataValida(reg.data) || reg.data > hoje) return { ok: false as const, erro: "Data inválida (não pode ser no futuro)." };
      if (reg.tipo === "encaminhado" || reg.tipo === "entrega_confirmada") {
        if (!atual.destinatarioConferido) return { ok: false as const, erro: "Confira o destinatário da portaria antes de encaminhar ou confirmar a entrega." };
        if (r.hospedes === null || atual.documentosRecebidos < r.hospedes) return { ok: false as const, erro: "Ainda faltam documentos (ou o número de hóspedes não está na reserva)." };
      }
      if (reg.tipo === "entrega_confirmada" && !atual.encaminhadoEm) return { ok: false as const, erro: "Registre o encaminhamento antes de confirmar a entrega." };
      if (reg.tipo === "aviso_inicial" || reg.tipo === "segundo_pedido" || reg.tipo === "pedido_final") {
        const janela = foraDaJanela(reg.tipo, reg.data, r.checkin, diaDaReserva(r.criadoEm));
        if (janela) return { ok: false as const, erro: janela };
      }
      // Segundo e pedido final só depois do aviso inicial (a sequência começa por ele).
      if ((reg.tipo === "segundo_pedido" || reg.tipo === "pedido_final") && !atual.avisoInicialEm) return { ok: false as const, erro: "Registre o aviso inicial antes dos outros pedidos." };
      const fora = foraDeOrdem(atual, reg.tipo, reg.data);
      if (fora) return { ok: false as const, erro: fora };
      novo = { [CAMPO_DATA[reg.tipo]]: reg.data };
      // O encaminhamento fica ligado às datas da estada de agora.
      if (reg.tipo === "encaminhado") novo = { ...novo, encaminhadoCheckin: r.checkin, encaminhadoCheckout: r.checkout };
    }
    const [depois] = await tx
      .update(portariaChecklists)
      .set({ ...vigentes, ...novo, atualizadoEm: new Date() })
      .where(eq(portariaChecklists.id, antes.id))
      .returning();
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: `portaria.${reg.tipo}`, entidade: "reserva", entidadeId: reservaId, mudancas: calcularMudancas(antes, depois) });
    return { ok: true as const };
  });
}
