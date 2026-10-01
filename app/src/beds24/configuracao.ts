import { and, asc, eq } from "drizzle-orm";
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import { idsExternos, imoveis, organizacoes } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { dataValida } from "@/reservas/regras";
import { ErroBeds24 } from "./tipos";

export type ConfigBeds24 = { automatica: boolean; desde: string; diasCalendario: number };

export async function lerConfigBeds24(db: Db, org: string): Promise<ConfigBeds24> {
  const c = await lerConfig(db, org, "beds24");
  return {
    automatica: c?.automatica === true,
    desde: typeof c?.desde === "string" && dataValida(c.desde) ? c.desde : hojeISO(),
    diasCalendario: typeof c?.diasCalendario === "number" && Number.isInteger(c.diasCalendario) && c.diasCalendario >= 1 && c.diasCalendario <= 365 ? c.diasCalendario : 180,
  };
}

export async function salvarConfigBeds24(db: Db, org: string, c: ConfigBeds24, autorId: string) {
  if (!dataValida(c.desde) || c.desde < "2000-01-01" || c.desde > hojeISO()) throw new ErroBeds24("Escolha uma data de início entre 01/01/2000 e hoje.", "configuracao");
  if (!Number.isInteger(c.diasCalendario) || c.diasCalendario < 1 || c.diasCalendario > 365) throw new ErroBeds24("Calendário: escolha entre 1 e 365 dias.", "configuracao");
  await db.transaction(tx => gravarConfig(tx, org, "beds24", { ...c }, autorId));
}

/** Credencial global só atende uma organização: nunca replicar hóspedes em todas. */
export async function organizacaoBeds24(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const orgs = await db.select({ id: organizacoes.id }).from(organizacoes);
  const id = env.BEDS24_ORGANIZACAO_ID?.trim();
  if (id && orgs.some(o => o.id === id)) return id;
  if (!id && orgs.length === 1) return orgs[0].id;
  throw new ErroBeds24("Com mais de uma organização, configure BEDS24_ORGANIZACAO_ID para identificar a empresa atendida por esta credencial.", "configuracao");
}

export function listarMapeamentosBeds24(db: Db, org: string) {
  return db.select({ id: idsExternos.id, imovelId: imoveis.id, codigo: imoveis.codigo, ativo: imoveis.ativo, propertyId: idsExternos.idExterno, roomId: idsExternos.detalhe })
    .from(idsExternos).innerJoin(imoveis, and(eq(imoveis.id, idsExternos.imovelId), eq(imoveis.organizacaoId, org)))
    .where(and(eq(idsExternos.organizacaoId, org), eq(idsExternos.canal, "beds24"))).orderBy(asc(imoveis.codigo));
}
