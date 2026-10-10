/**
 * Pagamento no site (M8.2a) — taxa, liberação e recebimento (M4.10 e M4.12).
 *
 * - Taxa = valor − líquido, a partir do líquido informado numa leitura (nunca soma de itens), gravada em
 *   `reservas.taxaCanal` (e `valorLiquido`) e depois o motor, nessa ordem, na mesma transação. Se o provedor informar
 *   outro líquido antes de qualquer recebimento lançado, a taxa é atualizada (e o motor roda) antes de lançar.
 * - Só o pagamento com desfecho `reserva`, com a reserva confirmada (ou cancelada com valor retido pela política, M8.2c)
 *   e a situação ainda `aprovado`, lança o
 *   recebimento, e só quando o provedor diz EXPLICITAMENTE que liberou (data passada sozinha nunca basta):
 *   montante = o líquido INFORMADO pelo provedor nessa leitura, data de caixa = o dia (em São Paulo) da leitura que
 *   viu o sinal (a data que o provedor informa é a PREVISTA e pode ser anterior à liberação de fato),
 *   `conciliado`, origem `sincronizacao`, chave `mercadopago:<tentativa>:recebimento` (`#N` depois de um estorno).
 * - Sem o sinal, a equipe registra a liberação à mão (data entre o dia da criação do pagamento e hoje, e o líquido): a taxa é
 *   derivada, o recebimento fica `realizado` com a mesma chave. O provedor confirmando depois com o mesmo líquido passa
 *   a `conciliado` (a data fica a que a equipe viu no Mercado Pago); outro líquido (ou um recebimento já lançado com
 *   outro valor), aviso, sem mexer.
 *   Só o manual se estorna, e só por aqui: a taxa volta ao que o provedor tinha informado antes (ou a nada).
 * - Cartão (M8.2b): a mesma regra. Liberação parcela a parcela (money_release_schema) e "parcelamento sem acréscimo"
 *   nunca lançam sozinhos (`aplicarLeitura` liga o aviso); a equipe registra à mão.
 * - Vários pagamentos por reserva (M8.2d: a diferença de uma alteração): a taxa da reserva é uma regra só
 *   (`taxaDaReserva`: a soma das taxas conhecidas dos pagamentos que contam, menos a atribuída ao principal devolvido nas
 *   alterações); cada pagamento da reserva tem a sua liberação (`mercadopago:<pagamento>:recebimento`), também o devolvido
 *   em parte sem devolução inexplicada; e a liberação (do provedor ou à mão) lança as saídas de caixa de devoluções que
 *   esperavam por ela (`acertarCaixasPendentes`) e acorda as devoluções de parte do valor que esperavam a liberação (D13).
 *   Na reserva cancelada com devolução integral, a liberação (do provedor, ou à mão quando uma devolução de parte do valor
 *   espera por ela) fica registrada só no pagamento: nada entra no livro.
 */
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { auditoria, devolucoesPagamento, lancamentos, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import { estornar, lancar, LancamentoInvalido, mudarEstado } from "@/financeiro/ledger";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { hojeISO } from "@/lib/datas";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { repasseAPagarDaReserva } from "@/repasses/recebimentos";
import { dataValida } from "@/reservas/regras";
import { acertarCaixasPendentes } from "./acerto-cancelamento";
import { sincronizarAvisosDoPagamento } from "./avisos-devolucao";
import type { CodigoAviso } from "./situacoes";
import {
  type Alteracao,
  devolucaoInexplicada,
  devolucoesDoPagamento,
  dinheiroDaReserva,
  esperaLiberacao,
  type Pagamento,
  pagamentosDaReserva,
  possivelmenteNoProvedor,
  type ReservaTravada,
  type Travado,
  taxaAtribuidaDaDevolucao,
  travarCotacao,
} from "./travas";

export const FUSO_PAGAMENTO = "America/Sao_Paulo";
export const chaveRecebimento = (pagamentoId: string) => `mercadopago:${pagamentoId}:recebimento`;
const dataBr = (d: string) => d.split("-").reverse().join("/");

export type Resultado = { ok: true } | { ok: false; erro: string };

export const ERRO_ESTORNO_LIBERACAO_CANCELADA = "A reserva foi cancelada com devolução integral ao hóspede: a liberação não se estorna mais (não poderia ser registrada de novo). Corrija com um ajuste.";

/** Recebimentos lançados para este pagamento (a chave base e as versões #N), com os que ainda estão em vigor. */
export async function recebimentosDoPagamento(tx: Db, organizacaoId: string, pagamentoId: string) {
  const base = chaveRecebimento(pagamentoId);
  const linhas = await tx
    .select({ id: lancamentos.id, chave: lancamentos.chaveOrigem, estado: lancamentos.estado, montante: lancamentos.montante, dataCaixa: lancamentos.dataCaixa })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.tipo, "recebimento"), or(eq(lancamentos.chaveOrigem, base), like(lancamentos.chaveOrigem, `${base}#%`))))
    .for("update");
  const estornados = linhas.length ? await tx.select({ de: lancamentos.estornoDe }).from(lancamentos).where(inArray(lancamentos.estornoDe, linhas.map((l) => l.id))) : [];
  const anulados = new Set(estornados.map((e) => e.de));
  let proxima = base;
  for (let n = 2; linhas.some((l) => l.chave === proxima); n++) proxima = `${base}#${n}`;
  return { emVigor: linhas.filter((l) => !anulados.has(l.id)), proxima };
}

/**
 * A taxa da reserva (uma regra, um lugar; M8.2d): a soma das taxas CONHECIDAS dos pagamentos que contam (o que confirmou
 * e as diferenças aplicadas), menos a taxa atribuída ao principal devolvido nas alterações (congelada na devolução, ou
 * calculada agora quando ainda não congelou). Uma taxa desconhecida não apaga as conhecidas: `desconhecida` avisa, e o
 * pagamento continua com o aviso dele. Nenhuma conhecida (um pagamento só, sem a taxa): `taxa` 0, `conhecida` false — a
 * reserva fica sem taxa, como antes de qualquer leitura. Um pagamento só, sem devolução de alteração: exatamente a taxa
 * dele (o M8.2c não muda).
 * `o.taxaNova`: a taxa de um pagamento que esta transação ainda vai gravar (a aprovação da diferença); `o.partes`: as
 * devoluções da alteração que está sendo aplicada (ainda não gravadas), cada uma com o valor dela.
 */
export function taxaDaReserva(
  t: Pick<Travado, "tentativas" | "devolucoes">,
  o: { alteracao?: Pick<Alteracao, "id">; taxaNova?: { pagamentoId: string; taxa: number | null }; partes?: readonly { pagamentoId: string; valor: number }[] } = {},
): { taxa: number; desconhecida: boolean; conhecida: boolean } {
  let taxa = 0;
  let desconhecida = false;
  let conhecida = false;
  for (const p of pagamentosDaReserva(t)) {
    const f = o.taxaNova?.pagamentoId === p.id ? o.taxaNova.taxa : p.taxa;
    if (f === null) {
      desconhecida = true;
      continue;
    }
    conhecida = true;
    const comTaxa = { ...p, taxa: f };
    // As devoluções de alteração deste pagamento, na ordem em que a taxa congela: as congeladas, depois as outras (por id).
    const devs = devolucoesDoPagamento(t, p.id).map((d) => ({ ...d }));
    const daAlteracao = devs.filter((d) => d.origem === "alteracao").sort((a, b) => Number(a.taxaAtribuida === null) - Number(b.taxaAtribuida === null));
    let atribuida = 0;
    for (const d of daAlteracao) {
      const x = d.taxaAtribuida ?? taxaAtribuidaDaDevolucao(comTaxa, d, devs) ?? 0;
      d.taxaAtribuida = x;
      atribuida += x;
    }
    for (const parte of o.partes ?? []) {
      if (parte.pagamentoId !== p.id) continue;
      const nova = { id: `parte:${parte.pagamentoId}`, situacao: "pedida" as const, valor: parte.valor, valorConfirmado: null, porForaValor: null, taxaAtribuida: null };
      const x = taxaAtribuidaDaDevolucao(comTaxa, nova, devs) ?? 0;
      devs.push({ ...nova, taxaAtribuida: x } as (typeof devs)[number]);
      atribuida += x;
    }
    taxa += f - atribuida;
  }
  return { taxa, desconhecida, conhecida };
}

/**
 * Grava na reserva a taxa da reserva (`taxaDaReserva`) e aplica o motor, nessa ordem (quem chama já tem as travas e já
 * atualizou o retrato do pagamento). Nenhuma taxa conhecida = null (a reserva volta ao "sem taxa", como antes de qualquer
 * leitura). O líquido: o do pagamento, quando ele é o único e não tem devolução de alteração; senão, o bruto menos a taxa.
 */
export async function gravarTaxaNaReserva(tx: Db, organizacaoId: string, t: Travado, autorId: string | null, pagamentoId: string, agora: Date): Promise<void> {
  // Mesmo modo da trava da cotação (NO KEY UPDATE): um FOR UPDATE aqui subiria a trava da reserva (ver travas.ts).
  const [r] = await tx
    .select({ taxaCanal: reservas.taxaCanal, valorLiquido: reservas.valorLiquido, valorBruto: reservas.valorBruto })
    .from(reservas)
    .where(and(eq(reservas.id, t.reserva.id), eq(reservas.organizacaoId, organizacaoId)))
    .for("no key update");
  if (!r) return;
  const { taxa: soma, conhecida } = taxaDaReserva(t);
  const taxa = conhecida ? soma : null;
  const contam = pagamentosDaReserva(t);
  const unicoIntocado = contam.length === 1 && !t.devolucoes.some((d) => d.pagamentoId === contam[0].id && d.origem === "alteracao" && d.situacao !== "substituida");
  const liquido = taxa === null ? null : unicoIntocado ? contam[0].liquido : r.valorBruto === null ? null : r.valorBruto - taxa;
  if (r.taxaCanal === taxa && r.valorLiquido === liquido) return;
  // Campo do financeiro mudou: uma conferência dada por resolvida volta a valer (como na sincronização).
  await tx.update(reservas).set({ taxaCanal: taxa, valorLiquido: liquido, conferenciaResolvidaEm: null, atualizadoEm: agora }).where(eq(reservas.id, t.reserva.id));
  Object.assign(t.reserva, { taxaCanal: taxa, valorLiquido: liquido, conferenciaResolvidaEm: null });
  await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.taxa", entidade: "reserva", entidadeId: t.reserva.id, mudancas: { taxaCanal: [r.taxaCanal, taxa], valorLiquido: [r.valorLiquido, liquido], pagamento: [null, pagamentoId] } });
  await aplicarMotor(tx, organizacaoId, t.reserva.id, autorId);
}

/**
 * A taxa que a reserva teria agora (null = nenhuma conhecida): para quem decide se precisa gravar (`gravarTaxaNaReserva`
 * não muda nada quando já está igual).
 */
export const taxaCanalDaReserva = (t: Pick<Travado, "tentativas" | "devolucoes">) => {
  const { taxa, conhecida } = taxaDaReserva(t);
  return conhecida ? taxa : null;
};

/**
 * D13: a liberação do pagamento chegou (do provedor ou à mão): as devoluções de parte do valor dele que esperavam a
 * liberação são pedidas na próxima volta (rotina ou "Conferir agora"), sem esperar a data prevista. Sob as travas.
 */
export async function acordarDevolucoesQueEsperam(tx: Db, t: Travado, p: Pagamento, agora: Date): Promise<void> {
  for (const d of devolucoesDoPagamento(t, p.id)) {
    if (d.situacao !== "pedida" || possivelmenteNoProvedor(d) || d.ultimoCodigo !== "aguardando_liberacao") continue;
    await tx.update(devolucoesPagamento).set({ proximaTentativaEm: agora, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, d.id));
    d.proximaTentativaEm = agora;
  }
}

/**
 * O provedor disse que liberou: lança o recebimento conciliado com o líquido INFORMADO por ele nesta leitura, com a
 * data de caixa no dia desta leitura (ou concilia o registrado à mão, se o valor bate; a data dele fica). Recebimento
 * já lançado com outro valor: aviso, sem mexer. Quem chama já conferiu o dinheiro da reserva (desfecho `reserva` ou
 * `alteracao`), a reserva calculada pelo motor e a situação (aprovada, ou devolvida em parte sem devolução inexplicada),
 * dentro das travas, e já gravou a taxa desse líquido na reserva (quando não havia recebimento).
 */
export async function liberarPeloProvedor(tx: Db, organizacaoId: string, p: Pagamento, r: ReservaTravada, liquidoInformado: number, liberacaoPrevista: Date | null, agora: Date): Promise<{ aviso: CodigoAviso | null; confirmada: boolean }> {
  // "Liberado" com a data prevista ainda no futuro: sinais que não batem, não fecha (aviso).
  if (liberacaoPrevista && liberacaoPrevista.getTime() > agora.getTime()) return { aviso: "liberacao_futura", confirmada: false };
  // Data de caixa = o dia desta leitura: a data informada é a prevista (com retenção ou contestação, o dinheiro sai
  // depois dela) e o sinal só diz que já saiu; nunca se lança o caixa num dia antes de o dinheiro estar liberado.
  const data = hojeISO(FUSO_PAGAMENTO, agora);
  const { emVigor, proxima } = await recebimentosDoPagamento(tx, organizacaoId, p.id);
  const atual = emVigor[0];
  if (atual) {
    // Já lançado (à mão pela equipe, com a data vista no Mercado Pago, ou por uma leitura anterior): o valor decide.
    if (atual.montante !== liquidoInformado) return { aviso: "liberacao_divergente", confirmada: false };
    if (atual.estado !== "conciliado") {
      await mudarEstado(tx, organizacaoId, atual.id, "conciliado", null);
      await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.liberacao", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: ["manual", `conciliada (caixa em ${atual.dataCaixa})`] } });
    }
    return { aviso: null, confirmada: true };
  }
  await lancar(
    tx,
    organizacaoId,
    [
      {
        tipo: "recebimento",
        descricao: `Reserva ${r.codigo} — liberação do Mercado Pago de ${formatBRL(liquidoInformado)} em ${dataBr(data)}`,
        valor: 0,
        montante: liquidoInformado,
        competencia: data,
        dataCaixa: data,
        estado: "conciliado",
        imovelId: r.imovelId,
        reservaId: r.id,
        origem: "sincronizacao",
        chaveOrigem: proxima,
      },
    ],
    null,
  );
  await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.liberacao", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: [null, `${liquidoInformado} em ${data}`] } });
  return { aviso: null, confirmada: true };
}

async function cotacaoDoPagamento(db: Db, organizacaoId: string, pagamentoId: string): Promise<string | null> {
  if (!uuidValido(pagamentoId)) return null;
  const [p] = await db.select({ cotacaoId: pagamentos.cotacaoId }).from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  return p?.cotacaoId ?? null;
}

/**
 * Liberação registrada à mão (sem o sinal do provedor): data entre o dia (em São Paulo) da criação do pagamento e hoje, e o
 * líquido que caiu. O limite de baixo é a criação, não `aprovadoEm`: este é a hora da primeira leitura da aprovação,
 * que pode vir dias depois do pagamento (nas prévias nada confere sozinho). A taxa é
 * derivada (valor − líquido) e gravada na reserva com o motor; o recebimento fica `realizado`, com a chave do
 * pagamento. A auditoria guarda a taxa de antes (a que o provedor tinha informado, ou nada): o estorno volta a ela.
 * Reserva cancelada com devolução integral (M8.2d, D13): só quando uma devolução de parte do valor deste pagamento espera
 * a liberação (no teste o sinal do provedor nunca chega; o cartão parcelado só se libera à mão): a taxa e o líquido ficam no
 * pagamento, nada entra no livro, e a devolução acorda.
 */
export async function registrarLiberacaoManual(db: Db, organizacaoId: string, pagamentoId: string, d: { data: string; liquido: number }, autorId: string | null, agora: Date = new Date()): Promise<Resultado> {
  if (!dataValida(d.data)) return { ok: false, erro: "Data da liberação inválida." };
  if (d.data > hojeISO(FUSO_PAGAMENTO, agora)) return { ok: false, erro: "A data da liberação não pode ser no futuro." };
  if (!Number.isSafeInteger(d.liquido) || d.liquido <= 0) return { ok: false, erro: "Informe o líquido que caiu na conta (maior que zero)." };
  const cotacaoId = await cotacaoDoPagamento(db, organizacaoId, pagamentoId);
  if (!cotacaoId) return { ok: false, erro: "Pagamento não encontrado." };
  return db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, cotacaoId);
    const p = t?.tentativas.find((x) => x.id === pagamentoId);
    if (!t || !p) return { ok: false as const, erro: "Pagamento não encontrado." };
    if (!dinheiroDaReserva(p)) return { ok: false as const, erro: "Só o pagamento que confirmou a reserva (ou a diferença de uma alteração aplicada) tem liberação registrada." };
    // Devolvido em parte pelas devoluções do sistema (uma alteração com devolução): a liberação ainda vale. Com uma
    // devolução que o sistema não explica (painel do Mercado Pago), não.
    const emParteExplicada = p.situacao === "devolvido_parcial" && !devolucaoInexplicada(p, devolucoesDoPagamento(t, p.id));
    if (p.situacao !== "aprovado" && !emParteExplicada) return { ok: false as const, erro: "Este pagamento não está mais aprovado no Mercado Pago: confira antes de registrar a liberação." };
    // Confirmada, ou cancelada com valor retido pela política (M8.2c): o dinheiro ficou com a empresa. Cancelada com
    // devolução integral: o dinheiro volta ao hóspede e nunca entra no livro — a liberação só se registra (M8.2d, D13)
    // quando uma devolução de parte do valor deste pagamento espera por ela, como faz a liberação lida do Mercado Pago.
    const calculada = reservaCalculadaPeloMotor(t.reserva);
    const devs = devolucoesDoPagamento(t, p.id);
    const canceladaIntegral = t.reserva.estado === "cancelada" && t.cancelamento?.situacao === "cancelada" && t.cancelamento.direito === "integral";
    const destrava = canceladaIntegral && devs.some((x) => x.situacao === "pedida" && esperaLiberacao(p, x, devs));
    if (!calculada && !destrava) return { ok: false as const, erro: "A reserva não está confirmada nem cancelada com valor retido: o dinheiro deste pagamento volta ao hóspede." };
    if (d.liquido > p.valor) return { ok: false as const, erro: `O líquido não pode passar do valor pago (${formatBRL(p.valor)}).` };
    // O dinheiro não cai antes de o pagamento existir (a hora da criação é nossa e confiável).
    const criadoNoDia = hojeISO(FUSO_PAGAMENTO, p.criadoEm);
    if (d.data < criadoNoDia) return { ok: false as const, erro: `A data da liberação não pode ser antes da criação do pagamento (${dataBr(criadoNoDia)}).` };
    if (!calculada) {
      // Só registrada aqui (nada entra no livro, a taxa não volta à reserva cancelada): a taxa e o líquido do pagamento ficam
      // conhecidos, as saídas de caixa que esperavam se acertam sem lançar e a devolução que esperava a liberação acorda. A
      // liberação que o Mercado Pago já sinalizou sem informar o líquido fica como estava; só a taxa passa a ser conhecida.
      const taxaAntes = p.taxa;
      const mudanca = { taxa: p.valor - d.liquido, liquido: d.liquido, liberacaoConfirmadaEm: p.liberacaoConfirmadaEm ?? agora, liberacaoOrigem: p.liberacaoOrigem ?? ("manual" as const), atualizadoEm: agora };
      await tx.update(pagamentos).set(mudanca).where(eq(pagamentos.id, p.id));
      Object.assign(p, mudanca);
      await acertarCaixasPendentes(tx, organizacaoId, t, p, d.data, agora);
      await acordarDevolucoesQueEsperam(tx, t, p, agora);
      await sincronizarAvisosDoPagamento(tx, t, p, agora);
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autorId,
        acao: "pagamento.liberacao_manual",
        entidade: "pagamento",
        entidadeId: p.id,
        mudancas: { liberacao: [null, `${d.liquido} em ${d.data} (só registrada: reserva cancelada com devolução integral)`], taxa: [taxaAntes, mudanca.taxa] },
      });
      return { ok: true as const };
    }
    const { emVigor, proxima } = await recebimentosDoPagamento(tx, organizacaoId, p.id);
    if (emVigor.length) return { ok: false as const, erro: emVigor[0].estado === "conciliado" ? "A liberação já foi confirmada pelo Mercado Pago." : "A liberação já está registrada: estorne a registrada à mão antes de registrar de novo." };
    const taxa = p.valor - d.liquido;
    const taxaAntes = p.taxa;
    const mudanca = { taxa, liquido: d.liquido, liberacaoConfirmadaEm: agora, liberacaoOrigem: "manual" as const, atualizadoEm: agora };
    await tx.update(pagamentos).set(mudanca).where(eq(pagamentos.id, p.id));
    Object.assign(p, mudanca);
    await gravarTaxaNaReserva(tx, organizacaoId, t, autorId, p.id, agora);
    await lancar(
      tx,
      organizacaoId,
      [
        {
          tipo: "recebimento",
          descricao: `Reserva ${t.reserva.codigo} — liberação do Mercado Pago de ${formatBRL(d.liquido)} em ${dataBr(d.data)} (registrada à mão)`,
          valor: 0,
          montante: d.liquido,
          competencia: d.data,
          dataCaixa: d.data,
          estado: "realizado",
          imovelId: t.reserva.imovelId,
          reservaId: t.reserva.id,
          origem: "manual",
          chaveOrigem: proxima,
        },
      ],
      autorId,
    );
    // As saídas de caixa que esperavam este recebimento (devolução por fora antes da liberação) e as devoluções de parte do
    // valor que esperavam a liberação (D13).
    await acertarCaixasPendentes(tx, organizacaoId, t, p, d.data, agora);
    await acordarDevolucoesQueEsperam(tx, t, p, agora);
    await sincronizarAvisosDoPagamento(tx, t, p, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.liberacao_manual", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: [null, `${d.liquido} em ${d.data}`], taxa: [taxaAntes, taxa] } });
    return { ok: true as const };
  });
}

/**
 * A taxa que valia antes da liberação registrada à mão (a última que o provedor informou, ou null): a auditoria do
 * registro guarda `taxa: [antes, depois]`, e é o único lugar com esse valor. Sem o registro, null (desconhecida).
 */
async function taxaAntesDoManual(tx: Db, organizacaoId: string, pagamentoId: string): Promise<number | null> {
  const [a] = await tx
    .select({ mudancas: auditoria.mudancas })
    .from(auditoria)
    .where(and(eq(auditoria.organizacaoId, organizacaoId), eq(auditoria.entidade, "pagamento"), eq(auditoria.entidadeId, pagamentoId), eq(auditoria.acao, "pagamento.liberacao_manual")))
    .orderBy(desc(auditoria.criadoEm), desc(auditoria.id))
    .limit(1);
  const antes = (a?.mudancas as { taxa?: unknown[] } | undefined)?.taxa?.[0];
  return Number.isSafeInteger(antes) && (antes as number) >= 0 ? (antes as number) : null;
}

/**
 * Estorna a liberação registrada à mão (a do provedor nunca): a taxa e o líquido voltam ao que o provedor tinha
 * informado antes (ou a desconhecidos), a reserva recebe essa taxa com o motor, o aviso de liberação divergente sai, e
 * a próxima conferência relê a Payments API. A próxima liberação usa a chave seguinte (#N). Na reserva cancelada com
 * devolução integral (M8.2c), nunca: a liberação não se registraria de novo e a saída da devolução espelha esta entrada.
 */
export async function estornarLiberacaoManual(db: Db, organizacaoId: string, pagamentoId: string, motivo: string, autorId: string | null, agora: Date = new Date()): Promise<Resultado> {
  const m = motivo.trim().slice(0, 200);
  if (!m) return { ok: false, erro: "Informe o motivo do estorno." };
  // O motivo vai para a descrição do estorno no livro: nunca com dado pessoal (como toda nota, M8.2c).
  if (textoSemDadosPessoais(motivo.trim()) === null) return { ok: false, erro: ERRO_DADOS_PESSOAIS };
  const cotacaoId = await cotacaoDoPagamento(db, organizacaoId, pagamentoId);
  if (!cotacaoId) return { ok: false, erro: "Pagamento não encontrado." };
  return db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, cotacaoId);
    const p = t?.tentativas.find((x) => x.id === pagamentoId);
    if (!t || !p) return { ok: false as const, erro: "Pagamento não encontrado." };
    const { emVigor } = await recebimentosDoPagamento(tx, organizacaoId, p.id);
    const l = emVigor[0];
    if (!l) return { ok: false as const, erro: "Não há liberação registrada para estornar." };
    if (l.estado !== "realizado") return { ok: false as const, erro: "A liberação foi confirmada pelo Mercado Pago: não se estorna pelo painel." };
    // M8.2c: a saída do caixa da devolução ao hóspede espelha este recebimento; estornar a liberação deixaria a saída sem a
    // entrada. M8.2d (D13): nem com uma devolução de parte do valor já pedida ao Mercado Pago (ela só saiu porque o pagamento
    // estava liberado) nem com uma devolução realizada à espera do caixa.
    const devs = devolucoesDoPagamento(t, p.id);
    if (devs.some((x) => x.saidaLancamentoId)) return { ok: false as const, erro: "A devolução ao hóspede já espelhou esta liberação: corrija com um ajuste." };
    if (devs.some((x) => x.situacao === "pedida" && x.tentativas > 0 && x.corpoIntegral === false))
      return { ok: false as const, erro: "Há uma devolução de parte deste pagamento já pedida ao Mercado Pago (ela só sai com o pagamento liberado): espere ela se resolver e corrija com um ajuste." };
    if (devs.some((x) => (x.situacao === "confirmada" || x.situacao === "por_fora") && !x.caixaLancadoEm))
      return { ok: false as const, erro: "Há uma devolução deste pagamento esperando a liberação para acertar o caixa: corrija com um ajuste." };
    // M8.2c: cancelada com devolução integral, a liberação não se registra de novo (`registrarLiberacaoManual`), e a taxa
    // nunca volta à reserva (gravá-la reabriria a conferência que o acerto do cancelamento deu por resolvida).
    if (!reservaCalculadaPeloMotor(t.reserva)) return { ok: false as const, erro: ERRO_ESTORNO_LIBERACAO_CANCELADA };
    await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
    const preso = await repasseAPagarDaReserva(tx, organizacaoId, t.reserva.id);
    if (preso) return { ok: false as const, erro: preso };
    try {
      await estornar(tx, organizacaoId, l.id, `Liberação registrada à mão estornada: ${m}`, autorId);
    } catch (e) {
      if (e instanceof LancamentoInvalido) return { ok: false as const, erro: e.message };
      throw e;
    }
    const taxa = p.liberacaoOrigem === "manual" ? await taxaAntesDoManual(tx, organizacaoId, p.id) : p.taxa;
    const liquido = taxa === null ? null : p.valor - taxa;
    const taxaAntes = p.taxa;
    // O aviso de liberação divergente apontava para o recebimento que acabou de sair: sai junto (a próxima leitura liga
    // de novo se o provedor ainda não bater com o que for registrado depois).
    const mudanca = { liberacaoConfirmadaEm: null, liberacaoOrigem: null, taxa, liquido, financeiroConsultadoEm: null, avisos: p.avisos.filter((a) => a !== "liberacao_divergente"), atualizadoEm: agora };
    await tx.update(pagamentos).set(mudanca).where(eq(pagamentos.id, p.id));
    Object.assign(p, mudanca);
    // A reserva volta à taxa do provedor (ou a nenhuma) antes de qualquer novo recebimento: o motor recalcula.
    if (dinheiroDaReserva(p)) await gravarTaxaNaReserva(tx, organizacaoId, t, autorId, p.id, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.liberacao_estornar", entidade: "pagamento", entidadeId: p.id, mudancas: { liberacao: [`${l.montante} em ${l.dataCaixa}`, null], taxa: [taxaAntes, taxa] } });
    return { ok: true as const };
  });
}
