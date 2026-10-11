/**
 * A disputa do pagamento no portal do proprietário (M8.2e; desenho "O que o proprietário vê"): só o que o atinge — a reserva
 * em conferência, o valor segurado e o desconto definitivo ou devolvido, a causa e a explicação ao proprietário (quando a
 * equipe escreveu). Lista branca de campos: nunca a nota interna, o número do caso, o motivo do Mercado Pago, o tipo de
 * pagamento ou qualquer dado do hóspede (nas linhas da disputa, só o código da reserva).
 *
 * Deny-by-default: as disputas das reservas dos donos (`reservaDosDonos`) **e** cujas linhas do motor (a parte do
 * proprietário) são desses donos — nunca pelo dono atual do imóvel: um proprietário novo não vê a disputa de uma reserva
 * do dono de antes, nem o dono de outro imóvel. A possível duplicata ainda não confirmada e a disputa que não segura nada
 * (valor em risco 0, sem decisão) não o atingem: ficam de fora.
 */
import { and, asc, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { contestacoesPagamento, imoveis, lancamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { reservaDosDonos } from "@/portal/posse";
import { type CodigoCausaContestacao, contestacaoNaoFinal, MOTIVO_PARTE_EM_CONFERENCIA, ROTULO_DISPUTA_PROPRIETARIO, type SituacaoContestacao } from "./contestacao-regras";

/** Uma disputa como o proprietário a vê (lista branca). */
export type ContestacaoDoProprietario = {
  /** A linha (para a chave da lista na tela). */
  id: string;
  reservaCodigo: string;
  imovelCodigo: string;
  /** "Disputa do pagamento". */
  rotulo: string;
  /** em_conferencia: sem decisão de quem arca (a parte espera); segurado; definitivo; devolvido; sem_efeito. */
  variante: "em_conferencia" | "segurado" | "definitivo" | "devolvido" | "sem_efeito";
  /** O texto da linha, só com o código da reserva. */
  texto: string;
  /** O valor do proprietário na decisão em vigor (segurado ou definitivo); null sem decisão. */
  valor: number | null;
  /** O nome da causa registrada (Configurações → Pagamento no site); null sem decisão. */
  causa: string | null;
  /** A explicação ao proprietário escrita pela equipe (pode ser vazia). */
  explicacao: string;
};

const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** A variante e o texto da disputa para o proprietário (puro). */
export function disputaParaOProprietario(l: {
  reservaCodigo: string;
  situacao: SituacaoContestacao;
  decisaoVersao: number;
  definitivoEm: Date | null;
  parteProprietario: number | null;
  resultadoEm: string | null;
  causa: string | null;
  explicacao: string;
}): { variante: ContestacaoDoProprietario["variante"]; texto: string } {
  const inicio = `${ROTULO_DISPUTA_PROPRIETARIO} da reserva ${l.reservaCodigo}`;
  const causa = l.causa ? ` Causa registrada: ${l.causa}.` : "";
  const explicacao = l.explicacao.trim() ? ` ${l.explicacao.trim().replace(/([^.!?])$/, "$1.")}` : "";
  const valor = l.parteProprietario ?? 0;
  const quando = l.resultadoEm ? ` em ${dataBr(l.resultadoEm)}` : "";
  if (l.situacao === "sem_efeito") return { variante: "sem_efeito", texto: `${inicio}: encerrada sem efeito; nada fica descontado de você.` };
  if (l.decisaoVersao === 0) {
    if (l.situacao === "ganha") return { variante: "devolvido", texto: `${inicio}: a SCL ganhou a disputa${quando}; nada foi descontado de você.` };
    // Perdida sem nada a dividir (a perda coberta pela devolução que a disputa substituiu): definitiva sem decisão.
    if (l.situacao === "perdida" && l.definitivoEm !== null) return { variante: "definitivo", texto: `${inicio}: nada descontado de você (a SCL perdeu a disputa${quando}).` };
    return { variante: "em_conferencia", texto: `${inicio}: em conferência. ${MOTIVO_PARTE_EM_CONFERENCIA}` };
  }
  if (l.situacao === "ganha") return { variante: "devolvido", texto: `${inicio}: ${valor > 0 ? `valor segurado devolvido (${formatBRL(valor)})` : "nada descontado de você"} — a SCL ganhou a disputa${quando}.${causa}${explicacao}` };
  if (l.situacao === "perdida") return { variante: "definitivo", texto: `${inicio}: ${valor > 0 ? `desconto definitivo de ${formatBRL(valor)}` : "nada descontado de você"} (a SCL perdeu a disputa${quando}).${causa}${explicacao}` };
  return {
    variante: "segurado",
    texto: `${inicio}: ${valor > 0 ? `${formatBRL(valor)} segurados dos seus próximos repasses até o resultado. Se a SCL ganhar a disputa, o valor volta no repasse seguinte.` : "pela decisão registrada, nada é descontado de você."}${causa}${explicacao}`,
  };
}

/**
 * As disputas que atingem os proprietários dados (os da sessão, resolvidos no servidor por quem chama), da mais nova para a
 * mais antiga. `imovelIds` restringe aos imóveis escolhidos no portal (opcional).
 */
export async function contestacoesDoProprietario(db: Db, organizacaoId: string, o: { proprietarioIds: readonly string[]; imovelIds?: readonly string[] }): Promise<ContestacaoDoProprietario[]> {
  const donos = o.proprietarioIds.filter(uuidValido);
  if (!donos.length) return [];
  const imovelIds = o.imovelIds?.filter(uuidValido);
  if (imovelIds && !imovelIds.length) return [];
  // A parte do proprietário desta reserva (as linhas do motor) é de um destes donos.
  const doMotorDosDonos = exists(
    db
      .select({ um: sql`1` })
      .from(lancamentos)
      .where(and(eq(lancamentos.reservaId, reservas.id), eq(lancamentos.origem, "motor"), eq(lancamentos.tipo, "direito_proprietario"), inArray(lancamentos.proprietarioId, donos), isNull(lancamentos.estornoDe))),
  );
  const linhas = await db
    .select({
      id: contestacoesPagamento.id,
      situacao: contestacoesPagamento.situacao,
      duplicataPossivel: contestacoesPagamento.duplicataPossivel,
      valorEmRisco: contestacoesPagamento.valorEmRisco,
      decisaoVersao: contestacoesPagamento.decisaoVersao,
      definitivoEm: contestacoesPagamento.definitivoEm,
      parteProprietario: contestacoesPagamento.parteProprietario,
      resultadoEm: contestacoesPagamento.resultadoEm,
      causa: contestacoesPagamento.causa,
      explicacao: contestacoesPagamento.explicacaoProprietario,
      reservaCodigo: reservas.codigo,
      imovelCodigo: imoveis.codigo,
    })
    .from(contestacoesPagamento)
    .innerJoin(reservas, and(eq(reservas.id, contestacoesPagamento.reservaId), eq(reservas.organizacaoId, contestacoesPagamento.organizacaoId)))
    .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
    .where(
      and(
        eq(contestacoesPagamento.organizacaoId, organizacaoId),
        reservaDosDonos(db, donos),
        doMotorDosDonos,
        imovelIds ? inArray(reservas.imovelId, imovelIds) : undefined,
      ),
    )
    .orderBy(asc(contestacoesPagamento.abertaEm), asc(contestacoesPagamento.rodada));
  if (!linhas.length) return [];
  const causas = (await lerConfigPagamentoSite(db, organizacaoId)).causasContestacao;
  return linhas
    .filter((l) => !(l.duplicataPossivel && contestacaoNaoFinal(l.situacao)))
    .filter((l) => l.decisaoVersao > 0 || l.valorEmRisco > 0 || (l.situacao === "perdida" && l.definitivoEm === null))
    .map((l) => {
      const causa = l.causa ? (causas[l.causa as CodigoCausaContestacao]?.nome ?? null) : null;
      const v = disputaParaOProprietario({ ...l, causa });
      return { id: l.id, reservaCodigo: l.reservaCodigo, imovelCodigo: l.imovelCodigo, rotulo: ROTULO_DISPUTA_PROPRIETARIO, variante: v.variante, texto: v.texto, valor: l.decisaoVersao > 0 ? (l.parteProprietario ?? 0) : null, causa, explicacao: l.explicacao };
    })
    .reverse();
}
