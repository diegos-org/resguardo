/**
 * Regras em vigor (M1.6): para cada imóvel, o contrato vigente (e o próximo, se houver),
 * o proprietário e quem recebe em cada canal — tudo lido dos mesmos lugares que o motor
 * usa, para a página mostrar exatamente o que vale.
 */
import { eq } from "drizzle-orm";
import { bpParaTexto, contratoVigente, NOMES_TIPO } from "@/contratos/regras";
import { listarContratos } from "@/contratos/repositorio";
import { ORIGENS_RESERVA, type OrigemReserva, proprietarioImoveis, proprietarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { lerRegrasFinanceiras } from "@/configuracoes/regras-financeiras";
import { lerRecebimento } from "@/imoveis/recebimento";
import { listarImoveis } from "@/imoveis/repositorio";

export type RecebimentoEfetivo = { origem: OrigemReserva; valor: "split" | "empresa" | "a_confirmar"; fonte: "imovel" | "padrao" };

export type RegrasImovel = {
  imovelId: string;
  codigo: string;
  nome: string;
  proprietario: string | null;
  contrato: string | null;
  proximoContrato: string | null;
  recebimento: RecebimentoEfetivo[];
};

export async function regrasEmVigor(db: Db, organizacaoId: string, hoje: string): Promise<RegrasImovel[]> {
  const [lista, padrao] = await Promise.all([listarImoveis(db, organizacaoId), lerRegrasFinanceiras(db, organizacaoId)]);
  const saida: RegrasImovel[] = [];
  for (const im of lista) {
    const [contratos, config, donos] = await Promise.all([
      listarContratos(db, organizacaoId, im.id),
      lerRecebimento(db, organizacaoId, im.id),
      db
        .select({ nome: proprietarios.nome })
        .from(proprietarioImoveis)
        .innerJoin(proprietarios, eq(proprietarios.id, proprietarioImoveis.proprietarioId))
        .where(eq(proprietarioImoveis.imovelId, im.id)),
    ]);
    const vigente = contratoVigente(contratos, hoje);
    const proximo = contratos.filter((c) => c.inicio > hoje).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
    const texto = (c: { tipo: keyof typeof NOMES_TIPO; comissaoBp: number | null }) => `${NOMES_TIPO[c.tipo]} · ${bpParaTexto(c.comissaoBp)}`;
    saida.push({
      imovelId: im.id,
      codigo: im.codigo,
      nome: im.nome,
      proprietario: donos[0]?.nome ?? null,
      contrato: vigente ? texto(vigente) : null,
      proximoContrato: proximo ? `${texto(proximo)} a partir de ${proximo.inicio.split("-").reverse().join("/")}` : null,
      recebimento: ORIGENS_RESERVA.map((origem) => ({
        origem,
        valor: config[origem] ?? padrao.recebimento[origem],
        fonte: config[origem] ? ("imovel" as const) : ("padrao" as const),
      })),
    });
  }
  return saida;
}
