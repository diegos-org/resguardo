import { and, asc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { emailValido } from "@/acesso/codigo-email";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { violouUnicidade } from "@/db/erros";
import { bloqueios, imoveis, reservas } from "@/db/schema";
import { aplicarMotor } from "@/financeiro/aplicar";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { hojeISO } from "@/lib/datas";
import { type DadosReserva, type ErrosReserva, gerarCodigo, validarReserva } from "./regras";

export type Reserva = typeof reservas.$inferSelect;
export type Bloqueio = typeof bloqueios.$inferSelect;

/** Contato do hóspede não vai por extenso para o histórico. */
function semContato(m: Record<string, [unknown, unknown]>) {
  for (const campo of ["hospedeEmail", "hospedeTelefone"]) if (m[campo]) m[campo] = ["(alterado)", "(alterado)"];
  return m;
}

async function imovelDaOrganizacao(tx: Db, organizacaoId: string, imovelId: string) {
  if (!uuidValido(imovelId)) return false;
  const [i] = await tx
    .select({ id: imoveis.id })
    .from(imoveis)
    .where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, organizacaoId)));
  return Boolean(i);
}

/**
 * `financeiroNaoAtualizado`: a reserva mudou, mas já tinha dinheiro movimentado, então o
 * financeiro ficou como estava (precisa de ajuste manual) — quem chamou deve avisar.
 */
export type ResultadoReserva =
  | { ok: true; reserva: Reserva; criada: boolean; alterada?: boolean; financeiroNaoAtualizado?: boolean; avisosFinanceiro?: string[] }
  | { ok: false; erros: ErrosReserva };

async function inserirComCodigo(tx: Db, valores: typeof reservas.$inferInsert): Promise<Reserva> {
  // Código aleatório: em caso raríssimo de colisão, tenta de novo.
  for (let tentativa = 0; ; tentativa++) {
    try {
      // Savepoint: se o código colidir, só esta tentativa é desfeita, não a transação toda.
      return await tx.transaction(async (sp) => {
        const [r] = await sp
          .insert(reservas)
          .values({ ...valores, codigo: gerarCodigo() })
          .returning();
        return r;
      });
    } catch (e) {
      // Só tenta de novo se colidiu o código público — qualquer outra violação sobe.
      if (!violouUnicidade(e, "reservas_codigo") || tentativa >= 3) throw e;
    }
  }
}

/** Reserva lançada à mão no painel. */
export async function criarReserva(db: Db, organizacaoId: string, dados: DadosReserva, autorId: string | null): Promise<ResultadoReserva> {
  const erros = validarReserva(dados);
  if (Object.keys(erros).length) return { ok: false, erros };
  return db.transaction(async (tx) => {
    if (!(await imovelDaOrganizacao(tx, organizacaoId, dados.imovelId))) return { ok: false as const, erros: { imovelId: "Imóvel não encontrado." } };
    const reserva = await inserirComCodigo(tx, { ...dados, organizacaoId, codigo: "", fonte: "manual", confirmadaEm: dados.estado === "confirmada" ? new Date() : null });
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "reserva.criar",
      entidade: "reserva",
      entidadeId: reserva.id,
      mudancas: semContato(calcularMudancas(null, reserva)),
    });
    await aplicarMotor(tx, organizacaoId, reserva.id, autorId);
    return { ok: true as const, reserva, criada: true };
  });
}

/**
 * Cria ou atualiza uma reserva vinda de fora (Beds24, CSV), identificada por fonte+idFonte.
 * Idempotente: rodar de novo com os mesmos dados não altera nada nem gera histórico.
 * Os lançamentos do motor de comissões são recalculados na mesma transação.
 */
/** Campos da reserva que entram no cálculo do financeiro (motor) ou na situação dela. */
const CAMPOS_DO_FINANCEIRO = ["estado", "imovelId", "checkin", "checkout", "valorBruto", "taxaCanal", "valorLiquido", "recebimento", "origem", "moeda"];

export async function sincronizarReserva(
  db: Db,
  organizacaoId: string,
  fonte: string,
  idFonte: string,
  dados: DadosReserva,
  /** Quem fez (importação por planilha); null = sistema (Beds24). */
  autorId: string | null = null,
): Promise<ResultadoReserva> {
  if (!fonte || !idFonte) return { ok: false, erros: { geral: "Fonte e id da fonte são obrigatórios." } };
  const erros = validarReserva(dados);
  if (Object.keys(erros).length) return { ok: false, erros };
  return db.transaction(async (tx) => {
    if (!(await imovelDaOrganizacao(tx, organizacaoId, dados.imovelId))) return { ok: false as const, erros: { imovelId: "Imóvel não encontrado." } };
    // CSV e Beds24 podem ter IDs distintos para a mesma reserva. Serializar as
    // importações da organização impede duas fontes de criarem a mesma reserva juntas.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`reservas-importacao:${organizacaoId}`}))`);
    let [existente] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.organizacaoId, organizacaoId), or(
        and(eq(reservas.fonte, fonte), eq(reservas.idFonte, idFonte)),
        fonte === "beds24" ? eq(reservas.beds24Id, idFonte) : undefined,
      )))
      .for("update");

    if (!existente && (fonte === "beds24" || fonte === "csv") && dados.codigoCanal && ["airbnb", "booking"].includes(dados.origem)) {
      const candidatas = await tx.select().from(reservas).where(and(
        eq(reservas.organizacaoId, organizacaoId), eq(reservas.origem, dados.origem),
        eq(reservas.codigoCanal, dados.codigoCanal), inArray(reservas.fonte, ["csv", "beds24"]),
      )).for("update");
      if (candidatas.length > 1) return { ok: false as const, erros: { geral: "Mais de uma reserva com esse canal e código. Confira a duplicidade antes de sincronizar." } };
      existente = candidatas[0];
      if (existente && existente.imovelId !== dados.imovelId) return { ok: false as const, erros: { geral: "O código do canal já existe em outro imóvel. Confira o mapeamento." } };
    }
    if (fonte === "csv" && existente && (existente.beds24Id || existente.fonte === "beds24")) {
      return { ok: false as const, erros: { geral: "Esta reserva já é atualizada pelo Beds24. A planilha não substituiu os dados sincronizados." } };
    }
    if (fonte === "beds24" && existente && ((existente.beds24Id && existente.beds24Id !== idFonte) || (existente.fonte === "beds24" && existente.idFonte !== idFonte))) {
      return { ok: false as const, erros: { geral: "Dois IDs do Beds24 usam o mesmo código de reserva no canal. Confira no Beds24." } };
    }
    // Conserva a origem CSV e seu identificador; guarda também o ID do Beds24.
    // Assim referências, lançamentos, códigos públicos e histórico continuam os mesmos.
    const vinculo = fonte === "beds24" ? { beds24Id: idFonte } : {};
    if (existente && fonte === "beds24") {
      dados = { ...dados, observacoes: existente.observacoes, hospedeOrigem: existente.hospedeOrigem };
      // Escopos limitados da API podem omitir contato/valores. Ausência não apaga
      // informação já conferida/importada, nem transforma valor desconhecido em zero.
      dados.hospedeNome ||= existente.hospedeNome;
      dados.hospedeEmail ||= existente.hospedeEmail;
      dados.hospedeTelefone ||= existente.hospedeTelefone;
      dados.valorBruto ??= existente.valorBruto;
      dados.taxaCanal ??= existente.taxaCanal;
      dados.valorLiquido = dados.valorBruto === existente.valorBruto && dados.taxaCanal === existente.taxaCanal ? existente.valorLiquido : null;
      dados.codigoCanal ||= existente.codigoCanal;
      dados.hospedes ??= existente.hospedes;
    }

    if (!existente) {
      const canceladaEm = dados.estado === "cancelada" ? new Date() : null;
      const reserva = await inserirComCodigo(tx, { ...dados, ...vinculo, organizacaoId, codigo: "", fonte, idFonte, canceladaEm, confirmadaEm: dados.estado === "confirmada" && fonte !== "beds24" ? new Date() : null });
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autorId,
        acao: "reserva.importar",
        entidade: "reserva",
        entidadeId: reserva.id,
        mudancas: semContato(calcularMudancas(null, reserva)),
      });
      const m = await aplicarMotor(tx, organizacaoId, reserva.id, autorId);
      return { ok: true as const, reserva, criada: true, avisosFinanceiro: m?.avisos };
    }

    // E-mail corrigido à mão no painel vale sobre o da fonte (M9.1).
    if (existente.hospedeEmailManualEm) dados = { ...dados, hospedeEmail: existente.hospedeEmail };
    const novo = { ...existente, ...dados, ...vinculo };
    const mudancas = calcularMudancas(existente, novo);
    const preservarPassado = fonte === "beds24" && existente.checkin < hojeISO();
    const avisoPassado = preservarPassado && CAMPOS_DO_FINANCEIRO.some(c => c in mudancas)
      ? ["Reserva já iniciada: o financeiro anterior foi preservado. Confira se é necessário um ajuste manual."] : [];
    if (Object.keys(mudancas).length === 0) {
      // Reserva igual: o financeiro só muda se o contrato mudou (idempotente).
      const m = await aplicarMotor(tx, organizacaoId, existente.id, autorId, undefined, { soConferir: preservarPassado });
      return { ok: true as const, reserva: existente, criada: false, financeiroNaoAtualizado: m?.protegido, avisosFinanceiro: m?.avisos };
    }
    // Cancelou agora → data de agora; continua cancelada → mantém; voltou a valer → limpa.
    const canceladaEm = dados.estado !== "cancelada" ? null : existente.estado === "cancelada" ? existente.canceladaEm : new Date();
    // Passou a confirmada agora → data de agora; continua confirmada → mantém; deixou de ser → limpa.
    const confirmadaEm = dados.estado !== "confirmada" ? null : existente.estado === "confirmada" ? existente.confirmadaEm : fonte === "beds24" ? null : new Date();
    const [reserva] = await tx
      .update(reservas)
      // Mudou algo que pesa no financeiro (situação, valores, datas, imóvel, canal…): uma conferência
      // dada por resolvida antes volta a valer (M4.8) — a decisão foi tomada sobre os dados de antes.
      // Nome, contato ou observação do hóspede não reabrem.
      .set({ ...dados, ...vinculo, canceladaEm, confirmadaEm, conferenciaResolvidaEm: CAMPOS_DO_FINANCEIRO.some((c) => c in mudancas) ? null : existente.conferenciaResolvidaEm, atualizadoEm: new Date() })
      .where(eq(reservas.id, existente.id))
      .returning();
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "reserva.sincronizar",
      entidade: "reserva",
      entidadeId: reserva.id,
      mudancas: semContato(mudancas),
    });
    const m = await aplicarMotor(tx, organizacaoId, reserva.id, autorId, undefined, { soConferir: preservarPassado });
    return { ok: true as const, reserva, criada: false, alterada: true, financeiroNaoAtualizado: m?.protegido, avisosFinanceiro: [...(m?.avisos ?? []), ...avisoPassado] };
  });
}

/**
 * E-mail do hóspede (M9.1): é por ele que o hóspede entra no portal. Corrigir aqui tira o acesso
 * do e-mail antigo na hora e vale sobre o que vier da planilha ou do Beds24 depois.
 * Vazio = sem acesso ao portal (o detalhe da reserva avisa).
 */
export async function salvarEmailHospede(
  db: Db,
  organizacaoId: string,
  id: string,
  emailBruto: string,
  autorId: string | null,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const email = emailBruto.trim().toLowerCase();
  if (email && !emailValido(email)) return { ok: false, erro: "E-mail inválido." };
  if (!uuidValido(id)) return { ok: false, erro: "Reserva não encontrada." };
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ hospedeEmail: reservas.hospedeEmail })
      .from(reservas)
      .where(and(eq(reservas.id, id), eq(reservas.organizacaoId, organizacaoId)))
      .for("update");
    if (!r) return { ok: false as const, erro: "Reserva não encontrada." };
    const agora = new Date();
    // Mesmo sem mudar o valor, fica marcado como conferido à mão: a sincronização não troca mais.
    await tx.update(reservas).set({ hospedeEmail: email, hospedeEmailManualEm: agora, atualizadoEm: agora }).where(eq(reservas.id, id));
    if (r.hospedeEmail === email) return { ok: true as const };
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "reserva.email_hospede",
      entidade: "reserva",
      entidadeId: id,
      mudancas: semContato({ hospedeEmail: [r.hospedeEmail, email] }),
    });
    return { ok: true as const };
  });
}

export async function cancelarReserva(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<boolean> {
  if (!uuidValido(id)) return false;
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.id, id), eq(reservas.organizacaoId, organizacaoId)))
      .for("update");
    if (!r || r.estado === "cancelada") return false;
    await tx.update(reservas).set({ estado: "cancelada", canceladaEm: new Date(), confirmadaEm: null, conferenciaResolvidaEm: null, atualizadoEm: new Date() }).where(eq(reservas.id, id));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "reserva.cancelar",
      entidade: "reserva",
      entidadeId: id,
      mudancas: { estado: [r.estado, "cancelada"] },
    });
    await aplicarMotor(tx, organizacaoId, id, autorId);
    return true;
  });
}

class ConfirmacaoRecusada extends Error {}

/**
 * Confirma uma reserva pendente (feita no painel ou vinda de fora): a partir daí entra no financeiro.
 * Se ela já movimentou dinheiro e o cálculo novo não bate com o que ficou no livro (o motor não mexe
 * nisso), não confirma: a conferência continua até o ajuste manual (avisar em vez de supor).
 */
export async function confirmarReserva(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<{ ok: boolean; aviso?: string }> {
  if (!uuidValido(id)) return { ok: false };
  try {
    return await confirmarNaTransacao(db, organizacaoId, id, autorId);
  } catch (e) {
    if (e instanceof ConfirmacaoRecusada) return { ok: false, aviso: e.message };
    throw e;
  }
}

async function confirmarNaTransacao(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<{ ok: boolean }> {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.id, id), eq(reservas.organizacaoId, organizacaoId)))
      .for("update");
    if (!r || r.estado !== "pendente") return { ok: false };
    await tx.update(reservas).set({ estado: "confirmada", confirmadaEm: new Date(), conferenciaResolvidaEm: null, atualizadoEm: new Date() }).where(eq(reservas.id, id));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "reserva.confirmar",
      entidade: "reserva",
      entidadeId: id,
      mudancas: { estado: ["pendente", "confirmada"] },
    });
    const m = await aplicarMotor(tx, organizacaoId, id, autorId);
    // Desfaz tudo (a reserva continua pendente, em conferência).
    if (m?.protegido)
      throw new ConfirmacaoRecusada(
        "Não confirmada: esta reserva já movimentou dinheiro e os valores atuais não batem com o que está no financeiro. Faça o ajuste manual e dê a conferência por resolvida.",
      );
    return { ok: true };
  });
}

/**
 * Dá por resolvida a conferência de uma reserva não confirmada que já movimentou dinheiro (M4.8),
 * depois do ajuste manual: os lançamentos dela deixam de travar o fechamento do mês. Só vale para
 * reserva não confirmada; se a situação mudar de novo, a conferência volta.
 */
export async function resolverConferencia(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<boolean> {
  if (!uuidValido(id)) return false;
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.id, id), eq(reservas.organizacaoId, organizacaoId)))
      .for("update");
    if (!r || (r.estado === "confirmada" && !r.divergenciaEm) || r.conferenciaResolvidaEm) return false;
    const agora = new Date();
    await tx.update(reservas).set({ conferenciaResolvidaEm: agora, atualizadoEm: agora }).where(eq(reservas.id, id));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "reserva.conferencia_resolvida",
      entidade: "reserva",
      entidadeId: id,
      mudancas: { conferenciaResolvidaEm: [null, agora.toISOString()] },
    });
    return true;
  });
}

export async function obterReserva(db: Db, organizacaoId: string, id: string): Promise<Reserva | null> {
  if (!uuidValido(id)) return null;
  const [r] = await db
    .select()
    .from(reservas)
    .where(and(eq(reservas.id, id), eq(reservas.organizacaoId, organizacaoId)));
  return r ?? null;
}

export type FiltroPeriodo = { inicio: string; fim: string; imovelIds?: string[]; incluirCanceladas?: boolean };

/** Reservas que ocupam algum dia de [inicio, fim), ordenadas por check-in. */
export async function listarReservas(db: Db, organizacaoId: string, f: FiltroPeriodo): Promise<Reserva[]> {
  const condicoes = [eq(reservas.organizacaoId, organizacaoId), lt(reservas.checkin, f.fim), gt(reservas.checkout, f.inicio)];
  if (f.imovelIds?.length) condicoes.push(inArray(reservas.imovelId, f.imovelIds.filter(uuidValido)));
  if (!f.incluirCanceladas) condicoes.push(ne(reservas.estado, "cancelada"));
  return db
    .select()
    .from(reservas)
    .where(and(...condicoes))
    .orderBy(asc(reservas.checkin), asc(reservas.codigo));
}

export async function listarBloqueios(db: Db, organizacaoId: string, f: FiltroPeriodo): Promise<Bloqueio[]> {
  const condicoes = [eq(bloqueios.organizacaoId, organizacaoId), lt(bloqueios.inicio, f.fim), gt(bloqueios.fim, f.inicio)];
  if (f.imovelIds?.length) condicoes.push(inArray(bloqueios.imovelId, f.imovelIds.filter(uuidValido)));
  return db
    .select()
    .from(bloqueios)
    .where(and(...condicoes))
    .orderBy(asc(bloqueios.inicio));
}

