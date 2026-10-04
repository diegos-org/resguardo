/** Regras dos repasses por periodicidade gravadas na configuração da organização (chave `repasses_regras`). */
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import type { Db } from "@/db/types";
import { type RegrasRepasses, regrasDeJson } from "./periodicidade";

export async function lerRegrasRepasses(db: Db, organizacaoId: string): Promise<RegrasRepasses> {
  return regrasDeJson(await lerConfig(db, organizacaoId, "repasses_regras"));
}

/** Grava com auditoria; devolve se algo mudou. Vale dos próximos repasses em diante (nada já gerado muda). */
export async function salvarRegrasRepasses(db: Db, organizacaoId: string, regras: RegrasRepasses, autorId: string | null): Promise<boolean> {
  const mudancas = await db.transaction((tx) => gravarConfig(tx, organizacaoId, "repasses_regras", { diaSemanal: regras.diaSemanal, diasQuinzenal: [...regras.diasQuinzenal], padraoPorContrato: { ...regras.padraoPorContrato } }, autorId));
  return Object.keys(mudancas).length > 0;
}
