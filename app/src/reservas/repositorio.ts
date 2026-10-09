import { and, asc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { emailValido } from "@/acesso/codigo-email";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { violouUnicidade } from "@/db/erros";
import { bloqueios, imoveis, reservas, cotacoes } from "@/db/schema";
import { aplicarMotor } from "@/financeiro/aplicar";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { hojeISO } from "@/lib/datas";
import { pagamentoEmAndamentoOuAprovado, type PagamentoQuePrende, pagamentoSemReservaADevolver } from "@/pagamentos/andamento";
import { chavesDaImportacao } from "./travas-importacao";
import { type DadosReserva, type ErrosReserva, gerarCodigo, validarReserva } from "./regras";

export type Reserva = typeof reservas.$inferSelect;
export type Bloqueio = typeof bloqueios.$inferSelect;

/** Contato do hóspede não vai por extenso para o histórico. */
function semContato(m: Record<string, [unknown, unknown]>) {
  for (const campo of ["hospedeEmail", "hospedeTelefone"]) if (m[campo]) m[campo] = ["(alterado)", "(alterado)"];
  return m;
}

/**
 * Confere o imóvel e o trava para a ocupação (NO KEY UPDATE, até o fim da transação): toda escrita que ocupa noites
 * (reserva lançada no painel, importada do Beds24 ou da planilha, confirmação do pagamento do site) passa pela mesma
 * trava do imóvel que o pagamento do site toma antes de conferir se as noites estão livres (pagamentos/travas.ts).
 * Assim uma importação que cai nas mesmas noites espera a confirmação (ou a confirmação espera ela) e a conferência
 * vê a outra. NO KEY UPDATE não bloqueia as chaves estrangeiras de quem grava lançamentos do imóvel. É a primeira
 * trava de quem chama (antes das travas por identidade e da reserva), na mesma ordem do pagamento.
 */
async function imovelDaOrganizacao(tx: Db, organizacaoId: string, imovelId: string) {
  if (!uuidValido(imovelId)) return false;
  const [i] = await tx
    .select({ id: imoveis.id })
    .from(imoveis)
    .where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, organizacaoId)))
    .for("no key update");
  return Boolean(i);
}

/**
 * `financeiroNaoAtualizado`: a reserva mudou, mas já tinha dinheiro movimentado, então o
 * financeiro ficou como estava (precisa de ajuste manual) — quem chamou deve avisar.
 * `canceladaAgora`: a sincronização mudou o estado de uma reserva existente para cancelada,
 * comparando o registro anterior dentro da transação, com o bloqueio de linha.
 */
export type ResultadoReserva =
  | { ok: true; reserva: Reserva; criada: boolean; alterada?: boolean; canceladaAgora?: boolean; financeiroNaoAtualizado?: boolean; avisosFinanceiro?: string[] }
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
  /** Relógio das datas de confirmação/cancelamento (o pagamento do site passa o seu). */
  agora: Date = new Date(),
): Promise<ResultadoReserva> {
  if (!fonte || !idFonte) return { ok: false, erros: { geral: "Fonte e id da fonte são obrigatórios." } };
  const erros = validarReserva(dados);
  if (Object.keys(erros).length) return { ok: false, erros };
  return db.transaction(async (tx) => {
    if (!(await imovelDaOrganizacao(tx, organizacaoId, dados.imovelId))) return { ok: false as const, erros: { imovelId: "Imóvel não encontrado." } };
    // Serializa somente identidades que podem representar a mesma reserva.
    // CSV e Beds24 compartilham a chave canal/código; reservas independentes
    // continuam em paralelo. A ordem estável evita inversão entre as travas.
    for (const chave of chavesDaImportacao(organizacaoId, fonte, idFonte, dados)) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chave}))`);
    }
    // NO KEY UPDATE: serializa quem muda a mesma reserva sem bloquear a conferência das chaves estrangeiras de quem
    // grava lançamentos ou itens de repasse dela (a confirmação do pagamento do site chega aqui com a reserva já
    // travada assim — um FOR UPDATE subiria a trava; ver pagamentos/travas.ts). O UPDATE abaixo, quando muda o id do
    // Beds24 (chave única), sobe sozinho para FOR UPDATE.
    let [existente] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.organizacaoId, organizacaoId), or(
        and(eq(reservas.fonte, fonte), eq(reservas.idFonte, idFonte)),
        fonte === "beds24" ? eq(reservas.beds24Id, idFonte) : undefined,
      )))
      .for("no key update");

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
      dados.reservadaEm ??= existente.reservadaEm;
    }

    if (!existente) {
      const canceladaEm = dados.estado === "cancelada" ? agora : null;
      const reserva = await inserirComCodigo(tx, { ...dados, ...vinculo, organizacaoId, codigo: "", fonte, idFonte, canceladaEm, confirmadaEm: dados.estado === "confirmada" && fonte !== "beds24" ? agora : null });
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
    const canceladaEm = dados.estado !== "cancelada" ? null : existente.estado === "cancelada" ? existente.canceladaEm : agora;
    // Passou a confirmada agora → data de agora; continua confirmada → mantém; deixou de ser → limpa.
    const confirmadaEm = dados.estado !== "confirmada" ? null : existente.estado === "confirmada" ? existente.confirmadaEm : fonte === "beds24" ? null : agora;
    const [reserva] = await tx
      .update(reservas)
      // Mudou algo que pesa no financeiro (situação, valores, datas, imóvel, canal…): uma conferência
      // dada por resolvida antes volta a valer (M4.8) — a decisão foi tomada sobre os dados de antes.
      // Nome, contato ou observação do hóspede não reabrem.
      .set({ ...dados, ...vinculo, canceladaEm, confirmadaEm, conferenciaResolvidaEm: CAMPOS_DO_FINANCEIRO.some((c) => c in mudancas) ? null : existente.conferenciaResolvidaEm, atualizadoEm: agora })
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
    return { ok: true as const, reserva, criada: false, alterada: true, canceladaAgora: existente.estado !== "cancelada" && reserva.estado === "cancelada", financeiroNaoAtualizado: m?.protegido, avisosFinanceiro: [...(m?.avisos ?? []), ...avisoPassado] };
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

const horaBr = (d: Date, fuso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" }).format(d);

/** Por que a equipe não mexe à mão num pedido com pagamento do site (M8.2a). */
function avisoDoPagamento(p: PagamentoQuePrende, fuso: string, acao: "cancelar" | "confirmar"): string {
  if (p.situacao === "criando" || p.situacao === "incerta" || p.situacao === "pendente") {
    const ate = p.forma === "pix" && p.pixExpiraEm ? ` até ${horaBr(p.pixExpiraEm, fuso)}` : "";
    return acao === "confirmar"
      ? `Não confirmada: há um ${p.forma === "pix" ? "Pix" : "pagamento"} em andamento${ate}. Aguarde o pagamento (ou o prazo dele) antes de confirmar à mão.`
      : `Não cancelada: há um ${p.forma === "pix" ? "Pix" : "pagamento"} do site em andamento${ate}. Aguarde o prazo dele; o cancelamento com devolução chega no M8.2c.`;
  }
  return acao === "confirmar"
    ? "Não confirmada: há um pagamento do site aprovado sendo processado. Atualize a página em instantes."
    : "Não cancelada: esta reserva tem pagamento aprovado pelo site. O cancelamento com devolução chega no M8.2c.";
}

/**
 * Cancela a reserva. Recusa (com o motivo em `aviso`) quando há pagamento do site em andamento ou aprovado
 * (M8.2a: o cancelamento com devolução é o M8.2c) — salvo `vencimento`, o pedido que vence sozinho pela rotina,
 * que já respeitou a carência.
 */
export async function tentarCancelarReserva(
  db: Db,
  organizacaoId: string,
  id: string,
  autorId: string | null,
  o: { vencimento?: boolean; agora?: Date } = {},
): Promise<{ ok: boolean; aviso?: string }> {
  if (!uuidValido(id)) return { ok: false };
  const agora = o.agora ?? new Date();
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.id, id), eq(reservas.organizacaoId, organizacaoId)))
      .for("update");
    if (!r || r.estado === "cancelada") return { ok: false };
    if (!o.vencimento) {
      const p = await pagamentoEmAndamentoOuAprovado(tx, r.id);
      if (p) {
        const [im] = await tx.select({ fuso: imoveis.fuso }).from(imoveis).where(eq(imoveis.id, r.imovelId));
        return { ok: false, aviso: avisoDoPagamento(p, im?.fuso ?? "America/Sao_Paulo", "cancelar") };
      }
    }
    await tx.update(reservas).set({ estado: "cancelada", canceladaEm: agora, confirmadaEm: null, conferenciaResolvidaEm: null, atualizadoEm: agora }).where(eq(reservas.id, id));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "reserva.cancelar",
      entidade: "reserva",
      entidadeId: id,
      mudancas: { estado: [r.estado, "cancelada"], ...(o.vencimento ? { motivo: [null, "prazo do pedido do site vencido"] } : {}) },
    });
    await aplicarMotor(tx, organizacaoId, id, autorId);
    return { ok: true };
  });
}

/** Cancela a reserva; false se não existe, já está cancelada ou tem pagamento do site que a prende (ver `tentarCancelarReserva`). */
export async function cancelarReserva(db: Db, organizacaoId: string, id: string, autorId: string | null, o: { vencimento?: boolean; agora?: Date } = {}): Promise<boolean> {
  return (await tentarCancelarReserva(db, organizacaoId, id, autorId, o)).ok;
}

class ConfirmacaoRecusada extends Error {}

/**
 * Confirma uma reserva pendente ou um pedido (feito no painel, vindo de fora ou segurado pelo site): a
 * partir daí entra no financeiro.
 * Se ela já movimentou dinheiro e o cálculo novo não bate com o que ficou no livro (o motor não mexe
 * nisso), não confirma: a conferência continua até o ajuste manual (avisar em vez de supor).
 */
export async function confirmarReserva(db: Db, organizacaoId: string, id: string, autorId: string | null, agora = new Date()): Promise<{ ok: boolean; aviso?: string }> {
  if (!uuidValido(id)) return { ok: false };
  try {
    return await confirmarNaTransacao(db, organizacaoId, id, autorId, agora);
  } catch (e) {
    if (e instanceof ConfirmacaoRecusada) return { ok: false, aviso: e.message };
    throw e;
  }
}

async function confirmarNaTransacao(db: Db, organizacaoId: string, id: string, autorId: string | null, agora: Date): Promise<{ ok: boolean; aviso?: string }> {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.id, id), eq(reservas.organizacaoId, organizacaoId)))
      .for("update");
    // Pendente (painel/fora) ou pedido (hold do site, M8.1; pedido vindo do Beds24 também): vira confirmada.
    if (!r || (r.estado !== "pendente" && r.estado !== "pedido")) return { ok: false };
    // Pedido do site com o prazo vencido (a rotina ainda não passou): não confirma — vence agora, como a
    // rotina faria, e a equipe pede uma cotação nova ao hóspede. A página da cotação já o mostra vencido.
    if (r.estado === "pedido" && r.fonte === "site") {
      const [cot] = await tx.select({ id: cotacoes.id, estado: cotacoes.estado, holdAte: cotacoes.holdAte }).from(cotacoes).where(eq(cotacoes.reservaId, r.id)).for("update");
      // Pix em andamento (ou aprovado e ainda sendo processado): a equipe não confirma à mão nem vence o pedido
      // (M8.2a) — o pagamento decide; se ele não vier, o pedido vence sozinho depois da carência.
      const p = await pagamentoEmAndamentoOuAprovado(tx, r.id);
      if (p) {
        const [im] = await tx.select({ fuso: imoveis.fuso }).from(imoveis).where(eq(imoveis.id, r.imovelId));
        return { ok: false, aviso: avisoDoPagamento(p, im?.fuso ?? "America/Sao_Paulo", "confirmar") };
      }
      // Pagamento aprovado e decidido "sem reserva" (a devolver): ele não se liga a uma confirmação à mão depois.
      if (await pagamentoSemReservaADevolver(tx, r.id))
        return {
          ok: false,
          aviso: "Não confirmada: este pedido tem um pagamento do site aprovado sem reserva, a devolver ao hóspede. Resolva pelo quadro \"Pagamento no site\" desta reserva antes de confirmar à mão.",
        };
      if (cot && (cot.estado !== "segurada" || !cot.holdAte || cot.holdAte.getTime() <= agora.getTime())) {
        await tx.update(reservas).set({ estado: "cancelada", canceladaEm: new Date(), confirmadaEm: null, conferenciaResolvidaEm: null, atualizadoEm: new Date() }).where(eq(reservas.id, id));
        await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "reserva.cancelar", entidade: "reserva", entidadeId: id, mudancas: { estado: [r.estado, "cancelada"], motivo: [null, "prazo do pedido do site vencido"] } });
        if (cot.estado === "segurada") await tx.update(cotacoes).set({ estado: "expirada", atualizadaEm: new Date() }).where(eq(cotacoes.id, cot.id));
        await aplicarMotor(tx, organizacaoId, id, autorId);
        return { ok: false, aviso: "Não confirmada: o prazo deste pedido do site já passou e as datas voltaram à venda. Peça ao hóspede uma nova cotação pelo site." };
      }
    }
    await tx.update(reservas).set({ estado: "confirmada", confirmadaEm: new Date(), conferenciaResolvidaEm: null, atualizadoEm: new Date() }).where(eq(reservas.id, id));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "reserva.confirmar",
      entidade: "reserva",
      entidadeId: id,
      mudancas: { estado: [r.estado, "confirmada"] },
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
 * Confirmação de um pedido do site pelo pagamento (M8.2a), dentro da transação de quem conferiu o pagamento (com
 * as travas imóvel → reserva → cotação já tomadas). Os dados saem da PRÓPRIA reserva (nunca da cotação: o contato
 * do hóspede só está aqui), com quem recebe = empresa e a taxa do pagamento quando já conhecida; passa pela porta
 * única da sincronização (fonte `site`), que audita e aplica o motor. `tardio`: o pedido tinha vencido e as noites
 * estavam livres — a mesma reserva (mesmo código SCL) volta a valer. Auditoria própria, sem dados do pagador.
 */
export async function confirmarPedidoPago(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  o: { agora: Date; tardio: boolean; pagamentoId: string; taxaCanal?: number | null; valorLiquido?: number | null },
): Promise<{ ok: true; reserva: Reserva; avisos: string[]; protegido: boolean } | { ok: false; erro: string }> {
  if (!uuidValido(reservaId)) return { ok: false, erro: "Reserva não encontrada." };
  return db.transaction(async (tx) => {
    // NO KEY UPDATE, como a trava da cotação (pagamentos/travas.ts): um FOR UPDATE aqui subiria a trava da reserva e
    // bloquearia a conferência das chaves estrangeiras de quem grava lançamentos dela (impasse com a trava do motor).
    const [r] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)))
      .for("no key update");
    if (!r || r.fonte !== "site" || !r.idFonte) return { ok: false as const, erro: "Pedido do site não encontrado." };
    if (r.estado === "confirmada") return { ok: false as const, erro: "A reserva já está confirmada." };
    const dados: DadosReserva = {
      imovelId: r.imovelId,
      origem: r.origem,
      estado: "confirmada",
      reservadaEm: r.reservadaEm,
      checkin: r.checkin,
      checkout: r.checkout,
      hospedes: r.hospedes,
      hospedeNome: r.hospedeNome,
      hospedeEmail: r.hospedeEmail,
      hospedeTelefone: r.hospedeTelefone,
      hospedeOrigem: r.hospedeOrigem,
      moeda: r.moeda,
      valorBruto: r.valorBruto,
      taxaCanal: o.taxaCanal !== undefined && o.taxaCanal !== null ? o.taxaCanal : r.taxaCanal,
      valorLiquido: o.valorLiquido !== undefined && o.valorLiquido !== null ? o.valorLiquido : r.valorLiquido,
      // O dinheiro entrou na conta da empresa: é fato, não regra configurada.
      recebimento: "empresa",
      codigoCanal: r.codigoCanal,
      observacoes: r.observacoes,
    };
    const s = await sincronizarReserva(tx, organizacaoId, r.fonte, r.idFonte, dados, null, o.agora);
    if (!s.ok) return { ok: false as const, erro: Object.values(s.erros)[0] ?? "Não foi possível confirmar a reserva." };
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: null,
      acao: o.tardio ? "pagamento.confirmar_tardio" : "pagamento.confirmar",
      entidade: "reserva",
      entidadeId: r.id,
      mudancas: { estado: [r.estado, "confirmada"], pagamento: [null, o.pagamentoId] },
    });
    return { ok: true as const, reserva: s.reserva, avisos: s.avisosFinanceiro ?? [], protegido: s.financeiroNaoAtualizado === true };
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

export type FiltroPeriodo = { inicio: string; fim: string; imovelIds?: string[]; incluirCanceladas?: boolean; incluirConsultas?: boolean };

/** Reservas que ocupam algum dia de [inicio, fim), ordenadas por check-in. */
export async function listarReservas(db: Db, organizacaoId: string, f: FiltroPeriodo): Promise<Reserva[]> {
  const condicoes = [eq(reservas.organizacaoId, organizacaoId), lt(reservas.checkin, f.fim), gt(reservas.checkout, f.inicio)];
  if (f.imovelIds?.length) condicoes.push(inArray(reservas.imovelId, f.imovelIds.filter(uuidValido)));
  if (!f.incluirCanceladas) condicoes.push(ne(reservas.estado, "cancelada"));
  if (!f.incluirConsultas) condicoes.push(ne(reservas.estado, "consulta"));
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
