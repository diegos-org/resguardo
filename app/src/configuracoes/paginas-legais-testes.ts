/**
 * Só para testes (como `pagamentos/testes.ts`): publica a versão 1 das três páginas legais com o texto-base e dados de
 * empresa fictícios, gravando direto na configuração — sem mexer em Configurações → Empresa, para os testes que conferem
 * o contato da empresa não mudarem. O formato gravado é o mesmo de `publicarPaginaLegal`.
 */
import type { Db } from "@/db/types";
import { dataValida } from "@/reservas/regras";
import { gravarConfig } from "./armazem";
import { lerPaginasLegais } from "./paginas-legais";
import { RASCUNHO_PAGINAS_LEGAIS } from "./paginas-legais-rascunho";
import { type CampoLegal, conferirCampos, DOCUMENTOS_LEGAIS, PAGINAS_LEGAIS, type VersoesLegais } from "./paginas-legais-texto";

/** Dados de empresa fictícios congelados nas versões de teste. */
export const VALORES_LEGAIS_DE_TESTE: Partial<Record<CampoLegal, string>> = {
  nome_empresa: "Casa Exemplo",
  razao_social: "Casa Exemplo Temporada Ltda.",
  cnpj: "00.000.000/0001-00",
  endereco: "Rua Fictícia, 100, Rio de Janeiro, RJ",
  email_contato: "contato@example.com",
  telefone_contato: "(21) 90000-0000",
  encarregado: "Pessoa Exemplo",
};

/** Versão 1 de cada documento, datada de `hoje`. Recusa (erro) organização que já tem alguma versão publicada. */
export async function publicarPaginasLegaisDeTeste(db: Db, organizacaoId: string, hoje = "2026-10-01"): Promise<VersoesLegais> {
  if (!dataValida(hoje)) throw new Error("Data inválida.");
  const ja = await lerPaginasLegais(db, organizacaoId);
  if (DOCUMENTOS_LEGAIS.some((doc) => ja[doc].length)) throw new Error("A organização já tem páginas legais publicadas.");
  for (const doc of DOCUMENTOS_LEGAIS) {
    const base = RASCUNHO_PAGINAS_LEGAIS[doc];
    const regras = doc === "cancelamento" ? { diasReembolsoIntegral: base.diasReembolsoIntegral ?? 14 } : null;
    const valores = { ...VALORES_LEGAIS_DE_TESTE, ...(regras ? { dias_reembolso_integral: String(regras.diasReembolsoIntegral) } : {}) };
    const secoes = Object.fromEntries(PAGINAS_LEGAIS[doc].secoes.map((s) => [s.chave, base.secoes[s.chave] ?? ""]));
    const versao = { numero: 1, data: hoje, autorId: null, secoes, valores: conferirCampos(doc, secoes, valores).valoresUsados, regras };
    await gravarConfig(db, organizacaoId, PAGINAS_LEGAIS[doc].chave, { versoes: [versao] }, null, false);
  }
  return { termos: 1, privacidade: 1, cancelamento: 1 };
}
