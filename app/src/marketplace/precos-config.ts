/** Preços do marketplace gravados na configuração da organização (chave `marketplace_precos`). */
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import type { Db } from "@/db/types";
import { type PrecosMarketplace, precosDeJson } from "./precos";

export async function lerPrecosMarketplace(db: Db, organizacaoId: string): Promise<PrecosMarketplace> {
  return precosDeJson(await lerConfig(db, organizacaoId, "marketplace_precos"));
}

/** Grava com auditoria; devolve se algo mudou. Vale para as cotações novas (as gravadas guardam o que mostraram). */
export async function salvarPrecosMarketplace(db: Db, organizacaoId: string, precos: PrecosMarketplace, autorId: string | null): Promise<boolean> {
  const mudancas = await db.transaction((tx) => gravarConfig(tx, organizacaoId, "marketplace_precos", { ...precos, pesos: { ...precos.pesos } }, autorId));
  return Object.keys(mudancas).length > 0;
}
