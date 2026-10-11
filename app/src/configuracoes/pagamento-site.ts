/**
 * Pagamento no site (M8.2a): regras de venda editáveis no painel (Configurações → Pagamento no site), num
 * lugar só. `oferecer` liga e desliga o pagamento para as tentativas novas (o que já foi pago continua sendo
 * conferido) e começa DESLIGADO (deny-by-default: o Diego liga na aba, auditado); `nomeFatura` é o nome que aparece na fatura do cartão (vazio = o nome da empresa); a categoria da
 * taxa perdida recebe a despesa da taxa que o provedor não devolve (criada no primeiro uso, editável depois).
 * Cartão (M8.2b): `cartao` começa DESLIGADO e só vale com `oferecer`; `parcelasMaximas` null = o máximo que o
 * Mercado Pago permitir (juros pagos pelo hóspede); `tresDS` = a verificação do banco pedida em cada cartão novo.
 * Cancelamento (M8.2c): `pedidoCancelamentoNoPortal` mostra o botão "Pedir o cancelamento" em Minha reserva (começa
 * LIGADO: o hóspede só pede, quem cancela é a equipe); `naoComparecimentoHoras` = quantas horas depois do horário de
 * entrada a equipe pode registrar o não comparecimento (o hóspede pode chegar atrasado e avisar).
 * Disputa do pagamento (M8.2e): `categoriaDaContestacao` recebe a perda da SCL numa disputa (criada no primeiro uso,
 * editável, como a da taxa perdida); `diasAvisoDocumentacao` = quantos dias antes do prazo dos documentos o Início e o
 * e-mail avisam; `causasContestacao` = o nome e a frase de cada causa da decisão de quem arca (códigos fixos; vazio = o
 * texto-base).
 * Tudo auditado, valendo para as tentativas novas (e, no cancelamento, para os pedidos e cancelamentos de agora em diante).
 */
import { and, eq, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { categoriasDespesa } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { CODIGOS_CAUSA_CONTESTACAO, type CodigoCausaContestacao, TEXTOS_BASE_CAUSAS_CONTESTACAO, type TextosDasCausas } from "@/pagamentos/contestacao-regras";
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
  /** O hóspede pode pedir o cancelamento em Minha reserva (reservas pagas pelo site). */
  pedidoCancelamentoNoPortal: boolean;
  /** Horas depois do horário de entrada até a equipe poder registrar o não comparecimento (0 a 72). */
  naoComparecimentoHoras: number;
  /** Categoria da perda da SCL numa disputa do pagamento; null = a de nome padrão, criada no primeiro uso. */
  categoriaDaContestacao: string | null;
  /** Dias antes do prazo dos documentos de uma disputa em que o aviso fica de atenção (1 a 15). */
  diasAvisoDocumentacao: number;
  /** Nome e frase de cada causa de disputa (códigos fixos). */
  causasContestacao: TextosDasCausas;
};
/** Os campos de texto de uma causa no formulário (`causa_<código>_<campo>`). */
export type CampoDaCausa = "nome" | "frase" | "fraseComVerificacao" | "frasePix";
export const campoDaCausa = (codigo: CodigoCausaContestacao, campo: CampoDaCausa) => `causa_${codigo}_${campo}` as const;
export type ErrosPagamentoSite = Partial<Record<keyof ConfigPagamentoSite | ReturnType<typeof campoDaCausa>, string>>;

/** Faixa e padrão da tolerância do não comparecimento: 21 horas = 12h do dia seguinte, com entrada às 15h. */
export const NAO_COMPARECIMENTO_HORAS_MAX = 72;
export const NAO_COMPARECIMENTO_HORAS_PADRAO = 21;
export const ERRO_NAO_COMPARECIMENTO_HORAS = `Use um número inteiro de horas de 0 a ${NAO_COMPARECIMENTO_HORAS_MAX} (vazio = ${NAO_COMPARECIMENTO_HORAS_PADRAO}).`;
/** Faixa e padrão dos dias de aviso antes do prazo dos documentos de uma disputa. */
export const DIAS_AVISO_DOCUMENTACAO_MIN = 1;
export const DIAS_AVISO_DOCUMENTACAO_MAX = 15;
export const DIAS_AVISO_DOCUMENTACAO_PADRAO = 5;
export const ERRO_DIAS_AVISO_DOCUMENTACAO = `Use um número inteiro de dias de ${DIAS_AVISO_DOCUMENTACAO_MIN} a ${DIAS_AVISO_DOCUMENTACAO_MAX} (vazio = ${DIAS_AVISO_DOCUMENTACAO_PADRAO}).`;
/** Limites do nome e da frase de uma causa de disputa (mostrados ao proprietário no extrato, no PDF e no e-mail). */
export const LIMITE_NOME_CAUSA = 120;
export const LIMITE_FRASE_CAUSA = 240;

export const CONFIG_PAGAMENTO_SITE_PADRAO: ConfigPagamentoSite = {
  oferecer: false,
  nomeFatura: null,
  categoriaTaxaId: null,
  cartao: false,
  parcelasMaximas: null,
  tresDS: "on_fraud_risk",
  pedidoCancelamentoNoPortal: true,
  naoComparecimentoHoras: NAO_COMPARECIMENTO_HORAS_PADRAO,
  categoriaDaContestacao: null,
  diasAvisoDocumentacao: DIAS_AVISO_DOCUMENTACAO_PADRAO,
  causasContestacao: TEXTOS_BASE_CAUSAS_CONTESTACAO,
};
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
/** Nome da categoria da perda por disputa do pagamento criada no primeiro uso, quando nenhuma foi escolhida. */
export const CATEGORIA_PERDA_CONTESTACAO = "Perda por disputa do pagamento";

const ligado = (v: unknown) => v === true || v === "on" || v === "true" || v === "1";
const parcelasValidas = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= PARCELAS_MAXIMAS;
const modoTresDS = (v: unknown): v is ModoTresDS => typeof v === "string" && (MODOS_TRES_DS as readonly string[]).includes(v);
const horasValidas = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= NAO_COMPARECIMENTO_HORAS_MAX;
const diasAvisoValidos = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= DIAS_AVISO_DOCUMENTACAO_MIN && v <= DIAS_AVISO_DOCUMENTACAO_MAX;

/** Os campos de cada causa (a fraude tem as frases da verificação do banco e do Pix). */
const camposDaCausa = (codigo: CodigoCausaContestacao): CampoDaCausa[] => (codigo === "fraude" ? ["nome", "frase", "fraseComVerificacao", "frasePix"] : ["nome", "frase"]);
const limiteDoCampo = (campo: CampoDaCausa) => (campo === "nome" ? LIMITE_NOME_CAUSA : LIMITE_FRASE_CAUSA);
/** Texto de uma causa: espaços juntados; sem caracteres de controle. */
const textoDaCausa = (v: string) => v.trim().replace(/\s+/g, " ");
const textoDaCausaValido = (v: unknown, campo: CampoDaCausa): v is string =>
  typeof v === "string" && textoDaCausa(v) === v && v.length > 0 && v.length <= limiteDoCampo(campo) && !/[\u0000-\u001f\u007f]/.test(v);
const lerCampoDaCausa = (t: unknown, campo: CampoDaCausa): unknown => (t && typeof t === "object" ? (t as Record<string, unknown>)[campo] : undefined);

/** Nome e frase gravados de cada causa; campo ausente ou estranho volta ao texto-base. */
function causasDeJson(v: unknown): TextosDasCausas {
  const c = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out = structuredClone(TEXTOS_BASE_CAUSAS_CONTESTACAO) as TextosDasCausas & Record<CodigoCausaContestacao, Record<string, string>>;
  for (const codigo of CODIGOS_CAUSA_CONTESTACAO)
    for (const campo of camposDaCausa(codigo)) {
      const x = lerCampoDaCausa(c[codigo], campo);
      if (textoDaCausaValido(x, campo)) out[codigo][campo] = x;
    }
  return out;
}

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
    pedidoCancelamentoNoPortal: typeof c.pedidoCancelamentoNoPortal === "boolean" ? c.pedidoCancelamentoNoPortal : CONFIG_PAGAMENTO_SITE_PADRAO.pedidoCancelamentoNoPortal,
    naoComparecimentoHoras: horasValidas(c.naoComparecimentoHoras) ? c.naoComparecimentoHoras : CONFIG_PAGAMENTO_SITE_PADRAO.naoComparecimentoHoras,
    categoriaDaContestacao: uuidValido(c.categoriaDaContestacao) ? c.categoriaDaContestacao : null,
    diasAvisoDocumentacao: diasAvisoValidos(c.diasAvisoDocumentacao) ? c.diasAvisoDocumentacao : CONFIG_PAGAMENTO_SITE_PADRAO.diasAvisoDocumentacao,
    causasContestacao: causasDeJson(c.causasContestacao),
  };
}

/**
 * Formulário do painel → configuração. Nome na fatura: letras, números, espaço, ponto e hífen. Parcelas: vazio = o
 * máximo do Mercado Pago, senão inteiro de 1 a 36. Verificação do banco: uma das opções (sem o campo, a recomendada).
 * Cancelamento: a caixa do pedido em Minha reserva (desmarcada = desligado, como toda caixa do formulário) e as horas do
 * não comparecimento (vazio = o padrão, senão inteiro de 0 a 72).
 * Disputa do pagamento (M8.2e): a categoria (vazio = a de nome padrão), os dias de aviso (vazio = 5, senão inteiro de 1 a
 * 15) e o nome e a frase de cada causa (`causa_<código>_<campo>`; vazio = o texto-base). Um formulário sem esses campos
 * (o de antes do M8.2e) não os muda: ficam os de `atual`.
 */
export function validarConfigPagamentoSite(
  bruto: Record<string, unknown>,
  atual: ConfigPagamentoSite = CONFIG_PAGAMENTO_SITE_PADRAO,
): { ok: true; config: ConfigPagamentoSite } | { ok: false; erros: ErrosPagamentoSite } {
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
  const horasTexto = typeof bruto.naoComparecimentoHoras === "string" ? bruto.naoComparecimentoHoras.trim() : "";
  const naoComparecimentoHoras = horasTexto === "" ? NAO_COMPARECIMENTO_HORAS_PADRAO : /^\d{1,2}$/.test(horasTexto) ? Number(horasTexto) : Number.NaN;
  if (!horasValidas(naoComparecimentoHoras)) erros.naoComparecimentoHoras = ERRO_NAO_COMPARECIMENTO_HORAS;
  // Disputa do pagamento: só os campos enviados mudam.
  let categoriaDaContestacao = atual.categoriaDaContestacao;
  if (typeof bruto.categoriaDaContestacao === "string") {
    categoriaDaContestacao = bruto.categoriaDaContestacao.trim() || null;
    if (categoriaDaContestacao && !uuidValido(categoriaDaContestacao)) erros.categoriaDaContestacao = "Categoria não encontrada.";
  }
  let diasAvisoDocumentacao = atual.diasAvisoDocumentacao;
  if (typeof bruto.diasAvisoDocumentacao === "string") {
    const t = bruto.diasAvisoDocumentacao.trim();
    diasAvisoDocumentacao = t === "" ? DIAS_AVISO_DOCUMENTACAO_PADRAO : /^\d{1,2}$/.test(t) ? Number(t) : Number.NaN;
    if (!diasAvisoValidos(diasAvisoDocumentacao)) erros.diasAvisoDocumentacao = ERRO_DIAS_AVISO_DOCUMENTACAO;
  }
  const causasContestacao = structuredClone(atual.causasContestacao) as TextosDasCausas & Record<CodigoCausaContestacao, Record<string, string>>;
  for (const codigo of CODIGOS_CAUSA_CONTESTACAO)
    for (const campo of camposDaCausa(codigo)) {
      const nome = campoDaCausa(codigo, campo);
      if (typeof bruto[nome] !== "string") continue;
      const t = textoDaCausa(bruto[nome] as string);
      const base = (TEXTOS_BASE_CAUSAS_CONTESTACAO[codigo] as Record<string, string>)[campo];
      if (!t) causasContestacao[codigo][campo] = base;
      else if (t.length > limiteDoCampo(campo)) erros[nome] = `Máximo de ${limiteDoCampo(campo)} caracteres.`;
      else if (!textoDaCausaValido(t, campo)) erros[nome] = "Use só texto, sem caracteres de controle.";
      else causasContestacao[codigo][campo] = t;
    }
  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    config: {
      oferecer: ligado(bruto.oferecer),
      nomeFatura: nome || null,
      categoriaTaxaId: categoria || null,
      cartao: ligado(bruto.cartao),
      parcelasMaximas,
      tresDS: tresDS as ModoTresDS,
      pedidoCancelamentoNoPortal: ligado(bruto.pedidoCancelamentoNoPortal),
      naoComparecimentoHoras,
      categoriaDaContestacao,
      diasAvisoDocumentacao,
      causasContestacao,
    },
  };
}

export async function lerConfigPagamentoSite(db: Db, organizacaoId: string): Promise<ConfigPagamentoSite> {
  return configDeJson(await lerConfig(db, organizacaoId, "pagamento_site"));
}

/** Grava (auditado). As categorias escolhidas precisam ser desta organização e estar ativas. */
export async function salvarConfigPagamentoSite(
  db: Db,
  organizacaoId: string,
  config: ConfigPagamentoSite,
  autorId: string | null,
): Promise<{ ok: true; mudou: boolean } | { ok: false; erros: ErrosPagamentoSite }> {
  return db.transaction(async (tx) => {
    for (const campo of ["categoriaTaxaId", "categoriaDaContestacao"] as const) {
      const id = config[campo];
      if (!id) continue;
      const [c] = await tx
        .select({ id: categoriasDespesa.id })
        .from(categoriasDespesa)
        .where(and(eq(categoriasDespesa.id, id), eq(categoriasDespesa.organizacaoId, organizacaoId), eq(categoriasDespesa.ativa, true)));
      if (!c) return { ok: false as const, erros: { [campo]: "Categoria não encontrada ou arquivada." } };
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

export const ERRO_CATEGORIA_CONTESTACAO_ARQUIVADA =
  "A categoria escolhida para a perda por disputa do pagamento está arquivada: escolha outra em Configurações → Pagamento no site (ou reative-a em Despesas).";
export const ERRO_CATEGORIA_CONTESTACAO_PADRAO_ARQUIVADA = `A categoria “${CATEGORIA_PERDA_CONTESTACAO}” está arquivada: reative-a em Despesas ou escolha outra em Configurações → Pagamento no site.`;

/**
 * Uma categoria de despesa do pagamento do site: a escolhida no painel (ativa); sem escolha, a de nome padrão (criada
 * aqui no primeiro uso) — e passa a ser a escolhida. Categoria arquivada nunca recebe lançamento novo: avisa e não lança
 * (a equipe escolhe outra ou reativa). Editável depois.
 */
async function categoriaCriadaNoPrimeiroUso(
  db: Db,
  organizacaoId: string,
  autorId: string | null,
  campo: "categoriaTaxaId" | "categoriaDaContestacao",
  nome: string,
  erros: { arquivada: string; padraoArquivada: string },
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "pagamento_site");
    const config = await lerConfigPagamentoSite(tx, organizacaoId);
    const escolhida = config[campo];
    if (escolhida) {
      const [c] = await tx
        .select({ id: categoriasDespesa.id, ativa: categoriasDespesa.ativa })
        .from(categoriasDespesa)
        .where(and(eq(categoriasDespesa.id, escolhida), eq(categoriasDespesa.organizacaoId, organizacaoId)));
      if (c?.ativa) return { ok: true as const, id: c.id };
      if (c) return { ok: false as const, erro: erros.arquivada };
    }
    // Uma categoria com o mesmo nome é reaproveitada (o nome é único por organização); arquivada, avisa.
    let [c] = await tx
      .select({ id: categoriasDespesa.id, ativa: categoriasDespesa.ativa })
      .from(categoriasDespesa)
      .where(and(eq(categoriasDespesa.organizacaoId, organizacaoId), sql`lower(${categoriasDespesa.nome}) = lower(${nome})`));
    if (c && !c.ativa) return { ok: false as const, erro: erros.padraoArquivada };
    if (!c) {
      [c] = await tx.insert(categoriasDespesa).values({ organizacaoId, nome }).returning({ id: categoriasDespesa.id, ativa: categoriasDespesa.ativa });
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "categoria_despesa.criar", entidade: "categoria_despesa", entidadeId: c.id, mudancas: { nome: [null, nome] } });
    }
    await gravarConfig(tx, organizacaoId, "pagamento_site", { ...config, [campo]: c.id }, autorId);
    return { ok: true as const, id: c.id };
  });
}

/** Categoria da despesa da taxa perdida (padrão "Taxa do pagamento do site"; ver `categoriaCriadaNoPrimeiroUso`). */
export const categoriaDaTaxaPerdida = (db: Db, organizacaoId: string, autorId: string | null) =>
  categoriaCriadaNoPrimeiroUso(db, organizacaoId, autorId, "categoriaTaxaId", CATEGORIA_TAXA_PERDIDA, { arquivada: ERRO_CATEGORIA_TAXA_ARQUIVADA, padraoArquivada: ERRO_CATEGORIA_TAXA_PADRAO_ARQUIVADA });

/**
 * Categoria da perda da SCL numa disputa do pagamento (M8.2e: a perda prevista e a definitiva, a tarifa e a taxa do
 * pagamento sem reserva; padrão "Perda por disputa do pagamento"; ver `categoriaCriadaNoPrimeiroUso`).
 */
export const categoriaDaPerdaPorDisputa = (db: Db, organizacaoId: string, autorId: string | null) =>
  categoriaCriadaNoPrimeiroUso(db, organizacaoId, autorId, "categoriaDaContestacao", CATEGORIA_PERDA_CONTESTACAO, {
    arquivada: ERRO_CATEGORIA_CONTESTACAO_ARQUIVADA,
    padraoArquivada: ERRO_CATEGORIA_CONTESTACAO_PADRAO_ARQUIVADA,
  });
