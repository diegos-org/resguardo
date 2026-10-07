/** Preços do marketplace gravados na configuração da organização (chave `marketplace_precos`). */
import { gravarConfig, lerConfig, travarConfig } from "@/configuracoes/armazem";
import type { Db } from "@/db/types";
import { mesmosPesos, PESOS_PADRAO_ANTIGO, PRECOS_MARKETPLACE_PADRAO, type PrecosMarketplace, precosDeJson } from "./precos";

export async function lerPrecosMarketplace(db: Db, organizacaoId: string): Promise<PrecosMarketplace> {
  return precosDeJson(await lerConfig(db, organizacaoId, "marketplace_precos"));
}

/** Grava com auditoria; devolve se algo mudou. Vale para as cotações novas (as gravadas guardam o que mostraram). */
export async function salvarPrecosMarketplace(db: Db, organizacaoId: string, precos: PrecosMarketplace, autorId: string | null): Promise<boolean> {
  const mudancas = await db.transaction((tx) => gravarConfig(tx, organizacaoId, "marketplace_precos", { ...precos, pesos: { ...precos.pesos } }, autorId));
  return Object.keys(mudancas).length > 0;
}

/**
 * Os pesos gravados são o padrão antigo (1/1/1, de antes de 7/10)? Só quem gravou a configuração com eles: quem nunca
 * gravou já usa o padrão novo. O painel avisa e oferece o novo, sem trocar sozinho (M12.5).
 */
export async function pesosNoPadraoAntigo(db: Db, organizacaoId: string): Promise<boolean> {
  const gravado = await lerConfig(db, organizacaoId, "marketplace_precos");
  return gravado !== null && mesmosPesos(precosDeJson(gravado).pesos, PESOS_PADRAO_ANTIGO);
}

/**
 * Troca só os pesos pelo padrão atual, mantendo as taxas gravadas. Vale para as cotações novas. Lê as taxas depois de
 * travar a chave: uma gravação de taxas ao mesmo tempo não é desfeita.
 */
export async function usarPesosPadrao(db: Db, organizacaoId: string, autorId: string | null): Promise<boolean> {
  const mudancas = await db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "marketplace_precos");
    const atual = await lerPrecosMarketplace(tx, organizacaoId);
    return gravarConfig(tx, organizacaoId, "marketplace_precos", { ...atual, pesos: { ...PRECOS_MARKETPLACE_PADRAO.pesos } }, autorId);
  });
  return Object.keys(mudancas).length > 0;
}
