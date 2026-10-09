/**
 * Pagamento no site (M8.2a) — aplica uma leitura do provedor a uma tentativa, numa transação curta, com as travas
 * já tomadas (`travarCotacao`). Uma função só para todos os gatilhos (criação, aviso, página, rotina, painel):
 * transições (só por leitura do provedor; o desconhecido nunca sobrescreve), confirmação, taxa e motor, liberação,
 * devolução confirmada e avisos. Nada aqui chama o provedor; o que precisa de chamada (cancelar Pix que sobrou)
 * volta em `cancelar`, para quem chamou fazer depois da transação.
 */
import { and, eq, ne } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { categoriaDaTaxaPerdida } from "@/configuracoes/pagamento-site";
import { devolucoesPagamento, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { lancar } from "@/financeiro/ledger";
import { hojeISO } from "@/lib/datas";
import { decidirAprovacao } from "./confirmacao";
import { FUSO_PAGAMENTO, gravarTaxaNaReserva, liberarPeloProvedor } from "./liberacao";
import type { Cobranca, DetalheFinanceiro } from "./provedor";
import { type CodigoAviso, type SituacaoPagamento, situacaoLocal, transicaoPermitida } from "./situacoes";
import type { Devolucao, Pagamento, Travado } from "./travas";

export type Leitura = {
  /** A order lida; null = o provedor não achou; undefined = não houve leitura da order. */
  cobranca?: Cobranca | null;
  /** Taxa/líquido/liberação; null = não foi lido. */
  financeiro?: DetalheFinanceiro | null;
  /** Criação sem resposta (não se sabe se a order existe). */
  incerta?: boolean;
  /** Criação recusada pelo provedor sem order (dados inválidos): nada foi cobrado. */
  recusadaSemOrder?: boolean;
  /** Procurada pela referência e não achada há tempo demais: a criação não aconteceu. */
  desistir?: boolean;
  /** Id da order com que a leitura foi feita (null = pela referência). Se mudou até a trava, a ausência lida é antiga. */
  idLido?: string | null;
};

export type Efeitos = {
  situacao: SituacaoPagamento;
  mudou: boolean;
  confirmou: boolean;
  /** Orders a cancelar no provedor depois da transação (Pix que sobrou, ou real no ambiente de teste). */
  cancelar: { id: string; idProvedor: string }[];
};

const chaveTaxaPerdida = (devolucaoId: string) => `mercadopago:${devolucaoId}:taxa`;

/** A taxa que o provedor não devolveu vira despesa da empresa, só com o valor dado por ele (nunca palpite). */
async function lancarTaxaPerdida(tx: Db, organizacaoId: string, t: Travado, dev: Devolucao, taxa: number, agora: Date): Promise<void> {
  let despesaLancamentoId: string | null = null;
  if (taxa > 0) {
    const categoriaId = await categoriaDaTaxaPerdida(tx, organizacaoId, null);
    const data = hojeISO(FUSO_PAGAMENTO, dev.confirmadaEm ?? agora);
    const [l] = await lancar(
      tx,
      organizacaoId,
      [
        {
          tipo: "despesa_empresa",
          descricao: `Taxa do pagamento do site que o Mercado Pago não devolveu (cotação ${t.cotacao.codigo}, reserva ${t.reserva.codigo})`,
          valor: -taxa,
          montante: taxa,
          efeitoSaldo: 0,
          competencia: data,
          dataCaixa: data,
          estado: "realizado",
          imovelId: t.imovel.id,
          categoriaId,
          origem: "sincronizacao",
          chaveOrigem: chaveTaxaPerdida(dev.id),
        },
      ],
      null,
    );
    despesaLancamentoId = l.id;
  }
  await tx.update(devolucoesPagamento).set({ taxaPerdida: taxa, despesaLancamentoId, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
}

export async function aplicarLeitura(tx: Db, organizacaoId: string, t: Travado, pagamentoId: string, leitura: Leitura, agora: Date): Promise<Efeitos> {
  const p = t.tentativas.find((x) => x.id === pagamentoId);
  if (!p) throw new Error("Tentativa fora da cotação travada.");
  const patch: Partial<Pagamento> = { consultadoEm: agora, atualizadoEm: agora };
  const avisos = new Set(p.avisos);
  const efeitos: Efeitos = { situacao: p.situacao, mudou: false, confirmou: false, cancelar: [] };
  let situacao: SituacaoPagamento = p.situacao;
  const f = leitura.financeiro ?? null;
  if (leitura.financeiro !== undefined && leitura.financeiro !== null) patch.financeiroConsultadoEm = agora;

  const semOrder = situacao === "criando" || situacao === "incerta";
  if (leitura.incerta && situacao === "criando") situacao = "incerta";
  if (leitura.recusadaSemOrder && semOrder) {
    situacao = "recusado";
    patch.detalheProvedor = "dados_invalidos";
  }
  const c = leitura.cobranca;
  let cobrancaAplicada: Cobranca | null = null;
  if (c === null) {
    // Leitura feita antes de outra transação gravar o id da order (a criação terminou no meio): já não vale.
    if (leitura.idLido !== undefined && leitura.idLido !== p.idProvedor) {
      /* nada */
    } else if (p.idProvedor) avisos.add("order_nao_encontrada");
    else if (leitura.desistir && semOrder) {
      // Procurada pela referência por tempo bastante e nunca achada: a criação não chegou a acontecer.
      situacao = "cancelado";
      patch.detalheProvedor = "nao_criada";
    }
  } else if (c) {
    let confere = c.referencia === p.referencia && (!p.idProvedor || p.idProvedor === c.idProvedor);
    if (confere && !p.idProvedor) {
      const [outra] = await tx.select({ id: pagamentos.id }).from(pagamentos).where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.idProvedor, c.idProvedor), ne(pagamentos.id, p.id))).limit(1);
      if (outra) confere = false;
      else patch.idProvedor = c.idProvedor;
    }
    if (!confere) avisos.add("referencia_divergente");
    else {
      cobrancaAplicada = c;
      avisos.delete("referencia_divergente");
      avisos.delete("order_nao_encontrada");
      patch.detalheProvedor = c.detalhe.slice(0, 120);
      if (c.aoVivo !== null) patch.aoVivo = c.aoVivo;
      if (c.aoVivo === true) avisos.add("ao_vivo");
      if (c.pago !== null) patch.valorPago = c.pago;
      const nova = situacaoLocal(c.situacao);
      if (nova === null) avisos.add("situacao_desconhecida");
      else {
        avisos.delete("situacao_desconhecida");
        if (transicaoPermitida(situacao, nova)) situacao = nova;
      }
      if (situacao === "pendente" && c.pix) {
        patch.pixCopiaECola = c.pix.copiaECola;
        patch.pixImagem = c.pix.imagemBase64;
        patch.pixLink = c.pix.link;
        patch.pixExpiraEm = c.pix.expiraEm;
      }
    }
  }
  // Pix pago, vencido ou cancelado: o copia e cola e a imagem saem do banco (o prazo fica, para o histórico).
  if (situacao !== "pendente" && situacao !== "criando" && situacao !== "incerta" && (p.pixCopiaECola || p.pixImagem || p.pixLink)) {
    patch.pixCopiaECola = null;
    patch.pixImagem = null;
    patch.pixLink = null;
  }
  if (situacao === "aprovado" && !p.aprovadoEm) patch.aprovadoEm = agora;
  const aoVivo = patch.aoVivo ?? p.aoVivo;
  if (situacao === "pendente" && aoVivo === true && (patch.idProvedor ?? p.idProvedor)) efeitos.cancelar.push({ id: p.id, idProvedor: (patch.idProvedor ?? p.idProvedor)! });

  // Taxa e líquido: numa leitura só, a partir do líquido informado (taxa = valor − líquido), só enquanto aprovado.
  let taxa = p.taxa;
  let liquido = p.liquido;
  if (f?.liberacaoPrevista) patch.liberacaoPrevistaEm = f.liberacaoPrevista;
  if (f && f.liquido !== null && situacao === "aprovado") {
    const lida = p.valor - f.liquido;
    if (lida < 0 || f.liquido > p.valor) avisos.add("taxa_invalida");
    else {
      avisos.delete("taxa_invalida");
      if (taxa === null) {
        taxa = lida;
        liquido = f.liquido;
        patch.taxa = taxa;
        patch.liquido = liquido;
      } else if (taxa !== lida) avisos.add(p.liberacaoOrigem === "manual" ? "liberacao_divergente" : "taxa_divergente");
    }
  }

  let desfecho = p.desfecho;
  let motivoSemReserva = p.motivoSemReserva;
  if (situacao === "aprovado" && desfecho === null && motivoSemReserva === null) {
    const d = await decidirAprovacao(tx, organizacaoId, t, p, cobrancaAplicada, { taxa, liquido }, agora);
    desfecho = d.desfecho;
    motivoSemReserva = d.motivoSemReserva;
    efeitos.confirmou = d.confirmou;
    if (d.desfecho) {
      patch.desfecho = d.desfecho;
      patch.desfechoMotivo = d.desfechoMotivo;
      patch.desfechoEm = agora;
      patch.desfechoPor = null;
      // As outras tentativas pendentes da cotação são canceladas no provedor (depois da transação).
      for (const x of t.tentativas) if (x.id !== p.id && x.situacao === "pendente" && x.idProvedor) efeitos.cancelar.push({ id: x.id, idProvedor: x.idProvedor });
    } else patch.motivoSemReserva = d.motivoSemReserva;
  } else if (desfecho === "reserva" && taxa !== null && liquido !== null && p.liberacaoOrigem !== "manual" && (patch.taxa !== undefined || t.reserva.taxaCanal !== taxa)) {
    // Taxa conhecida depois da confirmação: entra na reserva e o motor roda (nessa ordem).
    await gravarTaxaNaReserva(tx, organizacaoId, t.reserva.id, taxa, liquido, null, p.id, agora);
  }

  // Devolução feita, contestação, ou devolução fora do sistema: só avisos (partes c e e cuidam da reserva).
  const dev = t.devolucoes.find((x) => x.pagamentoId === p.id);
  if (desfecho === "reserva" && (situacao === "devolvido" || situacao === "devolvido_parcial")) avisos.add("devolvido_por_fora");
  if (situacao === "contestado") avisos.add("contestado");
  // Pedida (ou dada por recusada depois de 3 falhas, mas que acabou saindo): a leitura confirma.
  if (situacao === "devolvido" && (dev?.situacao === "pedida" || dev?.situacao === "recusada") && desfecho === null) {
    const antes = dev.situacao;
    await tx.update(devolucoesPagamento).set({ situacao: "confirmada", confirmadaEm: agora, proximaTentativaEm: null, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    dev.situacao = "confirmada";
    dev.confirmadaEm = agora;
    desfecho = "devolucao";
    patch.desfecho = "devolucao";
    patch.desfechoMotivo = dev.motivo;
    patch.desfechoEm = agora;
    patch.desfechoPor = dev.autorId;
    avisos.delete("devolucao_falhou");
    await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_confirmada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: [antes, "confirmada"] } });
  } else if ((situacao === "devolvido" || situacao === "devolvido_parcial") && desfecho === null && !dev) avisos.add("devolvido_por_fora");
  // Taxa que não voltou: só com o valor informado pelo provedor, lido depois da devolução.
  if (dev?.situacao === "confirmada" && dev.taxaPerdida === null) {
    if (f && f.taxa !== null) {
      await lancarTaxaPerdida(tx, organizacaoId, t, dev, f.taxa, agora);
      avisos.delete("taxa_perdida_desconhecida");
    } else avisos.add("taxa_perdida_desconhecida");
  }

  // Liberação: só o pagamento que confirmou a reserva, com ela confirmada e ainda aprovado, e só com o sinal explícito.
  if (f?.liberado === true) {
    if (desfecho === "reserva" && situacao === "aprovado") {
      const [r] = await tx.select().from(reservas).where(eq(reservas.id, t.reserva.id));
      if (r?.estado === "confirmada" && liquido !== null) {
        const res = await liberarPeloProvedor(tx, organizacaoId, p, r, liquido, f.liberacaoPrevista, agora);
        if (res.aviso) avisos.add(res.aviso);
        else for (const a of ["liberacao_divergente", "liberacao_futura"] as CodigoAviso[]) avisos.delete(a);
        if (res.confirmada && p.liberacaoOrigem !== "provedor") {
          patch.liberacaoConfirmadaEm = agora;
          patch.liberacaoOrigem = "provedor";
        }
      }
    } else if (!p.liberacaoConfirmadaEm) {
      // Liberação de tentativa sem a reserva: fica registrada só aqui, nunca no livro.
      patch.liberacaoConfirmadaEm = agora;
      patch.liberacaoOrigem = "provedor";
    }
  }

  if (situacao !== p.situacao) patch.situacao = situacao;
  patch.avisos = [...avisos];
  await tx.update(pagamentos).set(patch).where(eq(pagamentos.id, p.id));
  const mudou = situacao !== p.situacao || desfecho !== p.desfecho || motivoSemReserva !== p.motivoSemReserva;
  if (mudou) {
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: null,
      acao: "pagamento.situacao",
      entidade: "pagamento",
      entidadeId: p.id,
      mudancas: {
        ...(situacao !== p.situacao ? { situacao: [p.situacao, situacao] } : {}),
        ...(desfecho !== p.desfecho ? { desfecho: [p.desfecho, desfecho] } : {}),
        ...(motivoSemReserva !== p.motivoSemReserva ? { motivoSemReserva: [p.motivoSemReserva, motivoSemReserva] } : {}),
      },
    });
  }
  // A tentativa travada reflete o que foi gravado (a mesma transação pode aplicar mais de uma leitura).
  Object.assign(p, patch);
  efeitos.situacao = situacao;
  efeitos.mudou = mudou;
  return efeitos;
}
