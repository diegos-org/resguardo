/**
 * Apoio aos testes do pagamento no site (M8.2a): um cenário fictício completo (empresa, imóvel do site com
 * leitura do Beds24 livre, proprietário, contrato de gestão, páginas legais publicadas — M7.4), relógio fixo
 * controlável e o provedor falso. Só testes importam daqui; nada usa rede nem credenciais. Cartão (M8.2b): dados
 * fictícios do formulário (token, aparelho, documento) e a varredura de dados pessoais nas tabelas do pagamento.
 */
import { and, eq } from "drizzle-orm";
import { CONFIG_PAGAMENTO_SITE_PADRAO, salvarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import type { VersoesLegais } from "@/configuracoes/paginas-legais-texto";
import { publicarPaginasLegaisDeTeste } from "@/configuracoes/paginas-legais-testes";
import { criarContrato } from "@/contratos/repositorio";
import {
  aceitesSite,
  auditoria,
  beds24Calendario,
  cotacoes,
  disjuntoresCartao,
  eventosPagamento,
  idsExternos,
  imoveis,
  imoveisDetalhes,
  organizacoes,
  pagamentos,
  proprietarioImoveis,
  proprietarios,
  reservas,
  tentativasLogin,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { PESOS_PADRAO_ANTIGO, PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import { salvarPrecosMarketplace } from "@/marketplace/precos-config";
import { registrarAceiteDoHospede } from "@/site/aceites";
import { criarCotacao, segurarDatas } from "@/site/cotacoes";
import { esquecerProvedorDoAmbiente } from "./ambiente";
import { type DadosCartaoDoHospede, pagarComCartao, type ResultadoCartao } from "./cartao";
import { ProvedorFalso } from "./falso";
import { type PortaoCobranca, podeCobrar } from "./oferta";
import { gerarPix } from "./pix";

/** 1/10/2026 (quinta), 12:00 em São Paulo. */
export const AGORA = new Date("2026-10-01T15:00:00Z");
export const minutos = (n: number, de: Date = AGORA) => new Date(de.getTime() + n * 60_000);
/** Total da cotação padrão: 3 noites para 4 pessoas no 403 (valor cheio 1.900,00, desconto do site 76,00). */
export const TOTAL = 182400;
export const EMAIL_HOSPEDE = "visitante@example.com";
export const DOCUMENTO_FICTICIO = "12345678909";
/** Chave pública fictícia do formulário do cartão (M8.2b), no formato das de teste do Mercado Pago. */
export const CHAVE_PUBLICA_FICTICIA = "TEST-chave-publica-ficticia";
/** Token fictício do cartão (o formulário gera um por tentativa; nunca é guardado). */
export const TOKEN_FICTICIO = "tokFicticio0123456789abcdef0123456";
/** Id fictício do aparelho (SDK do Mercado Pago); nunca é guardado. */
export const DISPOSITIVO_FICTICIO = "dispositivo-ficticio-0001";
/** O que o formulário do cartão manda por padrão nos testes: Mastercard de crédito, à vista, com CPF e aparelho fictícios. */
export const CARTAO_FICTICIO: DadosCartaoDoHospede = {
  token: TOKEN_FICTICIO,
  bandeira: "master",
  tipo: "credit_card",
  parcelas: 1,
  documento: { tipo: "CPF", numero: DOCUMENTO_FICTICIO },
  dispositivo: DISPOSITIVO_FICTICIO,
};
/** Variáveis de ambiente de teste (nunca as do processo). */
export const env = (v: Record<string, string> = {}) => v as unknown as NodeJS.ProcessEnv;

const dias = (de: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${de}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

export type Cenario = {
  db: Db;
  org: string;
  imovel: string;
  dono: string;
  relogio: { agora: Date };
  provedor: ProvedorFalso;
  gate: PortaoCobranca;
  /** Versões publicadas das páginas legais (null com `semPaginasLegais`). */
  versoesLegais: VersoesLegais | null;
  /**
   * Cota e segura as datas (entrada 12/10, saída 15/10, 4 pessoas, salvo `over`) e, como o hóspede que marca a caixa,
   * aceita as páginas legais publicadas (salvo `semAceite` ou sem páginas publicadas).
   */
  segurar: (
    over?: Partial<{ entrada: string; saida: string; hospedes: string; email: string; semAceite: boolean; origemAceite: "pix" | "cartao" }>,
    quando?: Date,
  ) => Promise<{ cotacaoId: string; reservaId: string; codigo: string }>;
  /** Gera o Pix e devolve a tentativa (e o id da order no provedor). */
  pix: (cotacaoId: string, quando?: Date) => Promise<{ pagamentoId: string; idProvedor: string }>;
  /**
   * Paga com cartão (`CARTAO_FICTICIO`, salvo `over`) e devolve o resultado e a tentativa que esta chamada criou
   * (null quando nenhuma foi criada: recusado antes de chegar ao provedor).
   */
  cartao: (
    cotacaoId: string,
    over?: Partial<DadosCartaoDoHospede>,
    quando?: Date,
  ) => Promise<{ resultado: ResultadoCartao; pagamentoId: string | null; idProvedor: string | null }>;
  tentativa: (id: string) => Promise<typeof pagamentos.$inferSelect>;
  reserva: (id: string) => Promise<typeof reservas.$inferSelect>;
  cotacao: (id: string) => Promise<typeof cotacoes.$inferSelect>;
};

/** `semPaginasLegais`: a empresa ainda não publicou os termos e as políticas (o pagamento não é oferecido). */
export async function montarCenario(db: Db, o: { semPaginasLegais?: boolean } = {}): Promise<Cenario> {
  esquecerProvedorDoAmbiente();
  const [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  const [{ id: imovel }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo", publico: true, capacidade: 4 }).returning();
  await db.insert(imoveisDetalhes).values({ imovelId: imovel, organizacaoId: org, precoBase: 45000, taxaLimpeza: 25000, hospedeExtraValor: 5000, hospedeExtraAPartirDe: 3, pisoUltimaHora1: 35000, pisoUltimaHora2: 30000 });
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: imovel, canal: "beds24", idExterno: "10", detalhe: "20" });
  await salvarPrecosMarketplace(db, org, { ...PRECOS_MARKETPLACE_PADRAO, pesos: { ...PESOS_PADRAO_ANTIGO } }, null);
  await db.insert(beds24Calendario).values(dias("2026-10-01", 61).map((data) => ({ organizacaoId: org, imovelId: imovel, data, roomId: "20", livres: 1, preco: 45000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", observadoEm: new Date("2026-10-01T09:15:00Z") })));
  const [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Fictícia", email: "dona@example.com", chavePix: "dona@example.com" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: imovel });
  const contrato = await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  if (!contrato.ok) throw new Error(JSON.stringify(contrato.erros));
  // "Oferecer pagamento no site" e o cartão começam desligados: o cenário liga os dois, como o Diego na aba.
  const config = await salvarConfigPagamentoSite(db, org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, cartao: true }, null);
  if (!config.ok) throw new Error(JSON.stringify(config.erros));
  // As três páginas legais na versão 1 (texto-base, dados fictícios), sem mexer em Configurações → Empresa.
  const versoesLegais = o.semPaginasLegais ? null : await publicarPaginasLegaisDeTeste(db, org);
  const relogio = { agora: AGORA };
  const provedor = new ProvedorFalso(() => relogio.agora);
  const gate = await podeCobrar(db, org, env(), AGORA, { provedor, chavePublica: CHAVE_PUBLICA_FICTICIA });
  const c: Cenario = {
    db,
    org,
    imovel,
    dono,
    relogio,
    provedor,
    gate,
    versoesLegais,
    async segurar(over = {}, quando = relogio.agora) {
      const r = await criarCotacao(db, org, { imovel: "403", entrada: over.entrada ?? "2026-10-12", saida: over.saida ?? "2026-10-15", hospedes: over.hospedes ?? "4" }, quando);
      if (!r.ok) throw new Error(r.erro);
      const h = await segurarDatas(db, org, r.cotacao.codigo, { nome: "Visitante Fictício", email: over.email ?? EMAIL_HOSPEDE, telefone: "(21) 99999-0000" }, quando);
      if (!h.ok) throw new Error(h.erro);
      if (!over.semAceite && c.versoesLegais) {
        const a = await registrarAceiteDoHospede(db, org, h.cotacao.id, c.versoesLegais, over.origemAceite ?? "pix", quando);
        if (!a.ok) throw new Error(a.erro);
      }
      return { cotacaoId: h.cotacao.id, reservaId: h.cotacao.reservaId!, codigo: h.cotacao.codigo };
    },
    async pix(cotacaoId, quando = relogio.agora) {
      const r = await gerarPix(db, org, cotacaoId, quando, provedor);
      if (!r.ok) throw new Error(`${r.codigo}: ${r.erro}`);
      const p = await c.tentativa(r.pagamentoId);
      return { pagamentoId: p.id, idProvedor: p.idProvedor! };
    },
    async cartao(cotacaoId, over = {}, quando = relogio.agora) {
      const doCartao = and(eq(pagamentos.cotacaoId, cotacaoId), eq(pagamentos.forma, "cartao"));
      const antes = new Set((await db.select({ id: pagamentos.id }).from(pagamentos).where(doCartao)).map((x) => x.id));
      const resultado = await pagarComCartao(db, org, cotacaoId, quando, provedor, { ...CARTAO_FICTICIO, ...over });
      const nova = (await db.select().from(pagamentos).where(doCartao)).find((x) => !antes.has(x.id));
      return { resultado, pagamentoId: nova?.id ?? null, idProvedor: nova?.idProvedor ?? null };
    },
    async tentativa(id) {
      const [p] = await db.select().from(pagamentos).where(and(eq(pagamentos.id, id), eq(pagamentos.organizacaoId, org)));
      return p;
    },
    async reserva(id) {
      const [r] = await db.select().from(reservas).where(eq(reservas.id, id));
      return r;
    },
    async cotacao(id) {
      const [x] = await db.select().from(cotacoes).where(eq(cotacoes.id, id));
      return x;
    },
  };
  return c;
}

/**
 * Varre as tabelas do pagamento (pagamentos, eventos, auditoria, aceites, disjuntor, freios de tentativas) atrás de
 * `valores` (token, documento, id do aparelho, e-mails, nome do titular…) e devolve os que apareceram — o esperado é
 * nenhum.
 */
export async function semDadosPessoais(db: Db, valores: string[]): Promise<string[]> {
  const tudo = JSON.stringify([
    await db.select().from(pagamentos),
    await db.select().from(eventosPagamento),
    await db.select().from(auditoria),
    await db.select().from(aceitesSite),
    await db.select().from(disjuntoresCartao),
    await db.select().from(tentativasLogin),
  ]);
  return valores.filter((v) => v && tudo.includes(v));
}
