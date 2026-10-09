/**
 * Pagamento no site (M8.2a) — aplica uma leitura do provedor a uma tentativa, numa transação curta, com as travas
 * já tomadas (`travarCotacao`). Uma função só para todos os gatilhos (criação, aviso, página, rotina, painel):
 * transições (só por leitura do provedor; o desconhecido nunca sobrescreve), confirmação, taxa e motor, liberação,
 * devolução confirmada e avisos. Nada aqui chama o provedor; o que precisa de chamada (cancelar Pix que sobrou)
 * volta em `cancelar`, para quem chamou fazer depois da transação.
 */
import { and, eq, ne } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { devolucoesPagamento, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { decidirAprovacao } from "./confirmacao";
import { gravarTaxaNaReserva, liberarPeloProvedor, recebimentosDoPagamento } from "./liberacao";
import { type Cobranca, type DetalheFinanceiro, RETENCAO_ORDERS_DIAS } from "./provedor";
import { type CodigoAviso, comDinheiro, type SituacaoPagamento, situacaoLocal, transicaoPermitida } from "./situacoes";
import type { Pagamento, Travado } from "./travas";

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

export async function aplicarLeitura(tx: Db, organizacaoId: string, t: Travado, pagamentoId: string, leitura: Leitura, agora: Date): Promise<Efeitos> {
  const p = t.tentativas.find((x) => x.id === pagamentoId);
  if (!p) throw new Error("Tentativa fora da cotação travada.");
  const patch: Partial<Pagamento> = { consultadoEm: agora, atualizadoEm: agora };
  const avisos = new Set(p.avisos);
  // Avisos ligados por esta leitura: nenhum passo seguinte da mesma leitura os desliga.
  const ligados = new Set<CodigoAviso>();
  const ligar = (a: CodigoAviso) => {
    avisos.add(a);
    ligados.add(a);
  };
  const desligar = (a: CodigoAviso) => {
    if (!ligados.has(a)) avisos.delete(a);
  };
  const efeitos: Efeitos = { situacao: p.situacao, mudou: false, confirmou: false, cancelar: [] };
  let situacao: SituacaoPagamento = p.situacao;
  // O financeiro (taxa, líquido, liberação) vem da order lida: só vale se a order for desta tentativa (mais abaixo).
  let f = leitura.financeiro ?? null;

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
    } else if (p.idProvedor) {
      // Order mais velha que o prazo de consulta do provedor: "não encontrada" é o limite dele, não um problema.
      if (agora.getTime() - p.criadoEm.getTime() < RETENCAO_ORDERS_DIAS * 86_400_000) ligar("order_nao_encontrada");
    }
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
    if (!confere) {
      ligar("referencia_divergente");
      // Order de outra tentativa (ou outra referência): nada do financeiro dela entra aqui (taxa, líquido, liberação).
      f = null;
    } else {
      cobrancaAplicada = c;
      desligar("referencia_divergente");
      desligar("order_nao_encontrada");
      patch.detalheProvedor = c.detalhe.slice(0, 120);
      if (c.aoVivo !== null) patch.aoVivo = c.aoVivo;
      if (c.aoVivo === true) ligar("ao_vivo");
      if (c.pago !== null) patch.valorPago = c.pago;
      const nova = situacaoLocal(c.situacao);
      if (nova === null) ligar("situacao_desconhecida");
      else {
        desligar("situacao_desconhecida");
        // Contestado → devolvido só com um pedido de devolução aceito à espera: ele nunca para (nem com a contestação)
        // e a leitura que mostra o dinheiro devolvido é o que o confirma.
        const aceitaAEspera = t.devolucoes.some((x) => x.pagamentoId === p.id && x.situacao === "pedida" && x.chaveAceita);
        if (transicaoPermitida(situacao, nova) || (aceitaAEspera && situacao === "contestado" && nova === "devolvido")) situacao = nova;
      }
      if (situacao === "pendente" && c.pix) {
        // Uma leitura que não traz o prazo (ou a imagem, ou o link) não apaga o que já se sabia do mesmo Pix.
        patch.pixCopiaECola = c.pix.copiaECola || p.pixCopiaECola;
        patch.pixImagem = c.pix.imagemBase64 ?? p.pixImagem;
        patch.pixLink = c.pix.link ?? p.pixLink;
        patch.pixExpiraEm = c.pix.expiraEm ?? p.pixExpiraEm;
      }
    }
  }
  if (f) patch.financeiroConsultadoEm = agora;
  // Pix pendente com o copia e cola, mas sem prazo conhecido: aviso (nunca um prazo suposto).
  if (situacao === "pendente" && (patch.pixCopiaECola ?? p.pixCopiaECola) && !(patch.pixExpiraEm ?? p.pixExpiraEm)) ligar("pix_sem_prazo");
  else desligar("pix_sem_prazo");
  // Saiu do andamento (uma leitura ainda chegou, pelo "Conferir agora"): o aviso de fora do prazo não vale mais.
  if (situacao !== "criando" && situacao !== "incerta" && situacao !== "pendente") desligar("andamento_fora_do_prazo");
  // Pix pago, vencido ou cancelado: o copia e cola e a imagem saem do banco (o prazo fica, para o histórico).
  if (situacao !== "pendente" && situacao !== "criando" && situacao !== "incerta" && (p.pixCopiaECola || p.pixImagem || p.pixLink)) {
    patch.pixCopiaECola = null;
    patch.pixImagem = null;
    patch.pixLink = null;
  }
  if (situacao === "aprovado" && !p.aprovadoEm) patch.aprovadoEm = agora;
  const aoVivo = patch.aoVivo ?? p.aoVivo;
  if (situacao === "pendente" && aoVivo === true && (patch.idProvedor ?? p.idProvedor)) efeitos.cancelar.push({ id: p.id, idProvedor: (patch.idProvedor ?? p.idProvedor)! });

  // Taxa e líquido: a partir do líquido informado nesta leitura (taxa = valor − líquido), só enquanto aprovado. O
  // registrado à mão nunca muda sozinho (diferente = aviso); o do provedor é atualizado enquanto nenhum recebimento
  // foi lançado (depois disso, diferente = aviso, sem mexer).
  let taxa = p.taxa;
  let liquido = p.liquido;
  /** Líquido informado pelo provedor nesta leitura, válido: é ele que vira o recebimento (nunca o guardado). */
  let liquidoInformado: number | null = null;
  if (f?.liberacaoPrevista) patch.liberacaoPrevistaEm = f.liberacaoPrevista;
  if (f && f.liquido !== null && situacao === "aprovado") {
    const lida = p.valor - f.liquido;
    if (lida < 0 || f.liquido > p.valor) ligar("taxa_invalida");
    else {
      desligar("taxa_invalida");
      liquidoInformado = f.liquido;
      if (taxa === lida) {
        // O líquido lido bate com o gravado (do provedor ou registrado à mão): nada diverge no valor. Se esta mesma
        // leitura trouxer a liberação com outra data, o passo da liberação, mais abaixo, liga o aviso de novo.
        desligar("taxa_divergente");
        desligar("liberacao_divergente");
      } else if (p.liberacaoOrigem === "manual") ligar("liberacao_divergente");
      else if (taxa !== null && (await recebimentosDoPagamento(tx, organizacaoId, p.id)).emVigor.length) ligar("taxa_divergente");
      else {
        taxa = lida;
        liquido = f.liquido;
        patch.taxa = taxa;
        patch.liquido = liquido;
        desligar("taxa_divergente");
      }
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
  } else if (comDinheiro(situacao) && situacao !== "aprovado" && desfecho === null && motivoSemReserva === null) {
    // O dinheiro chegou já devolvido (no todo ou em parte) ou contestado, sem uma leitura "aprovado" antes: nunca
    // confirma sozinho. Fica sem reserva, com aviso, para a equipe resolver.
    motivoSemReserva = "situacao_inesperada";
    patch.motivoSemReserva = motivoSemReserva;
    ligar("situacao_inesperada");
  } else if (desfecho === "reserva" && taxa !== null && liquido !== null && p.liberacaoOrigem !== "manual" && (patch.taxa !== undefined || t.reserva.taxaCanal !== taxa)) {
    // Taxa conhecida (ou atualizada) depois da confirmação: entra na reserva e o motor roda (nessa ordem), antes de
    // qualquer recebimento desta leitura.
    await gravarTaxaNaReserva(tx, organizacaoId, t.reserva.id, taxa, liquido, null, p.id, agora);
  }

  // Devolução feita, contestação, ou devolução fora do sistema: só avisos (partes c e e cuidam da reserva).
  const dev = t.devolucoes.find((x) => x.pagamentoId === p.id);
  const devolvidoNoProvedor = situacao === "devolvido" || situacao === "devolvido_parcial";
  if (desfecho === "reserva" && devolvidoNoProvedor) ligar("devolvido_por_fora");
  // Devolvido (ou com devolução em andamento) no provedor e também registrado como devolvido por fora: em dobro.
  if (desfecho === "por_fora" && (devolvidoNoProvedor || (cobrancaAplicada !== null && (cobrancaAplicada.devolvido > 0 || cobrancaAplicada.devolucaoEmAndamento)))) ligar("devolucao_em_dobro");
  if (situacao === "contestado") ligar("contestado");
  // Pedida (ou dada por recusada depois de 3 recusas, mas que acabou saindo): a leitura confirma.
  if (situacao === "devolvido" && (dev?.situacao === "pedida" || dev?.situacao === "recusada") && desfecho === null) {
    const antes = dev.situacao;
    await tx.update(devolucoesPagamento).set({ situacao: "confirmada", confirmadaEm: agora, proximaTentativaEm: null, chaveEmDuvida: false, chaveAceita: false, atualizadoEm: agora }).where(eq(devolucoesPagamento.id, dev.id));
    dev.situacao = "confirmada";
    dev.confirmadaEm = agora;
    desfecho = "devolucao";
    patch.desfecho = "devolucao";
    patch.desfechoMotivo = dev.motivo;
    patch.desfechoEm = agora;
    patch.desfechoPor = dev.autorId;
    desligar("devolucao_falhou");
    desligar("devolucao_sem_confirmacao");
    desligar("devolucao_parada");
    desligar("devolucao_fora_do_prazo");
    await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_confirmada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: [antes, "confirmada"] } });
  } else if (devolvidoNoProvedor && desfecho === null && !dev) ligar("devolvido_por_fora");
  // Taxa que não voltou: o provedor não diz quanto da tarifa devolveu (a que ele informa é a da aprovação). Fica
  // pendente até a equipe informar no quadro do pagamento (nunca palpite).
  if (dev?.situacao === "confirmada" && dev.taxaPerdida === null) ligar("taxa_perdida_desconhecida");

  // Liberação: só o pagamento que confirmou a reserva, com ela confirmada e ainda aprovado, e só com o sinal explícito.
  if (f?.liberado === true) {
    if (desfecho === "reserva" && situacao === "aprovado") {
      const [r] = await tx.select().from(reservas).where(eq(reservas.id, t.reserva.id));
      if (r?.estado === "confirmada") {
        if (f.liquido === null) ligar("liberacao_sem_valor");
        else if (liquidoInformado !== null) {
          const res = await liberarPeloProvedor(tx, organizacaoId, p, r, liquidoInformado, f.liberacaoPrevista, agora);
          if (res.aviso) ligar(res.aviso);
          else for (const a of ["liberacao_divergente", "liberacao_futura", "liberacao_sem_valor"] as CodigoAviso[]) desligar(a);
          if (res.confirmada && p.liberacaoOrigem !== "provedor") {
            patch.liberacaoConfirmadaEm = agora;
            patch.liberacaoOrigem = "provedor";
          }
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
