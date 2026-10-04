/**
 * Regras dos repasses por periodicidade gravadas na configuração da organização (chave `repasses_regras`) e o
 * início do sistema para valer (chave `inicio_sistema`, M4.11).
 */
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import type { Db } from "@/db/types";
import { dataValida } from "@/reservas/regras";
import { type RegrasRepasses, regrasDeJson } from "./periodicidade";

export async function lerRegrasRepasses(db: Db, organizacaoId: string): Promise<RegrasRepasses> {
  return regrasDeJson(await lerConfig(db, organizacaoId, "repasses_regras"));
}

/** Grava com auditoria; devolve se algo mudou. Vale dos próximos repasses em diante (nada já gerado muda). */
export async function salvarRegrasRepasses(db: Db, organizacaoId: string, regras: RegrasRepasses, autorId: string | null): Promise<boolean> {
  const mudancas = await db.transaction((tx) => gravarConfig(tx, organizacaoId, "repasses_regras", { diaSemanal: regras.diaSemanal, diasQuinzenal: [...regras.diasQuinzenal], padraoPorContrato: { ...regras.padraoPorContrato } }, autorId));
  return Object.keys(mudancas).length > 0;
}

/** O início do sistema é sempre o dia 1º de um mês: as partes de reserva são por mês, então um corte no meio do mês não existe. */
export const inicioDoSistemaValido = (d: string): boolean => dataValida(d) && d.endsWith("-01");

/** Data a partir da qual o sistema vale (decisão de Diego, 4/10/2026: 1/10/2026); null = não definida. */
export async function lerInicioDoSistema(db: Db, organizacaoId: string): Promise<string | null> {
  const v = await lerConfig(db, organizacaoId, "inicio_sistema");
  const data = typeof v?.data === "string" ? v.data : "";
  return inicioDoSistemaValido(data) ? data : null;
}

/** Grava (ou apaga, com data vazia) o início do sistema, com auditoria. Nunca no futuro: marcaria como acertado o que ainda nem aconteceu. */
export async function salvarInicioDoSistema(db: Db, organizacaoId: string, data: string, hoje: string, autorId: string | null): Promise<{ ok: true; mudou: boolean } | { ok: false; erro: string }> {
  const d = data.trim();
  if (d && !dataValida(d)) return { ok: false, erro: "Data inválida." };
  if (d && !d.endsWith("-01")) return { ok: false, erro: "O início do sistema é sempre o dia 1º de um mês: as partes de reserva são por mês." };
  if (d && d > hoje) return { ok: false, erro: "O início do sistema não pode ser no futuro." };
  const mudancas = await db.transaction((tx) => gravarConfig(tx, organizacaoId, "inicio_sistema", { data: d }, autorId));
  return { ok: true, mudou: Object.keys(mudancas).length > 0 };
}
