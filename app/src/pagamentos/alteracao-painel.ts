/**
 * A alteração de reserva paga pelo site na ficha da reserva (M8.2d; desenho §9.2): a alteração segurada agora, as aplicadas
 * (com a devolução da diferença, o resultado no financeiro, as OTAs e as mensagens ao hóspede, já preenchidas para copiar),
 * as que venceram e as desistidas. Só leitura. Traz tudo; quem mostra decide o que cada permissão vê (valores, o motivo da
 * desistência e as mensagens com valor só com `financeiro:ler`). Nada daqui é gravado: as mensagens são montadas na hora.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  alteracoesReserva,
  type BaseCancelamento,
  type CanalPedidoAlteracao,
  type DireitoCancelamento,
  type MotivoCancelamentoEmpresa,
  type MotivoValorAlteracao,
  type OrigemValorAlteracao,
  pagamentos,
  type QuemPedeAlteracao,
  type ResultadoDaAlteracao,
  reservas,
  type SituacaoAlteracao,
  type SituacaoPagamento,
  usuarios,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { type MensagemPronta, mensagensDaAlteracao } from "@/mensagens/hospede";
import { FONTE_ALTERACAO } from "@/reservas/repositorio";
import { situacaoEfetiva, valorNovo } from "./alteracao-regras";
import { type AlteracaoParaHospede, alteracaoParaMensagem } from "./consultas";
import { carenciaNoTravado } from "./travas";

type Marca = { em: Date; por: string | null } | null;

/** Uma tentativa de pagamento da diferença (sem valores: o quadro do pagamento mostra os valores a quem lê o financeiro). */
export type TentativaDaDiferenca = { id: string; forma: "pix" | "cartao"; situacao: SituacaoPagamento; criadoEm: Date; desfecho: string | null };

export type AlteracaoDoPainel = {
  id: string;
  /** A situação que vale agora: a segurada cujo prazo e carência passaram aparece como vencida. */
  situacao: SituacaoAlteracao;
  quemPede: QuemPedeAlteracao;
  motivoEmpresa: MotivoCancelamentoEmpresa | null;
  canal: CanalPedidoAlteracao | null;
  pedidoRecebidoEm: Date;
  antes: { checkin: string; checkout: string; hospedes: number | null; valor: number };
  depois: { checkin: string; checkout: string; hospedes: number; valor: number };
  diferenca: number;
  /** O valor que a reserva guarda depois (`valorNovo`). */
  valorNovo: number;
  origemValor: OrigemValorAlteracao;
  motivoValor: MotivoValorAlteracao | null;
  noitesNovas: { inicio: string; fim: string } | null;
  holdAte: Date | null;
  /** O prazo das datas passou, mas um pagamento da diferença ainda as segura (carência). */
  emCarencia: boolean;
  criadaEm: Date;
  criadaPor: string | null;
  aplicadaEm: Date | null;
  /** Quem aplicou; null com `aplicadaEm` = o pagamento da diferença. */
  aplicadaPor: string | null;
  aplicadaTardia: boolean;
  expiradaEm: Date | null;
  desistidaEm: Date | null;
  desistidaPor: string | null;
  /** O motivo da desistência (nota da equipe): só para quem tem `financeiro:ler`. */
  desistenciaMotivo: string;
  direito: DireitoCancelamento | null;
  base: BaseCancelamento | null;
  valorADevolver: number | null;
  politicaVersao: number | null;
  integralAte: string | null;
  entradaDaPolitica: string;
  resultado: ResultadoDaAlteracao | null;
  ota: Marca;
  avisados: { proposta: Marca; confirmacao: Marca; devolucao: Marca };
  /** A devolução da diferença (as da alteração juntas, como a página do hóspede); null sem devolução. */
  devolucao: AlteracaoParaHospede["devolucao"];
  tentativas: TentativaDaDiferenca[];
  /** As mensagens prontas para copiar (a proposta enquanto segurada; a confirmação e a devolução feita depois de aplicada). */
  mensagens: { proposta: MensagemPronta | null; confirmada: MensagemPronta | null; devolvida: MensagemPronta | null };
};

const SEM_MENSAGENS = { proposta: null, confirmada: null, devolvida: null };

/** As alterações da reserva, da mais nova para a mais antiga (a segurada agora, quando há, é a primeira). */
export async function alteracoesDaReserva(db: Db, organizacaoId: string, reservaId: string, agora: Date = new Date()): Promise<AlteracaoDoPainel[]> {
  if (!uuidValido(reservaId)) return [];
  const linhas = await db
    .select()
    .from(alteracoesReserva)
    .where(and(eq(alteracoesReserva.organizacaoId, organizacaoId), eq(alteracoesReserva.reservaId, reservaId)))
    .orderBy(desc(alteracoesReserva.criadoEm), desc(alteracoesReserva.id));
  if (!linhas.length) return [];
  const tentativas = await db
    .select()
    .from(pagamentos)
    .where(and(eq(pagamentos.organizacaoId, organizacaoId), inArray(pagamentos.alteracaoId, linhas.map((a) => a.id))))
    .orderBy(desc(pagamentos.criadoEm), desc(pagamentos.id));
  const carencia = carenciaNoTravado({ tentativas }, agora);
  const ids = linhas.flatMap((a) => [a.criadaPor, a.aplicadaPor, a.desistidaPor, a.otaAtualizadaPor, a.hospedeAvisadoPropostaPor, a.hospedeAvisadoConfirmacaoPor, a.hospedeAvisadoDevolucaoPor]).filter((x): x is string => !!x);
  const nomes = new Map(
    (ids.length ? await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(and(eq(usuarios.organizacaoId, organizacaoId), inArray(usuarios.id, [...new Set(ids)]))) : []).map((u) => [u.id, u.nome]),
  );
  const nome = (id: string | null) => (id ? (nomes.get(id) ?? null) : null);
  const marca = (em: Date | null, por: string | null): Marca => (em ? { em, por: nome(por) } : null);
  const lista: AlteracaoDoPainel[] = [];
  for (const a of linhas) {
    const situacao = situacaoEfetiva(a, agora, carencia(a));
    // A devolução e as mensagens só nas que ainda falam com o hóspede (a segurada e as aplicadas).
    const vista = situacao === "aplicada" ? await alteracaoParaMensagem(db, organizacaoId, a.id, agora) : null;
    const mensagens = situacao === "segurada" || situacao === "aplicada" ? await mensagensDaAlteracao(db, organizacaoId, a.id, agora) : SEM_MENSAGENS;
    lista.push({
      id: a.id,
      situacao,
      quemPede: a.quemPede,
      motivoEmpresa: a.motivoEmpresa,
      canal: a.canal,
      pedidoRecebidoEm: a.pedidoRecebidoEm,
      antes: { checkin: a.checkinAntes, checkout: a.checkoutAntes, hospedes: a.hospedesAntes, valor: a.valorAntes },
      depois: { checkin: a.checkinDepois, checkout: a.checkoutDepois, hospedes: a.hospedesDepois, valor: a.valorDepois },
      diferenca: a.diferenca,
      valorNovo: valorNovo(a),
      origemValor: a.origemValor,
      motivoValor: a.motivoValor,
      noitesNovas: a.noitesNovasInicio && a.noitesNovasFim ? { inicio: a.noitesNovasInicio, fim: a.noitesNovasFim } : null,
      holdAte: a.holdAte,
      emCarencia: situacao === "segurada" && !!a.holdAte && a.holdAte.getTime() <= agora.getTime(),
      criadaEm: a.criadoEm,
      criadaPor: nome(a.criadaPor),
      aplicadaEm: a.aplicadaEm,
      aplicadaPor: nome(a.aplicadaPor),
      aplicadaTardia: a.aplicadaTardia,
      expiradaEm: a.expiradaEm ?? (situacao === "expirada" && a.situacao === "segurada" ? a.holdAte : null),
      desistidaEm: a.desistidaEm,
      desistidaPor: nome(a.desistidaPor),
      desistenciaMotivo: a.desistenciaMotivo,
      direito: a.direito,
      base: a.base,
      valorADevolver: a.valorADevolver,
      politicaVersao: a.politicaVersao,
      integralAte: a.integralAte,
      entradaDaPolitica: a.entradaDaPolitica,
      resultado: a.resultado,
      ota: marca(a.otaAtualizadaEm, a.otaAtualizadaPor),
      avisados: {
        proposta: marca(a.hospedeAvisadoPropostaEm, a.hospedeAvisadoPropostaPor),
        confirmacao: marca(a.hospedeAvisadoConfirmacaoEm, a.hospedeAvisadoConfirmacaoPor),
        devolucao: marca(a.hospedeAvisadoDevolucaoEm, a.hospedeAvisadoDevolucaoPor),
      },
      devolucao: vista?.devolucao ?? null,
      tentativas: tentativas.filter((t) => t.alteracaoId === a.id).map((t) => ({ id: t.id, forma: t.forma, situacao: t.situacao, criadoEm: t.criadoEm, desfecho: t.desfecho })),
      mensagens,
    });
  }
  return lista;
}

/**
 * A reserva-pedido que segura as novas noites de uma alteração (fonte "alteracao"): a reserva alterada, a alteração e o
 * prazo, para a ficha mostrar "Datas seguradas para a alteração da reserva …" no lugar das ações de uma reserva. null = não
 * é uma reserva-pedido de alteração (ou a alteração não é desta organização).
 */
export async function alteracaoDoPortador(
  db: Db,
  organizacaoId: string,
  r: { fonte: string; idFonte: string },
  agora: Date = new Date(),
): Promise<{ alteracaoId: string; reservaId: string; reservaCodigo: string; holdAte: Date | null; situacao: SituacaoAlteracao } | null> {
  if (r.fonte !== FONTE_ALTERACAO || !uuidValido(r.idFonte)) return null;
  const [x] = await db
    .select({ a: alteracoesReserva, codigo: reservas.codigo })
    .from(alteracoesReserva)
    .innerJoin(reservas, eq(reservas.id, alteracoesReserva.reservaId))
    .where(and(eq(alteracoesReserva.id, r.idFonte), eq(alteracoesReserva.organizacaoId, organizacaoId)));
  if (!x) return null;
  const tentativas = await db.select().from(pagamentos).where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.alteracaoId, x.a.id)));
  return { alteracaoId: x.a.id, reservaId: x.a.reservaId, reservaCodigo: x.codigo, holdAte: x.a.holdAte, situacao: situacaoEfetiva(x.a, agora, carenciaNoTravado({ tentativas }, agora)(x.a)) };
}
