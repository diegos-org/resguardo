/**
 * Configuração do WhatsApp (M10.1a, desenho na seção "Tabelas e configuração" de `requisitos/product/WHATSAPP.md`), no
 * armazém de configurações (chave `whatsapp`, sem migração, com a auditoria automática `configuracao.whatsapp`). Só
 * `configWhatsapp` interpreta o valor; as buscas por WABA e por número usam o mesmo critério (`campoEm`).
 * - `wabaId` e `numeroId`: os ids da Meta (a conta do WhatsApp Business e o número), editados em Configurações →
 *   Integrações → WhatsApp. São números do painel de desenvolvedores, não senhas; ficam só no banco, nunca no Git. A
 *   rota do aviso acha a organização pela WABA (`organizacaoDaConta`) e confere o número.
 * - `quemVeConversas`: decisão de Diego em 17/10 — padrão "só o admin"; "admin e operação" libera à operação. Quem
 *   decide o acesso é `whatsapp/acesso.ts`, que lê daqui.
 * Deny-by-default: valor torto conta como o lado seguro (id que não é número da Meta vira null; "quem vê" desconhecido
 * vira "só o admin"). Sem `appId` no M10.1a: nada aqui usa o id do app (a assinatura usa o segredo); o M10.1b o
 * acrescenta na mesma chave, sem migração.
 */
import { and, eq, inArray, ne, type SQL, sql } from "drizzle-orm";
import { exigir, type Sessao } from "@/acesso/politica";
import { gravarConfig, lerConfig, travarConfig } from "@/configuracoes/armazem";
import { configuracoes } from "@/db/schema";
import type { Db } from "@/db/types";
import { ID_META } from "./regras";

export const QUEM_VE_CONVERSAS = ["so_admin", "admin_e_operacao"] as const;
export type QuemVeConversas = (typeof QUEM_VE_CONVERSAS)[number];
export const QUEM_VE_PADRAO: QuemVeConversas = "so_admin";

export type ConfigWhatsapp = { wabaId: string | null; numeroId: string | null; quemVeConversas: QuemVeConversas };

/**
 * Trava global da WABA, tomada antes da trava da chave (sempre nesta ordem): duas empresas salvando a mesma WABA ao
 * mesmo tempo não passam as duas pela conferência de "outra empresa". `salvarQuemVeConversas` não a toma (não mexe nos
 * ids), então não há ordem inversa.
 */
const TRAVA_WABA = "whatsapp:waba";

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const idMeta = (v: unknown): string | null => (typeof v === "string" && ID_META.test(v) ? v : null);
const quemVeValido = (v: unknown): v is QuemVeConversas => typeof v === "string" && (QUEM_VE_CONVERSAS as readonly string[]).includes(v);

/** Puro, lado seguro: id fora de `ID_META` vira null; "quem vê" fora da lista vira "so_admin"; chave desconhecida é descartada. */
export function configWhatsapp(valor: unknown): ConfigWhatsapp {
  const c = ehObj(valor) ? valor : {};
  return { wabaId: idMeta(c.wabaId), numeroId: idMeta(c.numeroId), quemVeConversas: quemVeValido(c.quemVeConversas) ? c.quemVeConversas : QUEM_VE_PADRAO };
}

/** A leitura da configuração de uma organização (o valor passa por `configWhatsapp`). */
export async function lerConfigWhatsapp(db: Db, organizacaoId: string): Promise<ConfigWhatsapp> {
  return configWhatsapp(await lerConfig(db, organizacaoId, "whatsapp"));
}

/**
 * `valor->>campo` igual a um dos valores, só quando o campo foi gravado como texto: a mesma regra de `configWhatsapp`
 * (um número gravado torto não identifica conta nenhuma). O nome do campo vem de uma lista fechada, nunca de texto.
 */
const CAMPO: Record<"wabaId" | "numeroId", SQL> = { wabaId: sql`'wabaId'`, numeroId: sql`'numeroId'` };
const campoEm = (campo: "wabaId" | "numeroId", valores: string[]) =>
  and(sql`jsonb_typeof(${configuracoes.valor} -> ${CAMPO[campo]}) = 'string'`, inArray(sql`${configuracoes.valor} ->> ${CAMPO[campo]}`, valores));

/**
 * Id digitado no formulário: null ou texto vazio = null (apagar); número da Meta = ele; qualquer outra coisa (texto
 * torto, `undefined`, número, arquivo, objeto) = undefined (recusado, nunca vira null). Confere em tempo de execução:
 * o tipo `string | null` só protege em tempo de compilação, e um valor torto vindo da ação não pode apagar a WABA.
 */
function idDigitado(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return null;
  return ID_META.test(t) ? t : undefined;
}

/**
 * Grava os ids da Meta (WABA e número), mantendo "quem vê". Exige `configuracao:editar`. Numa transação: a trava global
 * da WABA, a trava da chave, o valor atual relido debaixo delas (ler antes, fora da transação, deixaria uma gravação
 * apagar a outra), a conferência de que nenhuma outra organização tem a mesma WABA e a gravação (auditada, com o autor).
 * Id que não é número da Meta (até 25 dígitos), ou valor que não é texto nem null → `id_invalido`, sem gravar (nunca
 * vira "apagar").
 */
export async function salvarIdsWhatsapp(
  db: Db,
  sessao: Sessao,
  ids: { wabaId: string | null; numeroId: string | null },
): Promise<"salvo" | "sem_mudanca" | "waba_de_outra_empresa" | "id_invalido"> {
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  const wabaId = idDigitado(ids.wabaId);
  const numeroId = idDigitado(ids.numeroId);
  if (wabaId === undefined || numeroId === undefined) return "id_invalido";
  const org = sessao.organizacaoId;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${TRAVA_WABA}))`);
    await travarConfig(tx, org, "whatsapp");
    const atual = await lerConfigWhatsapp(tx, org);
    if (atual.wabaId === wabaId && atual.numeroId === numeroId) return "sem_mudanca";
    if (wabaId) {
      const [outra] = await tx
        .select({ organizacaoId: configuracoes.organizacaoId })
        .from(configuracoes)
        .where(and(eq(configuracoes.chave, "whatsapp"), ne(configuracoes.organizacaoId, org), campoEm("wabaId", [wabaId])))
        .limit(1);
      if (outra) return "waba_de_outra_empresa";
    }
    const mudancas = await gravarConfig(tx, org, "whatsapp", { ...atual, wabaId, numeroId }, sessao.usuarioId);
    return Object.keys(mudancas).length ? "salvo" : "sem_mudanca";
  });
}

/** Grava só "quem vê as conversas" (mantém os ids). Exige `configuracao:editar`; o atual é relido debaixo da trava da chave. */
export async function salvarQuemVeConversas(db: Db, sessao: Sessao, quem: QuemVeConversas): Promise<"salvo" | "sem_mudanca"> {
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  // Valor fora da lista nunca chega a gravar: lança como qualquer pedido torto (a ação já confere a lista antes).
  if (!quemVeValido(quem)) throw new TypeError("Quem vê as conversas: valor fora da lista.");
  const org = sessao.organizacaoId;
  return db.transaction(async (tx) => {
    await travarConfig(tx, org, "whatsapp");
    const atual = await lerConfigWhatsapp(tx, org);
    if (atual.quemVeConversas === quem) return "sem_mudanca";
    const mudancas = await gravarConfig(tx, org, "whatsapp", { ...atual, quemVeConversas: quem }, sessao.usuarioId);
    return Object.keys(mudancas).length ? "salvo" : "sem_mudanca";
  });
}

/** A organização cuja configuração casa com o filtro, só se for exatamente uma; nenhuma ou mais de uma = null. */
async function organizacaoUnica(db: Db, filtro: SQL | undefined): Promise<{ organizacaoId: string; config: ConfigWhatsapp } | null> {
  const linhas = await db
    .select({ organizacaoId: configuracoes.organizacaoId, valor: configuracoes.valor })
    .from(configuracoes)
    .where(and(eq(configuracoes.chave, "whatsapp"), filtro))
    .limit(3);
  if (new Set(linhas.map((l) => l.organizacaoId)).size !== 1) return null;
  return { organizacaoId: linhas[0].organizacaoId, config: configWhatsapp(linhas[0].valor) };
}

/**
 * A rota: a organização dona da conta, pela WABA (`entry.id` e, no account_update, `waba_info.waba_id`). Só aceita
 * exatamente uma organização; zero ou mais de uma = null (a rota conta em `outra_conta`).
 */
export async function organizacaoDaConta(db: Db, wabaIds: readonly string[]): Promise<{ organizacaoId: string; config: ConfigWhatsapp } | null> {
  const ids = [...new Set(wabaIds.filter((w) => typeof w === "string" && ID_META.test(w)))];
  if (!ids.length) return null;
  return organizacaoUnica(db, campoEm("wabaId", ids));
}

/**
 * Só para o aviso de histórico recusado que chega sem o envelope (seção "Leitura dos avisos" de
 * `requisitos/product/WHATSAPP.md`): a organização cuja configuração tem esse `numeroId`. Mesma regra: exatamente uma,
 * senão null.
 */
export async function organizacaoDoNumero(db: Db, numeroId: string): Promise<{ organizacaoId: string; config: ConfigWhatsapp } | null> {
  if (typeof numeroId !== "string" || !ID_META.test(numeroId)) return null;
  return organizacaoUnica(db, campoEm("numeroId", [numeroId]));
}
