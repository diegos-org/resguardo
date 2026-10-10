/**
 * O quadro do cancelamento pela política na ficha da reserva (M8.2c; desenho §9.3): o pedido, a decisão, o acerto no
 * livro, o desconto do proprietário, as OTAs, as mensagens ao hóspede (já preenchidas, para copiar) e os pedidos
 * descartados. Só leitura. Traz tudo; quem mostra decide o que cada permissão vê (valores e notas da decisão só com
 * `financeiro:ler`; as mensagens com `{valor}` também). Nada daqui é gravado: as mensagens são montadas na hora.
 */
import { and, asc, eq, inArray, isNull, lt, not } from "drizzle-orm";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import {
  type BaseCancelamento,
  type CalculoCancelamento,
  type CanalPedidoCancelamento,
  cancelamentosReserva,
  type DireitoCancelamento,
  imoveis,
  imoveisDetalhes,
  lancamentos,
  type MotivoCancelamentoEmpresa,
  type MotivoExcecao,
  type QuemCancelaReserva,
  repasseItens,
  repasses,
  reservas,
  type SituacaoCancelamento,
  usuarios,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { instanteLocal } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { type MensagemPronta, mensagensDoCancelamento } from "@/mensagens/hospede";
import { lancamentoEmVigor } from "@/portal/posse";
import { espelhoAnulaAParte, ORIGEM_CANCELAMENTO } from "@/repasses/descontos";

type Marca = { em: Date; por: string | null } | null;

export type CancelamentoDoPainel = {
  id: string;
  situacao: SituacaoCancelamento;
  pedidoRecebidoEm: Date;
  /** O momento registrado pela equipe, quando o financeiro o corrigiu ao cancelar (e o porquê). */
  pedidoRegistradoOriginalEm: Date | null;
  motivoMomento: string;
  canal: CanalPedidoCancelamento | null;
  /** Quem registrou o pedido (nome); null = o hóspede, em Minha reserva. */
  pedidoPor: string | null;
  quemCancela: QuemCancelaReserva;
  motivoEmpresa: MotivoCancelamentoEmpresa | null;
  motivoExcecao: MotivoExcecao | null;
  politicaVersao: number | null;
  integralAte: string | null;
  arrependimentoAte: string | null;
  /** O arrependimento valia só até a entrada (na versão aceita); null sem política. */
  arrependimentoAteEntrada: boolean | null;
  entradaEm: Date | null;
  calculado: CalculoCancelamento | null;
  direito: DireitoCancelamento | null;
  base: BaseCancelamento | null;
  /** Nota da exceção ou da decisão sem política: só para quem tem `financeiro:ler`. */
  motivoDecisao: string;
  nota: string;
  valorPago: number | null;
  valorADevolver: number | null;
  canceladaEm: Date | null;
  canceladaPor: string | null;
  resultadoLancadoEm: Date | null;
  espelhado: boolean;
  caixaLancadoEm: Date | null;
  ota: Marca;
  /** O desconto do proprietário (a parte já repassada que voltou ao hóspede): o valor e onde está. */
  descontos: { valor: number; situacao: { tipo: "a_descontar" } | { tipo: "descontado"; data: string } }[];
  avisados: { pedido: Marca; decisao: Marca; devolucao: Marca };
  descartados: { em: Date; canal: CanalPedidoCancelamento | null; motivo: string; por: string | null; descartadoEm: Date | null }[];
  mensagens: { recebido: MensagemPronta | null; decidido: MensagemPronta | null; devolvida: MensagemPronta | null };
};

/** O cancelamento ativo (pedido ou decidido) da reserva, com o histórico de descartados; null = nenhum. */
export async function cancelamentoDaReserva(db: Db, organizacaoId: string, reservaId: string, agora: Date = new Date()): Promise<CancelamentoDoPainel | null> {
  if (!uuidValido(reservaId)) return null;
  const linhas = await db
    .select()
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), eq(cancelamentosReserva.reservaId, reservaId)))
    .orderBy(asc(cancelamentosReserva.criadoEm));
  const c = linhas.find((x) => x.situacao === "pedido" || x.situacao === "cancelada");
  if (!c) return null;
  const descartadas = linhas.filter((x) => x.situacao === "descartado");
  const ids = [c.pedidoPor, c.canceladaPor, c.otaLiberadaPor, c.hospedeAvisadoPedidoPor, c.hospedeAvisadoDecisaoPor, c.hospedeAvisadoDevolucaoPor, ...descartadas.map((x) => x.descartadoPor)].filter((x): x is string => !!x);
  const nomes = new Map(
    (ids.length ? await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(and(eq(usuarios.organizacaoId, organizacaoId), inArray(usuarios.id, [...new Set(ids)]))) : []).map((u) => [u.id, u.nome]),
  );
  const nome = (id: string | null) => (id ? (nomes.get(id) ?? null) : null);
  const marca = (em: Date | null, por: string | null): Marca => (em ? { em, por: nome(por) } : null);
  // O desconto do proprietário desta reserva (a parte negativa em vigor que é desconto de verdade) e onde ele está.
  const negativas = await db
    .select({ id: lancamentos.id, valor: lancamentos.valor })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.reservaId, reservaId),
        eq(lancamentos.tipo, "direito_proprietario"),
        eq(lancamentos.origem, ORIGEM_CANCELAMENTO),
        lt(lancamentos.valor, 0),
        lancamentoEmVigor(db),
        not(espelhoAnulaAParte()),
      ),
    );
  const itens = negativas.length
    ? await db
        .select({ lancamentoId: repasseItens.lancamentoId, data: repasses.data })
        .from(repasseItens)
        .innerJoin(repasses, eq(repasses.id, repasseItens.repasseId))
        .where(and(inArray(repasseItens.lancamentoId, negativas.map((l) => l.id)), isNull(repasseItens.liberadoEm), isNull(repasses.estornadoEm)))
    : [];
  const descontos = negativas.map((l) => {
    const i = itens.find((x) => x.lancamentoId === l.id);
    return { valor: -l.valor, situacao: i ? { tipo: "descontado" as const, data: i.data } : { tipo: "a_descontar" as const } };
  });
  return {
    id: c.id,
    situacao: c.situacao,
    pedidoRecebidoEm: c.pedidoRecebidoEm,
    pedidoRegistradoOriginalEm: c.pedidoRegistradoOriginalEm,
    motivoMomento: c.motivoMomento,
    canal: c.canal,
    pedidoPor: nome(c.pedidoPor),
    quemCancela: c.quemCancela,
    motivoEmpresa: c.motivoEmpresa,
    motivoExcecao: c.motivoExcecao,
    politicaVersao: c.politicaVersao,
    integralAte: c.integralAte,
    arrependimentoAte: c.arrependimentoAte,
    arrependimentoAteEntrada: c.arrependimentoAteEntrada,
    entradaEm: c.entradaEm,
    calculado: c.calculado,
    direito: c.direito,
    base: c.base,
    motivoDecisao: c.motivoDecisao,
    nota: c.nota,
    valorPago: c.valorPago,
    valorADevolver: c.valorADevolver,
    canceladaEm: c.canceladaEm,
    canceladaPor: nome(c.canceladaPor),
    resultadoLancadoEm: c.resultadoLancadoEm,
    espelhado: c.espelhado,
    caixaLancadoEm: c.caixaLancadoEm,
    ota: marca(c.otaLiberadaEm, c.otaLiberadaPor),
    descontos,
    avisados: { pedido: marca(c.hospedeAvisadoPedidoEm, c.hospedeAvisadoPedidoPor), decisao: marca(c.hospedeAvisadoDecisaoEm, c.hospedeAvisadoDecisaoPor), devolucao: marca(c.hospedeAvisadoDevolucaoEm, c.hospedeAvisadoDevolucaoPor) },
    descartados: descartadas.map((x) => ({ em: x.pedidoRecebidoEm, canal: x.canal, motivo: x.descarteMotivo, por: nome(x.descartadoPor), descartadoEm: x.descartadoEm })),
    mensagens: await mensagensDoCancelamento(db, organizacaoId, reservaId, agora),
  };
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Os momentos que o formulário do cancelamento mostra: o horário de entrada da reserva (no fuso do imóvel; sem cadastro,
 * 15:00, como a regra) e a partir de quando o não comparecimento é aceito (a tolerância de Configurações → Pagamento no
 * site). null = reserva não encontrada.
 */
export async function momentosDoCancelamento(db: Db, organizacaoId: string, reservaId: string): Promise<{ entradaEm: Date; naoComparecimentoApos: Date; fuso: string } | null> {
  if (!uuidValido(reservaId)) return null;
  const [r] = await db
    .select({ checkin: reservas.checkin, fuso: imoveis.fuso, hora: imoveisDetalhes.checkinAPartirDe })
    .from(reservas)
    .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
    .leftJoin(imoveisDetalhes, eq(imoveisDetalhes.imovelId, imoveis.id))
    .where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)));
  if (!r) return null;
  const fuso = r.fuso || "America/Sao_Paulo";
  const entradaEm = instanteLocal(r.checkin, r.hora && HORA.test(r.hora) ? r.hora : "15:00", fuso);
  const horas = (await lerConfigPagamentoSite(db, organizacaoId)).naoComparecimentoHoras;
  return { entradaEm, naoComparecimentoApos: new Date(entradaEm.getTime() + horas * 3_600_000), fuso };
}
