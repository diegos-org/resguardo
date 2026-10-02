import { and, asc, eq, gt, gte, lt, lte } from "drizzle-orm";
import { beds24Calendario, bloqueios, idsExternos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { lerDetalhes, listarPeriodos, regrasDeVenda } from "@/imoveis/detalhes";
import { obterImovel } from "@/imoveis/repositorio";
import { somarDias } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";
import { montarPrevia, validarIntervaloPrevia } from "./previa";

/** Só usa dados já importados; nunca consulta APIs ou carrega contatos de hóspedes. */
export async function carregarPrevia(db: Db, org: string, imovelId: string, inicio: string, fim: string, agora = new Date()) {
  const erro = validarIntervaloPrevia(inicio, fim);
  if (erro) throw new Error(erro);
  const imovel = await obterImovel(db, org, imovelId);
  if (!imovel) return null;
  const fimExclusivo = somarDias(fim, 1);
  const [detalhes, periodos, observacoes, ocupantes, impedimentos, vinculos] = await Promise.all([
    lerDetalhes(db, org, imovelId), listarPeriodos(db, org, imovelId),
    db.select().from(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, org), eq(beds24Calendario.imovelId, imovelId), gte(beds24Calendario.data, inicio), lte(beds24Calendario.data, fim))).orderBy(asc(beds24Calendario.data)),
    db.select({ checkin: reservas.checkin, checkout: reservas.checkout, estado: reservas.estado }).from(reservas).where(and(eq(reservas.organizacaoId, org), eq(reservas.imovelId, imovelId), lt(reservas.checkin, fimExclusivo), gt(reservas.checkout, inicio))),
    db.select({ inicio: bloqueios.inicio, fim: bloqueios.fim }).from(bloqueios).where(and(eq(bloqueios.organizacaoId, org), eq(bloqueios.imovelId, imovelId), lt(bloqueios.inicio, fimExclusivo), gt(bloqueios.fim, inicio))),
    db.select({ propertyId: idsExternos.idExterno, roomId: idsExternos.detalhe }).from(idsExternos).where(and(eq(idsExternos.organizacaoId, org), eq(idsExternos.imovelId, imovelId), eq(idsExternos.canal, "beds24"))),
  ]);
  const regras = regrasDeVenda(detalhes);
  return { imovel, regras, vinculos, linhas: montarPrevia({ inicio, fim, hoje: hojeISO(imovel.fuso, agora), regras, periodos, observacoes, reservas: ocupantes, bloqueios: impedimentos }) };
}
