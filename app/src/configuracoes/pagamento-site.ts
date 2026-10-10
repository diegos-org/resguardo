/**
 * Pagamento no site (M8.2a): regras de venda editáveis no painel (Configurações → Pagamento no site), num
 * lugar só. `oferecer` liga e desliga o pagamento para as tentativas novas (o que já foi pago continua sendo
 * conferido) e começa DESLIGADO (deny-by-default: o Diego liga na aba, auditado); `nomeFatura` é o nome que aparece na fatura do cartão (vazio = o nome da empresa); a categoria da
 * taxa perdida recebe a despesa da taxa que o provedor não devolve (criada no primeiro uso, editável depois).
 * Cartão (M8.2b): `cartao` começa DESLIGADO e só vale com `oferecer`; `parcelasMaximas` null = o máximo que o
 * Mercado Pago permitir (juros pagos pelo hóspede); `tresDS` = a verificação do banco pedida em cada cartão novo.
 * Tudo auditado, valendo para as tentativas novas.
 */
import { and, eq, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { categoriasDespesa } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { type ModoTresDS, MODOS_TRES_DS, PARCELAS_MAXIMAS } from "@/pagamentos/provedor";
import { gravarConfig, lerConfig, travarConfig } from "./armazem";
import { nomeDaEmpresa } from "./empresa";

export type ConfigPagamentoSite = {
  oferecer: boolean;
  nomeFatura: string | null;
  categoriaTaxaId: string | null;
  /** Oferecer cartão de crédito (além do Pix). */
  cartao: boolean;
  /** 1 a 36; null = o máximo que o Mercado Pago permitir. */
  parcelasMaximas: number | null;
  /** Verificação do banco (3DS) pedida nos cartões novos. */
  tresDS: ModoTresDS;
};
export type ErrosPagamentoSite = Partial<Record<keyof ConfigPagamentoSite, string>>;

export const CONFIG_PAGAMENTO_SITE_PADRAO: ConfigPagamentoSite = { oferecer: false, nomeFatura: null, categoriaTaxaId: null, cartao: false, parcelasMaximas: null, tresDS: "on_fraud_risk" };
/** Textos das opções da verificação do banco (3DS) no painel. */
export const TEXTOS_TRES_DS: Record<ModoTresDS, string> = {
  on_fraud_risk:
    "Quando houver risco (recomendado): o banco pede a verificação só nos pagamentos arriscados; quando o hóspede passa pela verificação, a contestação por cartão roubado fica com a bandeira; nos outros pagamentos, continua com a SCL",
  never: "Nunca: nenhuma verificação; toda contestação por cartão roubado fica com a SCL",
};
export const ERRO_PARCELAS_MAXIMAS = `Use um número de 1 a ${PARCELAS_MAXIMAS} (vazio = o máximo que o Mercado Pago permitir).`;
/** O provedor aceita mais, mas a fatura mostra poucos caracteres (o painel mostra a prévia). */
export const LIMITE_NOME_FATURA = 22;
/** Quantos caracteres do nome costumam aparecer na fatura do cartão. */
export const CARACTERES_VISIVEIS_FATURA = 10;
/** Nome da categoria criada no primeiro uso, quando nenhuma foi escolhida. */
export const CATEGORIA_TAXA_PERDIDA = "Taxa do pagamento do site";

const ligado = (v: unknown) => v === true || v === "on" || v === "true" || v === "1";
const parcelasValidas = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= PARCELAS_MAXIMAS;
const modoTresDS = (v: unknown): v is ModoTresDS => typeof v === "string" && (MODOS_TRES_DS as readonly string[]).includes(v);

/** Valor gravado → configuração; campo ausente ou estranho volta ao padrão (nunca inventa dado). */
export function configDeJson(v: Record<string, unknown> | null): ConfigPagamentoSite {
  const c = v ?? {};
  return {
    oferecer: typeof c.oferecer === "boolean" ? c.oferecer : CONFIG_PAGAMENTO_SITE_PADRAO.oferecer,
    nomeFatura: typeof c.nomeFatura === "string" && c.nomeFatura.trim() ? c.nomeFatura.trim().slice(0, LIMITE_NOME_FATURA) : null,
    categoriaTaxaId: uuidValido(c.categoriaTaxaId) ? c.categoriaTaxaId : null,
    cartao: typeof c.cartao === "boolean" ? c.cartao : CONFIG_PAGAMENTO_SITE_PADRAO.cartao,
    parcelasMaximas: parcelasValidas(c.parcelasMaximas) ? c.parcelasMaximas : CONFIG_PAGAMENTO_SITE_PADRAO.parcelasMaximas,
    tresDS: modoTresDS(c.tresDS) ? c.tresDS : CONFIG_PAGAMENTO_SITE_PADRAO.tresDS,
  };
}

/**
 * Formulário do painel → configuração. Nome na fatura: letras, números, espaço, ponto e hífen. Parcelas: vazio = o
 * máximo do Mercado Pago, senão inteiro de 1 a 36. Verificação do banco: uma das opções (sem o campo, a recomendada).
 */
export function validarConfigPagamentoSite(bruto: Record<string, unknown>): { ok: true; config: ConfigPagamentoSite } | { ok: false; erros: ErrosPagamentoSite } {
  const erros: ErrosPagamentoSite = {};
  const nome = typeof bruto.nomeFatura === "string" ? bruto.nomeFatura.trim().replace(/\s+/g, " ") : "";
  if (nome.length > LIMITE_NOME_FATURA) erros.nomeFatura = `Máximo de ${LIMITE_NOME_FATURA} caracteres.`;
  else if (nome && !/^[\p{L}\p{N} .-]+$/u.test(nome)) erros.nomeFatura = "Use só letras, números, espaço, ponto e hífen.";
  const categoria = typeof bruto.categoriaTaxaId === "string" ? bruto.categoriaTaxaId.trim() : "";
  if (categoria && !uuidValido(categoria)) erros.categoriaTaxaId = "Categoria não encontrada.";
  const parcelasTexto = typeof bruto.parcelasMaximas === "string" ? bruto.parcelasMaximas.trim() : "";
  const parcelasMaximas = parcelasTexto === "" ? null : /^\d{1,2}$/.test(parcelasTexto) ? Number(parcelasTexto) : Number.NaN;
  if (parcelasMaximas !== null && !parcelasValidas(parcelasMaximas)) erros.parcelasMaximas = ERRO_PARCELAS_MAXIMAS;
  const tresDS = typeof bruto.tresDS === "string" && bruto.tresDS.trim() ? bruto.tresDS.trim() : CONFIG_PAGAMENTO_SITE_PADRAO.tresDS;
  if (!modoTresDS(tresDS)) erros.tresDS = "Escolha uma das opções da verificação do banco.";
  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    config: { oferecer: ligado(bruto.oferecer), nomeFatura: nome || null, categoriaTaxaId: categoria || null, cartao: ligado(bruto.cartao), parcelasMaximas, tresDS: tresDS as ModoTresDS },
  };
}

export async function lerConfigPagamentoSite(db: Db, organizacaoId: string): Promise<ConfigPagamentoSite> {
  return configDeJson(await lerConfig(db, organizacaoId, "pagamento_site"));
}

/** Grava (auditado). A categoria escolhida precisa ser desta organização e estar ativa. */
export async function salvarConfigPagamentoSite(
  db: Db,
  organizacaoId: string,
  config: ConfigPagamentoSite,
  autorId: string | null,
): Promise<{ ok: true; mudou: boolean } | { ok: false; erros: ErrosPagamentoSite }> {
  return db.transaction(async (tx) => {
    if (config.categoriaTaxaId) {
      const [c] = await tx
        .select({ id: categoriasDespesa.id })
        .from(categoriasDespesa)
        .where(and(eq(categoriasDespesa.id, config.categoriaTaxaId), eq(categoriasDespesa.organizacaoId, organizacaoId), eq(categoriasDespesa.ativa, true)));
      if (!c) return { ok: false as const, erros: { categoriaTaxaId: "Categoria não encontrada ou arquivada." } };
    }
    const mudancas = await gravarConfig(tx, organizacaoId, "pagamento_site", { ...config }, autorId);
    return { ok: true as const, mudou: Object.keys(mudancas).length > 0 };
  });
}

/** Nome que vai na fatura do cartão: o configurado ou, sem ele, o nome da empresa (Configurações → Empresa). */
export async function nomeNaFatura(db: Db, organizacaoId: string): Promise<string> {
  return (await lerConfigPagamentoSite(db, organizacaoId)).nomeFatura ?? (await nomeDaEmpresa(db, organizacaoId)).slice(0, LIMITE_NOME_FATURA);
}

export const ERRO_CATEGORIA_TAXA_ARQUIVADA = "A categoria escolhida para a taxa do pagamento do site está arquivada: escolha outra em Configurações → Pagamento no site (ou reative-a em Despesas).";
export const ERRO_CATEGORIA_TAXA_PADRAO_ARQUIVADA = `A categoria “${CATEGORIA_TAXA_PERDIDA}” está arquivada: reative-a em Despesas ou escolha outra em Configurações → Pagamento no site.`;

/**
 * Categoria da despesa da taxa perdida: a escolhida no painel (ativa); sem escolha, a de nome "Taxa do pagamento do
 * site" (criada aqui no primeiro uso) — e passa a ser a escolhida. Categoria arquivada nunca recebe lançamento novo:
 * avisa e não lança (a equipe escolhe outra ou reativa). Editável depois.
 */
export async function categoriaDaTaxaPerdida(db: Db, organizacaoId: string, autorId: string | null): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "pagamento_site");
    const config = await lerConfigPagamentoSite(tx, organizacaoId);
    if (config.categoriaTaxaId) {
      const [c] = await tx
        .select({ id: categoriasDespesa.id, ativa: categoriasDespesa.ativa })
        .from(categoriasDespesa)
        .where(and(eq(categoriasDespesa.id, config.categoriaTaxaId), eq(categoriasDespesa.organizacaoId, organizacaoId)));
      if (c?.ativa) return { ok: true as const, id: c.id };
      if (c) return { ok: false as const, erro: ERRO_CATEGORIA_TAXA_ARQUIVADA };
    }
    // Uma categoria com o mesmo nome é reaproveitada (o nome é único por organização); arquivada, avisa.
    let [c] = await tx
      .select({ id: categoriasDespesa.id, ativa: categoriasDespesa.ativa })
      .from(categoriasDespesa)
      .where(and(eq(categoriasDespesa.organizacaoId, organizacaoId), sql`lower(${categoriasDespesa.nome}) = lower(${CATEGORIA_TAXA_PERDIDA})`));
    if (c && !c.ativa) return { ok: false as const, erro: ERRO_CATEGORIA_TAXA_PADRAO_ARQUIVADA };
    if (!c) {
      [c] = await tx.insert(categoriasDespesa).values({ organizacaoId, nome: CATEGORIA_TAXA_PERDIDA }).returning({ id: categoriasDespesa.id, ativa: categoriasDespesa.ativa });
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "categoria_despesa.criar", entidade: "categoria_despesa", entidadeId: c.id, mudancas: { nome: [null, CATEGORIA_TAXA_PERDIDA] } });
    }
    await gravarConfig(tx, organizacaoId, "pagamento_site", { ...config, categoriaTaxaId: c.id }, autorId);
    return { ok: true as const, id: c.id };
  });
}
