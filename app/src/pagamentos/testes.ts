/**
 * Apoio aos testes do pagamento no site (M8.2a): um cenário fictício completo (empresa, imóvel do site com
 * leitura do Beds24 livre, proprietário, contrato de gestão, páginas legais publicadas — M7.4), relógio fixo
 * controlável e o provedor falso. Só testes importam daqui; nada usa rede nem credenciais. Cartão (M8.2b): dados
 * fictícios do formulário (token, aparelho, documento) e a varredura de dados pessoais nas tabelas do pagamento.
 * Cancelamento (M8.2c): reserva paga e confirmada pelo site, pedido, cancelamento pela prévia (com a assinatura dela),
 * liberação, repasse da parte e um usuário fictício da equipe. Devolução em partes (M8.2d): a costura de uma alteração já
 * aplicada (redução com as devoluções dela, aumento com o pagamento da diferença), a liberação pelo provedor e o cartão
 * parcelado com juros; antes de o domínio da alteração existir, os testes do motor de devoluções partem daqui.
 */
import { and, eq } from "drizzle-orm";
import { CONFIG_PAGAMENTO_SITE_PADRAO, salvarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import type { VersoesLegais } from "@/configuracoes/paginas-legais-texto";
import { publicarPaginasLegaisDeTeste } from "@/configuracoes/paginas-legais-testes";
import { criarContrato } from "@/contratos/repositorio";
import { aplicarMotor } from "@/financeiro/aplicar";
import {
  aceitesSite,
  alteracoesReserva,
  auditoria,
  beds24Calendario,
  beds24CalendarioCopias,
  beds24ReservasOperacoes,
  beds24ReservasRotina,
  beds24ReservasSite,
  cancelamentosReserva,
  contestacoesPagamento,
  cotacoes,
  devolucoesPagamento,
  disjuntoresCartao,
  eventosContestacao,
  eventosPagamento,
  execucoesAutomacao,
  idsExternos,
  imoveis,
  imoveisDetalhes,
  lancamentos,
  organizacoes,
  pagamentos,
  precosImportados,
  proprietarioImoveis,
  proprietarios,
  reservas,
  reservasDiretasOtas,
  tentativasLogin,
  usuarios,
  whatsappAvisosDia,
  whatsappConta,
  whatsappEventos,
} from "@/db/schema";
import type { Db } from "@/db/types";
import type { CorreioMemoria } from "@/email/correio";
import { PESOS_PADRAO_ANTIGO, PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import { salvarPrecosMarketplace } from "@/marketplace/precos-config";
import { registrarAceiteDoHospede } from "@/site/aceites";
import { criarCotacao, segurarDatas } from "@/site/cotacoes";
import { esquecerProvedorDoAmbiente } from "./ambiente";
import { type EntradaAlteracao, previaDaAlteracao, segurarAlteracao } from "./alteracao";
import { cancelarReservaPaga, type EntradaCancelamento, previaDoCancelamento, registrarPedidoDeCancelamento } from "./cancelamento";
import { type DadosCartaoDoHospede, pagarComCartao, type ResultadoCartao } from "./cartao";
import { ProvedorFalso } from "./falso";
import type { ProvedorPagamento } from "./provedor";
import { type PortaoCobranca, podeCobrar } from "./oferta";
import { chaveCriacao, referenciaDaTentativa } from "./criacao";
import { gravarTaxaNaReserva } from "./liberacao";
import { gerarPix } from "./pix";
import { travarCotacao } from "./travas";

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
 * nenhum. `nomes` (M8.2c): o nome do hóspede, procurado nas mesmas tabelas, menos a auditoria da reserva que nasce no
 * M8.1 (`reserva.importar` guarda os dados dela, nome inclusive, fora das tabelas do pagamento). M8.2e: também as
 * disputas do pagamento e a linha do tempo delas. M8.3: também o acompanhamento das reservas do site no Beds24 e as
 * operações (o pedido, as leituras e o erro nunca levam nome, e-mail, telefone, documento nem valor). M8.3c: também a
 * resposta e o detalhe das operações (as colunas novas vêm no `select`), o estado da rotina (`beds24_reservas_rotina`) e,
 * com `correio`, o assunto e o texto dos e-mails à equipe. M10.1a: também os eventos, os contadores e a situação do
 * WhatsApp (nunca as conversas e as mensagens, que guardam o dado de propósito) e o resumo das execuções das rotinas.
 */
export async function semDadosPessoais(db: Db, valores: string[], o: { nomes?: string[]; correio?: Pick<CorreioMemoria, "enviadas"> } = {}): Promise<string[]> {
  const semAuditoria = [
    await db.select().from(pagamentos),
    await db.select().from(eventosPagamento),
    await db.select().from(aceitesSite),
    await db.select().from(disjuntoresCartao),
    await db.select().from(tentativasLogin),
    // M8.2c: as devoluções, os cancelamentos e o livro (descrições com o código da reserva, nunca o hóspede).
    await db.select().from(devolucoesPagamento),
    await db.select().from(cancelamentosReserva),
    await db.select().from(lancamentos),
    // M8.2d: as alterações (notas e retratos, nunca o hóspede) e as reservas-pedido que seguram as datas novas.
    await db.select().from(alteracoesReserva),
    await db.select({ id: reservas.id, observacoes: reservas.observacoes, fonte: reservas.fonte }).from(reservas).where(eq(reservas.fonte, "alteracao")),
    // M8.2e: as disputas (ids do caso, códigos, valores, datas e notas validadas) e a linha do tempo delas.
    await db.select().from(contestacoesPagamento),
    await db.select().from(eventosContestacao),
    // M8.3: o acompanhamento das reservas do site no Beds24 e as operações (quarto, datas, pessoas, situação, códigos).
    await db.select().from(beds24ReservasSite),
    await db.select().from(beds24ReservasOperacoes),
    // M8.3c: o estado da rotina (os escopos lidos, a impressão da credencial e as marcas de tempo) e os e-mails à equipe
    // (só o código SCL, o imóvel e as datas). O resumo das rotinas (só números) entra logo abaixo, com o M10.1a.
    await db.select().from(beds24ReservasRotina),
    (o.correio?.enviadas ?? []).map((m) => ({ assunto: m.assunto, texto: m.texto, html: m.html ?? "" })),
    // M10.1a: eventos, contadores e situação do WhatsApp, sem conteúdo. Não entram `whatsapp_contatos` nem
    // `whatsapp_mensagens`: guardam telefone, nomes e texto de propósito (só com o acesso da caixa de entrada).
    await db.select().from(whatsappEventos),
    await db.select().from(whatsappAvisosDia),
    await db.select().from(whatsappConta),
    // M10.1a: o resumo das execuções das rotinas é "sem dados pessoais", e até aqui ninguém conferia.
    await db.select().from(execucoesAutomacao),
    // M3.11a: as cópias da leitura do Beds24 (quarto, motivo e as noites: preço, mínimo, máximo, unidades e bloqueio) e a
    // camada do preço importado (preço e mínimo por noite). Nada de hóspede.
    await db.select().from(beds24CalendarioCopias),
    await db.select().from(precosImportados),
    // M3.11b: as marcas das OTAs da reserva direta (só ids e horas).
    await db.select().from(reservasDiretasOtas),
  ];
  const registros = await db.select().from(auditoria);
  const tudo = JSON.stringify([semAuditoria, registros]);
  const semReservaImportada = JSON.stringify([semAuditoria, registros.filter((a) => a.acao !== "reserva.importar")]);
  return [...valores.filter((v) => v && tudo.includes(v)), ...(o.nomes ?? []).filter((n) => n && semReservaImportada.includes(n))];
}

// ---------------------------------------------------------------- cancelamento pela política (M8.2c)

/** Nome e telefone do hóspede fictício do cenário (a varredura de dados pessoais procura por eles, com o e-mail). */
export const NOME_HOSPEDE = "Visitante Fictício";
export const TELEFONE_HOSPEDE = "(21) 99999-0000";

/** A varredura dos testes do cancelamento (M8.2c): o e-mail, o telefone e o nome do hóspede fictício do cenário. */
export const semDadosDoHospede = (db: Db) => semDadosPessoais(db, [EMAIL_HOSPEDE, TELEFONE_HOSPEDE], { nomes: [NOME_HOSPEDE] });

/** Um usuário fictício da equipe (quem registra pedidos, cancela e confirma). */
export async function usuarioDeTeste(c: Cenario, nome = "Equipe Fictícia"): Promise<string> {
  const [u] = await c.db.insert(usuarios).values({ organizacaoId: c.org, email: `${nome.toLowerCase().replace(/\W+/g, ".")}.${crypto.randomUUID().slice(0, 8)}@example.com`, nome, papel: "admin" }).returning({ id: usuarios.id });
  return u.id;
}

/**
 * Uma reserva paga e confirmada pelo site (Pix, ou cartão), com o aceite das páginas legais (`semAceite`: o pagamento
 * fica sem o aceite ligado, como os de antes do M7.4).
 * `quando`: a hora em que o hóspede pagou (a cotação e o pagamento nascem aí); a aprovação é lida 3 minutos depois.
 */
export async function pagarEConfirmar(
  c: Cenario,
  o: {
    forma?: "pix" | "cartao";
    parcelas?: number;
    entrada?: string;
    saida?: string;
    email?: string;
    semAceite?: boolean;
    quando?: Date;
    financeiro?: Parameters<ProvedorFalso["aprovar"]>[1];
    /** M8.2d: a liberação registrada à mão logo depois (`liberar`, 5 minutos depois da aprovação lida). */
    liberar?: boolean;
    /** M8.2d: cartão em 3 parcelas com estes centavos de juros pagos pelo hóspede (o pago = o valor + os juros). */
    cartaoComJuros?: number;
  } = {},
): Promise<{ cotacaoId: string; reservaId: string; codigo: string; pagamentoId: string; idProvedor: string; reservaCodigo: string }> {
  const quando = o.quando ?? c.relogio.agora;
  if (o.cartaoComJuros !== undefined) {
    c.provedor.jurosCartao = o.cartaoComJuros;
    c.provedor.jurosPor = "comprador";
    o = { ...o, forma: "cartao", parcelas: o.parcelas ?? 3 };
  }
  const s = await c.segurar({ entrada: o.entrada, saida: o.saida, email: o.email, origemAceite: o.forma === "cartao" ? "cartao" : "pix" }, quando);
  let pagamentoId: string;
  let idProvedor: string;
  if (o.forma === "cartao") {
    c.provedor.respostaCartao = "processando";
    const r = await c.cartao(s.cotacaoId, o.parcelas ? { parcelas: o.parcelas } : {}, quando);
    if (!r.pagamentoId || !r.idProvedor) throw new Error("cartão não criado");
    c.provedor.concluirAnalise(r.idProvedor, "aprovado");
    c.provedor.respostaCartao = "aprovado";
    // A taxa da aprovação (o líquido sai do valor da cotação; os juros do parcelamento são do hóspede).
    const taxa = o.financeiro?.taxa === undefined ? 1824 : o.financeiro.taxa;
    if (taxa !== null) c.provedor.atualizarFinanceiro(r.idProvedor, { taxa, liquido: TOTAL - taxa });
    pagamentoId = r.pagamentoId;
    idProvedor = r.idProvedor;
  } else {
    const p = await c.pix(s.cotacaoId, quando);
    c.provedor.aprovar(p.idProvedor, o.financeiro ?? { taxa: 1824 });
    pagamentoId = p.pagamentoId;
    idProvedor = p.idProvedor;
  }
  const { conferirTentativa } = await import("./conferencia");
  await conferirTentativa(c.db, c.org, pagamentoId, c.provedor, minutos(3, quando), { origem: "rotina", forcar: true });
  const r = await c.reserva(s.reservaId);
  if (r.estado !== "confirmada") throw new Error(`reserva não confirmada: ${r.estado}`);
  // Pagamento de antes do aceite das páginas legais (M7.4): sem aceite ligado, sem política para o cancelamento.
  if (o.semAceite) await c.db.update(pagamentos).set({ aceiteId: null }).where(eq(pagamentos.id, pagamentoId));
  if (o.cartaoComJuros !== undefined) c.provedor.jurosCartao = 0;
  if (o.liberar) await liberar(c, pagamentoId, { quando: minutos(8, quando) });
  return { ...s, pagamentoId, idProvedor, reservaCodigo: r.codigo };
}

/** Recua a criação e a aprovação do pagamento (pagamento velho: mais de 78, 85, 90 ou 180 dias). */
export async function envelhecer(c: Cenario, pagamentoId: string, dias: number): Promise<void> {
  const p = await c.tentativa(pagamentoId);
  const menos = (d: Date | null) => (d ? new Date(d.getTime() - dias * 86_400_000) : null);
  await c.db.update(pagamentos).set({ criadoEm: menos(p.criadoEm)!, aprovadoEm: menos(p.aprovadoEm) }).where(eq(pagamentos.id, pagamentoId));
}

/** O que o formulário do painel manda por padrão: o hóspede pediu, pela política. */
export const entradaPadrao = (over: Partial<EntradaCancelamento> = {}): EntradaCancelamento => ({
  recebidoEm: null,
  motivoMomento: "",
  canal: null,
  quemCancela: "hospede",
  motivoEmpresa: null,
  decisao: "politica",
  motivoExcecao: null,
  motivoDecisao: "",
  nota: "",
  ...over,
});

/** Registra um pedido da equipe (por WhatsApp, salvo `canal`), recebido em `recebidoEm` (padrão: agora). */
export async function pedir(c: Cenario, reservaId: string, autorId: string, o: { canal?: "whatsapp" | "email" | "telefone" | "presencial" | "outro"; recebidoEm?: Date; quando?: Date; nota?: string } = {}) {
  const quando = o.quando ?? c.relogio.agora;
  return registrarPedidoDeCancelamento(c.db, c.org, reservaId, { recebidoEm: o.recebidoEm ?? quando, canal: o.canal ?? "whatsapp", nota: o.nota ?? "WhatsApp da empresa, 14h10" }, autorId, quando);
}

/** Calcula a prévia e cancela com a assinatura dela (como o painel: prévia, depois o botão). */
export async function cancelar(c: Cenario, reservaId: string, entrada: EntradaCancelamento, autorId: string | null, quando: Date = c.relogio.agora, o: { provedor?: ProvedorPagamento | null } = {}) {
  const provedor = o.provedor === undefined ? c.provedor : o.provedor;
  const previa = await previaDoCancelamento(c.db, c.org, reservaId, entrada, provedor, quando);
  if (!previa.ok) return { previa, resultado: previa };
  const resultado = await cancelarReservaPaga(c.db, c.org, reservaId, entrada, autorId, provedor, quando, previa.previa.assinatura);
  return { previa, resultado };
}

/**
 * A liberação do dinheiro (registrada à mão, no dia `data`): o recebimento do líquido (padrão: o valor menos a taxa do
 * pagamento, ou de R$ 18,24 sem ela) entra no livro. `manual: false` (M8.2d): o Mercado Pago diz que liberou (o financeiro
 * da order passa a "liberado") e a leitura lança o recebimento conciliado.
 */
export async function liberar(c: Cenario, pagamentoId: string, o: { data?: string; liquido?: number; quando?: Date; manual?: boolean } = {}) {
  const quando = o.quando ?? c.relogio.agora;
  const p = await c.tentativa(pagamentoId);
  if (o.manual === false) {
    if (!p.idProvedor) throw new Error("pagamento sem order no provedor");
    c.provedor.atualizarFinanceiro(p.idProvedor, { liberado: true, liberacaoPrevista: new Date(quando.getTime() - 60_000) });
    const { conferirTentativa } = await import("./conferencia");
    await conferirTentativa(c.db, c.org, pagamentoId, c.provedor, quando, { origem: "rotina", forcar: true });
    const depois = await c.tentativa(pagamentoId);
    if (!depois.liberacaoConfirmadaEm) throw new Error(`liberação não confirmada: ${depois.avisos.join(", ")}`);
    return;
  }
  const { registrarLiberacaoManual } = await import("./liberacao");
  const r = await registrarLiberacaoManual(c.db, c.org, pagamentoId, { data: o.data ?? "2026-10-01", liquido: o.liquido ?? p.valor - (p.taxa ?? 1824) }, null, quando);
  if (!r.ok) throw new Error(r.erro);
}

/** Um repasse da parte da dona (antecipado no dia `hoje`, ou o fechamento do mês), pago no mesmo dia salvo `pago: false`. */
export async function repassar(c: Cenario, tipo: "antecipado" | "fechamento", o: { hoje: string; mes?: string; pago?: boolean }): Promise<string> {
  const { fecharMes, gerarAntecipado, marcarRepassePago } = await import("@/repasses/repasses");
  const agora = new Date(`${o.hoje}T12:00:00-03:00`);
  const r = tipo === "antecipado" ? await gerarAntecipado(c.db, c.org, c.dono, o.hoje, null, { agora }) : await fecharMes(c.db, c.org, c.dono, o.mes ?? o.hoje.slice(0, 7), o.hoje, null, agora);
  if (!r.ok || !("id" in r)) throw new Error("erro" in r ? r.erro : "repasse não gerado");
  if (o.pago !== false) {
    const pago = await marcarRepassePago(c.db, c.org, r.id, o.hoje, o.hoje, null);
    if (!pago.ok) throw new Error("erro" in pago ? pago.erro : "repasse não pago");
  }
  return r.id;
}

// ---------------------------------------------------------------- devolução em partes (M8.2d)

type ReservaPaga = { reservaId: string; cotacaoId: string; pagamentoId: string };

/**
 * Uma alteração que muda só o valor da reserva (as datas e os hóspedes ficam), já aplicada como o "Aplicar" a grava (ou
 * segurada, com o prazo `holdAte`).
 */
async function alteracaoAplicada(
  c: Cenario,
  x: ReservaPaga,
  valorDepois: number,
  quando: Date,
  o: { direito?: "integral" | "nenhum"; segurada?: { holdAte: Date } } = {},
): Promise<{ id: string; valorAntes: number }> {
  const r = await c.reserva(x.reservaId);
  const valorAntes = r.valorBruto ?? 0;
  const diferenca = valorDepois - valorAntes;
  const reducao = diferenca < 0;
  const direito = reducao ? (o.direito ?? "integral") : null;
  const [a] = await c.db
    .insert(alteracoesReserva)
    .values({
      organizacaoId: c.org,
      reservaId: x.reservaId,
      cotacaoId: x.cotacaoId,
      pagamentoId: x.pagamentoId,
      situacao: o.segurada ? "segurada" : "aplicada",
      holdAte: o.segurada?.holdAte ?? null,
      quemPede: "hospede",
      pedidoRecebidoEm: quando,
      canal: "whatsapp",
      nota: "WhatsApp da empresa",
      checkinAntes: r.checkin,
      checkoutAntes: r.checkout,
      hospedesAntes: r.hospedes,
      valorAntes,
      checkinDepois: r.checkin,
      checkoutDepois: r.checkout,
      hospedesDepois: r.hospedes ?? 2,
      valorDepois,
      origemValor: "digitado",
      motivoValor: "acordo_com_hospede",
      motivoValorNota: "Acordo por WhatsApp",
      cotacao: { diarias: null, limpeza: null, hospedeExtra: null, valorCheio: null, desconto: 0, total: valorDepois, situacao: "disponivel", leituraEm: null },
      diferenca,
      entradaDaPolitica: r.checkin,
      calculado: direito,
      direito,
      base: reducao ? "prazo" : null,
      valorADevolver: reducao ? (direito === "integral" ? -diferenca : 0) : null,
      assinatura: "assinatura-de-teste",
      aplicadaEm: o.segurada ? null : quando,
      criadoEm: quando,
      atualizadoEm: quando,
    })
    .returning({ id: alteracoesReserva.id });
  return { id: a.id, valorAntes };
}

/** A reserva no valor novo, com a taxa da reserva regravada (`gravarTaxaNaReserva`) e o motor reaplicado. */
async function reservaNoValor(c: Cenario, x: ReservaPaga, valor: number, quando: Date): Promise<void> {
  await c.db.update(reservas).set({ valorBruto: valor, atualizadoEm: quando }).where(eq(reservas.id, x.reservaId));
  await c.db.transaction(async (tx) => {
    const t = await travarCotacao(tx, c.org, x.cotacaoId);
    if (!t) throw new Error("cotação não encontrada");
    await gravarTaxaNaReserva(tx, c.org, t, null, x.pagamentoId, quando);
  });
  await aplicarMotor(c.db, c.org, x.reservaId, null);
}

/**
 * Redução já aplicada (costura do M8.2d): a alteração, as devoluções dela (origem `alteracao`, pedidas, nunca enviadas;
 * padrão: a diferença inteira no pagamento que confirmou) e a reserva no valor novo. O envio é do teste (`tentarDevolucao`).
 */
export async function reduzirDeTeste(
  c: Cenario,
  x: ReservaPaga,
  valorDepois: number,
  o: { quando?: Date; devolucoes?: { pagamentoId: string; valor: number }[]; direito?: "integral" | "nenhum" } = {},
): Promise<{ alteracaoId: string; devolucaoIds: string[] }> {
  const quando = o.quando ?? c.relogio.agora;
  const a = await alteracaoAplicada(c, x, valorDepois, quando, { direito: o.direito });
  const partes = o.devolucoes ?? (o.direito === "nenhum" ? [] : [{ pagamentoId: x.pagamentoId, valor: a.valorAntes - valorDepois }]);
  const ids: string[] = [];
  for (const parte of partes) {
    const [d] = await c.db
      .insert(devolucoesPagamento)
      .values({ organizacaoId: c.org, pagamentoId: parte.pagamentoId, motivo: "Redução da reserva", valor: parte.valor, situacao: "pedida", origem: "alteracao", alteracaoId: a.id, proximaTentativaEm: quando, criadoEm: quando, atualizadoEm: quando })
      .returning({ id: devolucoesPagamento.id });
    ids.push(d.id);
  }
  await reservaNoValor(c, x, valorDepois, quando);
  return { alteracaoId: a.id, devolucaoIds: ids };
}

/**
 * Aumento já aplicado (costura do M8.2d): a alteração e o pagamento da diferença por Pix, aprovado no Mercado Pago falso
 * (taxa `taxa`, padrão 1% da diferença; null = desconhecida), com desfecho `alteracao`, e a reserva no valor novo.
 */
export async function aumentarDeTeste(
  c: Cenario,
  x: ReservaPaga,
  valorDepois: number,
  o: { quando?: Date; taxa?: number | null; liberacaoPrevista?: Date } = {},
): Promise<{ alteracaoId: string; pagamentoId: string; idProvedor: string }> {
  const quando = o.quando ?? c.relogio.agora;
  const a = await alteracaoAplicada(c, x, valorDepois, quando);
  const diferenca = valorDepois - a.valorAntes;
  if (diferenca <= 0) throw new Error("o aumento precisa de valor maior");
  const p0 = await c.tentativa(x.pagamentoId);
  const id = crypto.randomUUID();
  const criada = await c.provedor.criarPix({ referencia: referenciaDaTentativa(id), chaveIdempotencia: chaveCriacao(id), valor: diferenca, email: EMAIL_HOSPEDE, nome: NOME_HOSPEDE, validadeMinutos: 30, descricao: "Diferença da alteração", descricaoFatura: null });
  if (!criada.ok || !criada.cobranca) throw new Error("Pix da diferença não criado");
  const idProvedor = criada.cobranca.idProvedor;
  const taxa = o.taxa === undefined ? Math.round(diferenca / 100) : o.taxa;
  c.provedor.aprovar(idProvedor, taxa === null ? {} : { taxa, liberacaoPrevista: o.liberacaoPrevista ?? null });
  await c.db.insert(pagamentos).values({
    id,
    organizacaoId: c.org,
    cotacaoId: x.cotacaoId,
    reservaId: x.reservaId,
    imovelId: p0.imovelId,
    ambiente: "teste",
    forma: "pix",
    referencia: referenciaDaTentativa(id),
    chaveIdempotencia: chaveCriacao(id),
    situacao: "aprovado",
    idProvedor,
    aoVivo: false,
    detalheProvedor: "processed/accredited",
    valor: diferenca,
    valorPago: diferenca,
    taxa,
    liquido: taxa === null ? null : diferenca - taxa,
    liberacaoPrevistaEm: o.liberacaoPrevista ?? null,
    aprovadoEm: quando,
    consultadoEm: quando,
    desfecho: "alteracao",
    desfechoEm: quando,
    desfechoMotivo: "Diferença da alteração",
    alteracaoId: a.id,
    aceiteId: p0.aceiteId,
    criadoEm: quando,
    atualizadoEm: quando,
  });
  await reservaNoValor(c, { ...x, pagamentoId: id }, valorDepois, quando);
  return { alteracaoId: a.id, pagamentoId: id, idProvedor };
}

/**
 * Uma alteração com as datas seguradas (costura do M8.2d), sem a reserva-pedido: o valor novo ainda não vale. `tentativa`:
 * um Pix da diferença pendente (no Mercado Pago falso), como o hóspede pagando agora.
 */
export async function alteracaoSeguradaDeTeste(
  c: Cenario,
  x: ReservaPaga,
  valorDepois: number,
  o: { quando?: Date; holdAte?: Date; tentativa?: boolean } = {},
): Promise<{ alteracaoId: string; pagamentoId: string | null }> {
  const quando = o.quando ?? c.relogio.agora;
  const a = await alteracaoAplicada(c, x, valorDepois, quando, { segurada: { holdAte: o.holdAte ?? new Date(quando.getTime() + 60 * 60_000) } });
  if (!o.tentativa) return { alteracaoId: a.id, pagamentoId: null };
  const p0 = await c.tentativa(x.pagamentoId);
  const id = crypto.randomUUID();
  const valor = Math.max(1, valorDepois - a.valorAntes);
  const criada = await c.provedor.criarPix({ referencia: referenciaDaTentativa(id), chaveIdempotencia: chaveCriacao(id), valor, email: EMAIL_HOSPEDE, nome: NOME_HOSPEDE, validadeMinutos: 30, descricao: "Diferença da alteração", descricaoFatura: null });
  if (!criada.ok || !criada.cobranca) throw new Error("Pix da diferença não criado");
  await c.db.insert(pagamentos).values({
    id,
    organizacaoId: c.org,
    cotacaoId: x.cotacaoId,
    reservaId: x.reservaId,
    imovelId: p0.imovelId,
    ambiente: "teste",
    forma: "pix",
    referencia: referenciaDaTentativa(id),
    chaveIdempotencia: chaveCriacao(id),
    situacao: "pendente",
    idProvedor: criada.cobranca.idProvedor,
    aoVivo: false,
    valor,
    pixExpiraEm: new Date(quando.getTime() + 30 * 60_000),
    alteracaoId: a.id,
    criadoEm: quando,
    atualizadoEm: quando,
  });
  return { alteracaoId: a.id, pagamentoId: id };
}

// ---------------------------------------------------------------- alteração da reserva paga (M8.2d)

/** O que o formulário do painel manda por padrão numa alteração: o hóspede pediu pelo WhatsApp agora, pela cotação do site e pela política. */
export const entradaAlteracao = (over: Partial<EntradaAlteracao> & Pick<EntradaAlteracao, "checkin" | "checkout" | "hospedes" | "recebidoEm">): EntradaAlteracao => ({
  valor: { origem: "cotacao" },
  quemPede: "hospede",
  motivoEmpresa: null,
  canal: "whatsapp",
  nota: "WhatsApp da empresa",
  decisao: "politica",
  motivoExcecao: null,
  motivoDecisao: "",
  ...over,
});

/**
 * Calcula a prévia da alteração e segura (ou, com `aplicar`, segura e aplica) com a assinatura dela, como o painel: as datas
 * e as pessoas de agora, salvo `over`.
 */
export async function alterar(
  c: Cenario,
  reservaId: string,
  over: Partial<EntradaAlteracao> = {},
  quando: Date = c.relogio.agora,
  o: { aplicar?: boolean; autorId?: string | null; provedor?: ProvedorPagamento | null } = {},
) {
  const r = await c.reserva(reservaId);
  const provedor = o.provedor === undefined ? c.provedor : o.provedor;
  const e = entradaAlteracao({ checkin: r.checkin, checkout: r.checkout, hospedes: r.hospedes ?? 4, recebidoEm: quando, ...over });
  const previa = await previaDaAlteracao(c.db, c.org, reservaId, e, provedor, quando);
  if (!previa.ok) return { previa, resultado: previa, entrada: e };
  const resultado = await segurarAlteracao(c.db, c.org, reservaId, e, o.autorId ?? null, provedor, quando, previa.previa.assinatura, { aplicar: o.aplicar === true });
  return { previa, resultado, entrada: e };
}

/**
 * Paga a diferença de uma alteração segurada (Pix, salvo `forma`) na página da reserva e, salvo `aprovar: false`, aprova no
 * Mercado Pago falso (taxa `taxa`, padrão 1% da diferença) e lê a aprovação 2 minutos depois (`aprovarEm`).
 */
export async function pagarDiferenca(
  c: Cenario,
  cotacaoId: string,
  alteracaoId: string,
  o: { forma?: "pix" | "cartao"; quando?: Date; aprovarEm?: Date; taxa?: number | null; aprovar?: boolean; cartao?: Partial<DadosCartaoDoHospede> } = {},
): Promise<{ pagamentoId: string; idProvedor: string; resultado: string }> {
  const quando = o.quando ?? c.relogio.agora;
  let pagamentoId: string;
  let idProvedor: string;
  let resultado: string;
  if (o.forma === "cartao") {
    const antes = new Set((await c.db.select({ id: pagamentos.id }).from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId))).map((x) => x.id));
    const r = await pagarComCartao(c.db, c.org, cotacaoId, quando, c.provedor, { ...CARTAO_FICTICIO, ...o.cartao }, { alteracaoId });
    const nova = (await c.db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId))).find((x) => !antes.has(x.id));
    if (!nova?.idProvedor) throw new Error(`cartão da diferença não criado: ${r.ok ? r.situacao : r.codigo}`);
    pagamentoId = nova.id;
    idProvedor = nova.idProvedor;
    resultado = r.ok ? r.situacao : r.codigo;
    return { pagamentoId, idProvedor, resultado };
  }
  const r = await gerarPix(c.db, c.org, cotacaoId, quando, c.provedor, { alteracaoId });
  if (!r.ok) throw new Error(`${r.codigo}: ${r.erro}`);
  const p = await c.tentativa(r.pagamentoId);
  pagamentoId = p.id;
  idProvedor = p.idProvedor!;
  resultado = "pendente";
  if (o.aprovar !== false) {
    const taxa = o.taxa === undefined ? Math.round(p.valor / 100) : o.taxa;
    c.provedor.aprovar(idProvedor, taxa === null ? {} : { taxa });
    const { conferirTentativa } = await import("./conferencia");
    const lido = await conferirTentativa(c.db, c.org, pagamentoId, c.provedor, o.aprovarEm ?? minutos(2, quando), { origem: "rotina", forcar: true });
    resultado = lido.ok ? lido.situacao : lido.erro;
  }
  return { pagamentoId, idProvedor, resultado };
}

/** A alteração gravada. */
export async function alteracaoGravada(c: Cenario, id: string) {
  const [a] = await c.db.select().from(alteracoesReserva).where(eq(alteracoesReserva.id, id));
  return a;
}
