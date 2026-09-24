/**
 * Ajustes e divergências (M4.5). Regras de Diego (21/09): ao achar uma diferença, registrar
 * no mesmo dia, ligada à reserva/imóvel, com a evidência consultada. Se o motivo continuar
 * desconhecido, usar a descrição genérica verdadeira "Ajuste de reserva — motivo não
 * identificado" — e "feito pelo Airbnb" só se a origem estiver comprovada. Valor desconhecido
 * não é inventado: fica sem lançamento até alguém completar. Texto genérico não é
 * conciliação: o ajuste fica PENDENTE até ser esclarecido (motivo e valor conhecidos).
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { ajustes, imoveis, ORIGENS_AJUSTE, type OrigemAjuste, proprietarioImoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { estornar, lancar, mudarEstado } from "@/financeiro/ledger";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";

/** Limite das colunas integer do Postgres (≈ R$ 21 milhões). */
const CENTAVOS_MAXIMO = 2_147_483_647;

export const NOMES_ORIGEM_AJUSTE: Record<OrigemAjuste, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  site: "Site",
  banco: "Banco",
  mercado_pago: "Mercado Pago",
  proprietario: "Proprietário",
  empresa: "Empresa",
  outra: "Outra",
  desconhecida: "Desconhecida",
};

/** Direção do dinheiro, em linguagem simples. O sinal é derivado daqui. */
export const DIRECOES = {
  empresa_entrada: { afeta: "empresa", sinal: 1, texto: "Entrou dinheiro a mais para a empresa" },
  empresa_saida: { afeta: "empresa", sinal: -1, texto: "Saiu dinheiro / entrou a menos para a empresa" },
  proprietario_credito: { afeta: "proprietario", sinal: 1, texto: "A empresa deve ao proprietário" },
  proprietario_debito: { afeta: "proprietario", sinal: -1, texto: "O proprietário deve à empresa" },
} as const;
export type Direcao = keyof typeof DIRECOES;

export type Ajuste = typeof ajustes.$inferSelect & { reservaCodigo: string | null; imovelCodigo: string | null };

export type DadosAjuste = {
  data: string;
  imovelId: string | null;
  reservaId: string | null;
  proprietarioId: string | null;
  motivo: string;
  origem: OrigemAjuste;
  origemComprovada: boolean;
  evidencia: string;
  comprovante: string;
  /** Centavos, positivo; null = ainda não se sabe. */
  valor: number | null;
  direcao: Direcao;
};
export type ErrosAjuste = Partial<Record<keyof DadosAjuste | "geral", string>>;

const MOTIVO_GENERICO_RESERVA = "Ajuste de reserva — motivo não identificado";
const MOTIVO_GENERICO = "Ajuste — motivo não identificado";

/** Descrição verdadeira: genérica sem motivo; origem citada só se comprovada. */
export function descricaoAjuste(a: { motivo: string; origem: OrigemAjuste; origemComprovada: boolean; reservaCodigo?: string | null }): string {
  const base = a.motivo.trim()
    ? `Ajuste${a.reservaCodigo ? ` da reserva ${a.reservaCodigo}` : ""}: ${a.motivo.trim()}`
    : a.reservaCodigo
      ? `${MOTIVO_GENERICO_RESERVA} (${a.reservaCodigo})`
      : MOTIVO_GENERICO;
  const origem = a.origemComprovada && a.origem !== "desconhecida" ? ` — feito por ${NOMES_ORIGEM_AJUSTE[a.origem]}` : "";
  return `${base}${origem}`.slice(0, 300);
}

export function lerFormAjuste(e: Record<string, unknown>): { ok: true; dados: DadosAjuste } | { ok: false; erros: ErrosAjuste } {
  const txt = (k: string) => (typeof e[k] === "string" ? (e[k] as string).trim() : "");
  const erros: ErrosAjuste = {};
  const valorTxt = txt("valor");
  const valor = reaisParaCentavos(valorTxt);
  if (valor === undefined || (valor !== null && (valor <= 0 || valor > CENTAVOS_MAXIMO))) erros.valor = "Valor inválido (ex.: 150,00). Deixe em branco se ainda não souber.";
  const origem = (txt("origem") || "desconhecida") as OrigemAjuste;
  if (!ORIGENS_AJUSTE.includes(origem)) erros.origem = "Origem inválida.";
  const direcao = txt("direcao") as Direcao;
  if (!Object.hasOwn(DIRECOES, direcao)) erros.direcao = "Escolha o efeito do ajuste.";
  const id = (k: string) => (txt(k) === "" ? null : txt(k));
  const dados: DadosAjuste = {
    data: txt("data"),
    imovelId: id("imovelId"),
    reservaId: id("reservaId"),
    proprietarioId: id("proprietarioId"),
    motivo: txt("motivo"),
    origem,
    origemComprovada: e.origemComprovada === "on" || e.origemComprovada === true,
    evidencia: txt("evidencia"),
    comprovante: txt("comprovante"),
    valor: valor ?? null,
    direcao,
  };
  if (!dataValida(dados.data)) erros.data = "Data inválida.";
  for (const k of ["imovelId", "reservaId", "proprietarioId"] as const) if (dados[k] && !uuidValido(dados[k])) erros[k] = "Referência inválida.";
  if (dados.motivo.length > 500) erros.motivo = "Até 500 caracteres.";
  if (dados.evidencia.length > 2000) erros.evidencia = "Até 2000 caracteres.";
  if (dados.comprovante.length > 500) erros.comprovante = "Até 500 caracteres.";
  if (dados.origemComprovada && dados.origem === "desconhecida") erros.origemComprovada = "Origem desconhecida não pode estar comprovada.";
  if (!dados.evidencia) erros.evidencia = "Diga o que foi consultado (extrato, painel do canal, conversa…).";
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, dados };
}

type Vinculos = { imovelId: string | null; reservaId: string | null; proprietarioId: string | null; reservaCodigo: string | null };

/** Confere reserva/imóvel/proprietário na organização; a reserva define o imóvel. */
async function resolverVinculos(tx: Db, org: string, d: DadosAjuste): Promise<Vinculos | ErrosAjuste> {
  let imovelId = d.imovelId;
  let reservaCodigo: string | null = null;
  if (d.reservaId) {
    const [r] = await tx
      .select({ imovelId: reservas.imovelId, codigo: reservas.codigo })
      .from(reservas)
      .where(and(eq(reservas.id, d.reservaId), eq(reservas.organizacaoId, org)));
    if (!r) return { reservaId: "Reserva não encontrada." };
    if (imovelId && imovelId !== r.imovelId) return { imovelId: "A reserva é de outro imóvel." };
    imovelId = r.imovelId;
    reservaCodigo = r.codigo;
  }
  if (imovelId) {
    const [im] = await tx
      .select({ id: imoveis.id })
      .from(imoveis)
      .where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, org)));
    if (!im) return { imovelId: "Imóvel não encontrado." };
  }
  let proprietarioId = d.proprietarioId;
  if (DIRECOES[d.direcao].afeta === "proprietario") {
    if (!imovelId) return { imovelId: "Ajuste com o proprietário precisa do imóvel (ou da reserva)." };
    const donos = (await tx.select({ id: proprietarioImoveis.proprietarioId }).from(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, imovelId))).map((x) => x.id);
    if (proprietarioId && !donos.includes(proprietarioId)) return { proprietarioId: "Proprietário não vinculado ao imóvel." };
    if (!proprietarioId) {
      if (donos.length !== 1) return { proprietarioId: donos.length ? "Escolha o proprietário." : "O imóvel não tem proprietário: cadastre antes." };
      proprietarioId = donos[0];
    }
  } else {
    proprietarioId = null;
  }
  return { imovelId, reservaId: d.reservaId, proprietarioId, reservaCodigo };
}

const ehErro = (v: Vinculos | ErrosAjuste): v is ErrosAjuste => !("reservaCodigo" in v);

/** Lança (ou relança) o valor no livro. Sem valor: nenhum lançamento. */
async function lancarAjuste(tx: Db, org: string, a: typeof ajustes.$inferSelect, reservaCodigo: string | null, autorId: string | null): Promise<string | null> {
  if (a.valor === null) return null;
  const empresa = a.afeta === "empresa";
  const [l] = await lancar(
    tx,
    org,
    [
      {
        tipo: "ajuste",
        descricao: descricaoAjuste({ ...a, reservaCodigo }),
        valor: empresa ? a.valor : 0,
        efeitoSaldo: empresa ? 0 : a.valor,
        montante: Math.abs(a.valor),
        competencia: a.data,
        estado: a.esclarecidoEm ? "realizado" : "pendente",
        imovelId: a.imovelId,
        proprietarioId: a.proprietarioId,
        reservaId: a.reservaId,
        comprovante: a.comprovante,
        origem: "ajuste",
      },
    ],
    autorId,
  );
  return l.id;
}

export type ResultadoAjuste = { ok: true; id: string } | { ok: false; erros: ErrosAjuste };

export async function registrarAjuste(db: Db, org: string, d: DadosAjuste, autorId: string | null): Promise<ResultadoAjuste> {
  return db.transaction(async (tx) => {
    const v = await resolverVinculos(tx, org, d);
    if (ehErro(v)) return { ok: false as const, erros: v };
    const sinal = DIRECOES[d.direcao].sinal;
    const [a] = await tx
      .insert(ajustes)
      .values({
        organizacaoId: org,
        data: d.data,
        imovelId: v.imovelId,
        reservaId: v.reservaId,
        proprietarioId: v.proprietarioId,
        motivo: d.motivo,
        origem: d.origem,
        origemComprovada: d.origemComprovada,
        evidencia: d.evidencia,
        comprovante: d.comprovante,
        valor: d.valor === null ? null : sinal * d.valor,
        afeta: DIRECOES[d.direcao].afeta,
        criadoPor: autorId,
      })
      .returning();
    const lancamentoId = await lancarAjuste(tx, org, a, v.reservaCodigo, autorId);
    if (lancamentoId) await tx.update(ajustes).set({ lancamentoId }).where(eq(ajustes.id, a.id));
    await registrarAuditoria(tx, {
      organizacaoId: org,
      usuarioId: autorId,
      acao: "ajuste.registrar",
      entidade: "ajuste",
      entidadeId: a.id,
      mudancas: { descricao: [null, descricaoAjuste({ ...a, reservaCodigo: v.reservaCodigo })], valor: [null, a.valor ?? "desconhecido"] },
    });
    return { ok: true as const, id: a.id };
  });
}

/**
 * Completa um ajuste ainda pendente (motivo, origem, evidência, valor…). Se o que vai para o
 * livro mudou (valor, efeito, descrição), estorna o lançamento anterior e lança o novo.
 */
export async function complementarAjuste(db: Db, org: string, id: string, d: DadosAjuste, autorId: string | null): Promise<ResultadoAjuste> {
  if (!uuidValido(id)) return { ok: false, erros: { geral: "Ajuste não encontrado." } };
  return db.transaction(async (tx) => {
    const [antes] = await tx
      .select()
      .from(ajustes)
      .where(and(eq(ajustes.id, id), eq(ajustes.organizacaoId, org)))
      .for("update");
    if (!antes) return { ok: false as const, erros: { geral: "Ajuste não encontrado." } };
    if (antes.esclarecidoEm) return { ok: false as const, erros: { geral: "Ajuste já esclarecido: não muda mais. Se precisar, registre outro ajuste." } };
    const v = await resolverVinculos(tx, org, d);
    if (ehErro(v)) return { ok: false as const, erros: v };
    const sinal = DIRECOES[d.direcao].sinal;
    const novo = {
      data: d.data,
      imovelId: v.imovelId,
      reservaId: v.reservaId,
      proprietarioId: v.proprietarioId,
      motivo: d.motivo,
      origem: d.origem,
      origemComprovada: d.origemComprovada,
      evidencia: d.evidencia,
      comprovante: d.comprovante,
      valor: d.valor === null ? null : sinal * d.valor,
      afeta: DIRECOES[d.direcao].afeta,
    };
    const mudancas = calcularMudancas(antes, { ...antes, ...novo });
    if (!Object.keys(mudancas).length) return { ok: true as const, id };
    const [depois] = await tx
      .update(ajustes)
      .set({ ...novo, atualizadoEm: new Date() })
      .where(eq(ajustes.id, id))
      .returning();
    const noLivro = (x: typeof antes, codigo: string | null) =>
      JSON.stringify([x.valor, x.afeta, x.data, x.imovelId, x.reservaId, x.proprietarioId, x.comprovante, descricaoAjuste({ ...x, reservaCodigo: codigo })]);
    const codigoAntes = antes.reservaId ? ((await tx.select({ c: reservas.codigo }).from(reservas).where(eq(reservas.id, antes.reservaId)))[0]?.c ?? null) : null;
    if (noLivro(antes, codigoAntes) !== noLivro(depois, v.reservaCodigo)) {
      if (antes.lancamentoId) await estornar(tx, org, antes.lancamentoId, "Ajuste complementado", autorId);
      const lancamentoId = await lancarAjuste(tx, org, depois, v.reservaCodigo, autorId);
      await tx.update(ajustes).set({ lancamentoId }).where(eq(ajustes.id, id));
    }
    await registrarAuditoria(tx, { organizacaoId: org, usuarioId: autorId, acao: "ajuste.complementar", entidade: "ajuste", entidadeId: id, mudancas });
    return { ok: true as const, id };
  });
}

/** Esclarece: só com motivo e valor conhecidos. O lançamento sai de "pendente". */
export async function esclarecerAjuste(db: Db, org: string, id: string, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!uuidValido(id)) return { ok: false, erro: "Ajuste não encontrado." };
  return db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(ajustes)
      .where(and(eq(ajustes.id, id), eq(ajustes.organizacaoId, org)))
      .for("update");
    if (!a) return { ok: false as const, erro: "Ajuste não encontrado." };
    if (a.esclarecidoEm) return { ok: false as const, erro: "Já esclarecido." };
    if (!a.motivo.trim()) return { ok: false as const, erro: "Sem motivo conhecido, o ajuste continua pendente (texto genérico não esclarece a divergência)." };
    if (a.valor === null || !a.lancamentoId) return { ok: false as const, erro: "Informe o valor antes de esclarecer." };
    await mudarEstado(tx, org, a.lancamentoId, "realizado", autorId);
    await tx.update(ajustes).set({ esclarecidoEm: new Date(), atualizadoEm: new Date() }).where(eq(ajustes.id, id));
    await registrarAuditoria(tx, { organizacaoId: org, usuarioId: autorId, acao: "ajuste.esclarecer", entidade: "ajuste", entidadeId: id, mudancas: { situacao: ["pendente", "esclarecido"] } });
    return { ok: true as const };
  });
}

export async function listarAjustes(db: Db, org: string, f: { pendentes?: boolean; id?: string } = {}): Promise<Ajuste[]> {
  const c = [eq(ajustes.organizacaoId, org)];
  if (f.pendentes) c.push(isNull(ajustes.esclarecidoEm));
  if (f.id) c.push(eq(ajustes.id, f.id));
  const linhas = await db
    .select({ a: ajustes, reservaCodigo: reservas.codigo, imovelCodigo: imoveis.codigo })
    .from(ajustes)
    .leftJoin(reservas, eq(reservas.id, ajustes.reservaId))
    .leftJoin(imoveis, eq(imoveis.id, ajustes.imovelId))
    .where(and(...c))
    .orderBy(sql`${ajustes.esclarecidoEm} is not null`, desc(ajustes.data), desc(ajustes.criadoEm));
  return linhas.map((x) => ({ ...x.a, reservaCodigo: x.reservaCodigo, imovelCodigo: x.imovelCodigo }));
}

export async function obterAjuste(db: Db, org: string, id: string): Promise<Ajuste | null> {
  if (!uuidValido(id)) return null;
  return (await listarAjustes(db, org, { id }))[0] ?? null;
}

/** Direção a partir do que está gravado (para preencher o formulário). */
export function direcaoDe(a: { afeta: string; valor: number | null }): Direcao {
  const negativo = (a.valor ?? 0) < 0;
  return a.afeta === "proprietario" ? (negativo ? "proprietario_debito" : "proprietario_credito") : negativo ? "empresa_saida" : "empresa_entrada";
}
