import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlteracaoDoPainel } from "@/pagamentos/alteracao-painel";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";

const m = vi.hoisted(() => ({
  sessao: vi.fn(),
  reserva: vi.fn(),
  pagamentos: vi.fn(),
  lancamentos: vi.fn(),
  recebimentos: vi.fn(),
  aceites: vi.fn(),
  devolvida: vi.fn(),
  cancelamento: vi.fn(),
  momentos: vi.fn(),
  historico: vi.fn(),
  alteracoes: vi.fn(),
  portador: vi.fn(),
  noBeds24: vi.fn(),
  conversas: vi.fn(),
  configWhatsapp: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, redirect: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/reservas/repositorio", () => ({ obterReserva: m.reserva, devolvidaNoProvedorDaReserva: m.devolvida }));
vi.mock("@/reservas/horarios", async (original) => ({ ...(await original<typeof import("@/reservas/horarios")>()), lerHorariosReservas: async () => new Map() }));
vi.mock("@/imoveis/repositorio", () => ({ obterImovel: async () => ({ id: "im", codigo: "403", nome: "Studio Fictício" }) }));
vi.mock("@/auditoria/auditoria", async (original) => ({ ...(await original<typeof import("@/auditoria/auditoria")>()), historicoDe: m.historico }));
vi.mock("@/financeiro/ledger", () => ({ listarLancamentos: m.lancamentos }));
vi.mock("@/imoveis/recebimento", () => ({ lerRecebimento: async () => ({}) }));
vi.mock("@/configuracoes/regras-financeiras", () => ({ lerRegrasFinanceiras: async () => ({ recebimento: { site: "empresa" } }) }));
vi.mock("@/repasses/recebimentos", () => ({ recebimentosDaReserva: m.recebimentos, recebidoPorReserva: async () => new Map() }));
vi.mock("@/pagamentos/consultas", () => ({ pagamentosDaReserva: m.pagamentos }));
vi.mock("@/site/aceites", () => ({ aceitesDaReserva: m.aceites }));
vi.mock("@/reservas/acoes", () => ({ cancelar: vi.fn(), confirmar: vi.fn(), resolverConferenciaAcao: vi.fn(), salvarEmailHospedeAcao: vi.fn() }));
vi.mock("@/reservas/horarios-acoes", () => ({ alterarHorarioAcao: vi.fn() }));
vi.mock("@/repasses/acoes", () => ({ estornarRecebimentoAcao: vi.fn(), registrarRecebimentoAcao: vi.fn() }));
vi.mock("@/pagamentos/acoes-painel", () => ({
  conferirAgoraAcao: vi.fn(),
  devolverAcao: vi.fn(),
  devolucaoPorForaAcao: vi.fn(),
  registrarLiberacaoAcao: vi.fn(),
  estornarLiberacaoAcao: vi.fn(),
  registrarTaxaPerdidaAcao: vi.fn(),
  pedirRestanteAcao: vi.fn(),
}));
// M8.2d: as alterações da reserva e a reserva-pedido que segura as novas noites.
vi.mock("@/pagamentos/alteracao-painel", () => ({ alteracoesDaReserva: m.alteracoes, alteracaoDoPortador: m.portador }));
vi.mock("@/pagamentos/acoes-alteracao", () => ({
  calcularAlteracaoAcao: vi.fn(),
  segurarAlteracaoAcao: vi.fn(),
  previaDaAplicacaoAcao: vi.fn(),
  aplicarAlteracaoAcao: vi.fn(),
  desistirDaAlteracaoAcao: vi.fn(),
  marcarOtaAtualizadaAcao: vi.fn(),
  marcarHospedeAvisadoAlteracaoAcao: vi.fn(),
}));
vi.mock("@/pagamentos/cancelamento-painel", () => ({ cancelamentoDaReserva: m.cancelamento, momentosDoCancelamento: m.momentos }));
vi.mock("@/pagamentos/acoes-cancelamento", () => ({
  calcularCancelamentoAcao: vi.fn(),
  cancelarReservaPagaAcao: vi.fn(),
  registrarPedidoCancelamentoAcao: vi.fn(),
  descartarPedidoCancelamentoAcao: vi.fn(),
  marcarOtaLiberadaAcao: vi.fn(),
  marcarHospedeAvisadoAcao: vi.fn(),
}));
// A pergunta do BotaoConfirmar fica no atributo (o componente de verdade só a mostra no clique).
vi.mock("@/components/BotaoConfirmar", () => ({
  BotaoConfirmar: ({ pergunta, children, ...props }: { pergunta: string | (() => string); children?: React.ReactNode }) => (
    <button type="submit" data-pergunta={typeof pergunta === "string" ? pergunta : ""} {...props}>
      {children}
    </button>
  ),
}));
// M8.3a: o bloco "No Beds24" (só leitura; "Simular" sem rede).
vi.mock("@/beds24/reservas-site-painel", () => ({ fichaReservaNoBeds24: m.noBeds24 }));
vi.mock("@/beds24/acoes-reservas", () => ({
  simularReservaBeds24Acao: vi.fn(),
  marcarDatasFechadasNasOtasAcao: vi.fn(),
  marcarDatasReabertasNasOtasAcao: vi.fn(),
  // M8.3c (bloco G): os botões do envio.
  conferirAgoraBeds24Acao: vi.fn(),
  tentarDeNovoBeds24Acao: vi.fn(),
  deixarAMaoBeds24Acao: vi.fn(),
  reenviarAoBeds24Acao: vi.fn(),
  naoExisteNoBeds24Acao: vi.fn(),
  vincularIdDoBeds24Acao: vi.fn(),
  passarAoSistemaBeds24Acao: vi.fn(),
}));
// M10.1a: o bloco "Conversa no WhatsApp". Quem vê as conversas é decidido de verdade (`whatsapp/acesso.ts`), com a
// configuração "Quem vê as conversas" simulada; as conversas da reserva também.
vi.mock("@/whatsapp/configuracao", async (original) => ({ ...(await original<typeof import("@/whatsapp/configuracao")>()), lerConfigWhatsapp: m.configWhatsapp }));
vi.mock("@/whatsapp/conversas", async (original) => ({ ...(await original<typeof import("@/whatsapp/conversas")>()), conversasDaReserva: m.conversas }));
import Page, { maxDuration } from "./page";

const reserva = {
  id: "r1",
  codigo: "SCL-TESTE1",
  imovelId: "im",
  origem: "site",
  estado: "confirmada",
  checkin: "2026-10-12",
  checkout: "2026-10-15",
  reservadaEm: new Date("2026-10-01T15:00:00Z"),
  criadoEm: new Date("2026-10-01T15:00:00Z"),
  hospedes: 4,
  hospedeNome: "Visitante Fictício",
  hospedeEmail: "visitante@example.com",
  hospedeTelefone: "",
  hospedeOrigem: "",
  valorBruto: 182400,
  taxaCanal: 1806,
  valorLiquido: 180594,
  recebimento: null,
  observacoes: "",
  codigoCanal: "",
  divergenciaEm: null,
  conferenciaResolvidaEm: null,
};
const pagamento: PagamentoDoPainel = {
  id: "11111111-1111-4111-8111-111111111111",
  cotacaoId: "c",
  reservaId: "r1",
  forma: "pix",
  situacao: "aprovado",
  ambiente: "teste",
  aoVivo: false,
  valor: 182400,
  valorPago: 182400,
  taxa: 1806,
  liquido: 180594,
  liberacaoPrevistaEm: new Date("2026-10-20T15:00:00Z"),
  liberacaoConfirmadaEm: null,
  liberacaoOrigem: null,
  pixExpiraEm: null,
  aprovadoEm: new Date("2026-10-01T15:05:00Z"),
  consultadoEm: null,
  criadoEm: new Date("2026-10-01T15:00:00Z"),
  desfecho: "reserva",
  desfechoEm: new Date("2026-10-01T15:05:00Z"),
  motivoSemReserva: null,
  motivoSemReservaTexto: null,
  avisos: [],
  devolucao: null,
  pedeAtencao: false,
  acoes: { conferir: true, devolver: false, devolucaoPorFora: false, registrarLiberacao: true, estornarLiberacao: false, registrarTaxaPerdida: false },
};
beforeEach(() => {
  vi.clearAllMocks();
  m.reserva.mockResolvedValue(reserva);
  m.pagamentos.mockResolvedValue([pagamento]);
  m.lancamentos.mockResolvedValue([]);
  m.recebimentos.mockResolvedValue([]);
  m.aceites.mockResolvedValue([]);
  m.devolvida.mockResolvedValue(false);
  m.cancelamento.mockResolvedValue(null);
  m.momentos.mockResolvedValue({ entradaEm: new Date("2026-10-12T18:00:00Z"), naoComparecimentoApos: new Date("2026-10-13T15:00:00Z"), fuso: "America/Sao_Paulo" });
  m.historico.mockResolvedValue([]);
  m.alteracoes.mockResolvedValue([]);
  m.portador.mockResolvedValue(null);
  m.noBeds24.mockResolvedValue(null);
  m.conversas.mockResolvedValue({ confirmadas: [], sugeridas: 0 });
  m.configWhatsapp.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas: "so_admin" });
});
const html = async (busca: Record<string, string> = {}) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "r1" }), searchParams: Promise.resolve(busca) } as PageProps<"/painel/reservas/[id]">));

it("operação (lê reservas, não o financeiro): vê o quadro com situação e o selo de teste, sem valores nem ações", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const h = await html();
  expect(m.pagamentos).toHaveBeenCalledWith({}, "org", "r1");
  expect(h).toContain('aria-label="Pagamento no site"');
  expect(h).toContain("Aprovado: confirmou a reserva");
  expect(h).toContain("pagamento de teste");
  expect(h).not.toContain("Taxa do Mercado Pago");
  expect(h).not.toContain("Registrar liberação");
  expect(h).not.toContain("Conferir agora");
});

it("admin (lê e edita o financeiro): valores e as ações que o pagamento permite", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const h = await html();
  expect(h).toContain("Taxa do Mercado Pago");
  expect(h).toContain("R$ 18,06");
  expect(h).toContain("Conferir agora");
  expect(h).toContain("Registrar liberação");
});

it("reserva sem pagamento no site: nenhum quadro", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.pagamentos.mockResolvedValue([]);
  expect(await html()).not.toContain('aria-label="Pagamento no site"');
});

it("reserva de outra empresa (não encontrada pela sessão): 404 sem ler pagamentos", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.reserva.mockResolvedValue(null);
  await expect(html()).rejects.toThrow("NEXT_NOT_FOUND");
  expect(m.pagamentos).not.toHaveBeenCalled();
});

it("páginas legais aceitas no site (M7.4): a seção aparece para quem lê reservas, com as versões e o link de cada uma; sem aceite, nada", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.pagamentos.mockResolvedValue([]);
  expect(await html()).not.toContain('aria-label="Páginas legais aceitas"');
  expect(m.aceites).toHaveBeenCalledWith({}, "org", "r1");
  m.aceites.mockResolvedValue([{ id: "a1", versoes: { termos: 2, privacidade: 1, cancelamento: 3 }, aceitoEm: new Date("2026-10-01T15:02:00Z"), origem: "pix" }]);
  const h = await html();
  expect(h).toContain('aria-label="Páginas legais aceitas"');
  expect(h).toContain('<a href="/termos?versao=2" target="_blank" rel="noopener noreferrer">Termos de uso (versão 2)</a>');
  expect(h).toContain('<a href="/privacidade?versao=1" target="_blank" rel="noopener noreferrer">Política de privacidade (versão 1)</a>');
  expect(h).toContain('<a href="/cancelamento?versao=3" target="_blank" rel="noopener noreferrer">Política de cancelamento (versão 3)</a>');
  expect(h).toContain("01/10/2026 às 12:02, ao gerar o Pix");
  // Sem reserva:ler (ex.: limpeza), nem se consulta.
  m.aceites.mockClear();
  m.sessao.mockResolvedValue({ papel: "limpeza", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  expect(await html()).not.toContain('aria-label="Páginas legais aceitas"');
  expect(m.aceites).not.toHaveBeenCalled();
});

it("M8.2c (D21): pagamento do site devolvido no Mercado Pago fora da política — o quadro \"Em conferência\" aparece, com o motivo e o botão de dar por resolvida", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.lancamentos.mockResolvedValue([{ id: "l1", origem: "motor", estornoDe: null, competencia: "2026-10-01", descricao: "Parte do proprietário", valor: 150000, efeitoSaldo: 150000, estado: "previsto" }]);
  // Sem a devolução no Mercado Pago, a reserva confirmada e sem divergência não está em conferência.
  expect(await html()).not.toContain('aria-label="Em conferência"');
  expect(m.devolvida).toHaveBeenCalledWith({}, "org", "r1");
  m.devolvida.mockResolvedValue(true);
  const h = await html();
  expect(h).toContain('aria-label="Em conferência"');
  expect(h).toContain("O Mercado Pago mostra o pagamento desta reserva devolvido fora do sistema: a parte do proprietário não é repassada.");
  expect(h).toContain("Dar a conferência por resolvida");
  // Já dada por resolvida: o quadro some (e nem se consulta de novo).
  m.devolvida.mockClear();
  m.reserva.mockResolvedValue({ ...reserva, conferenciaResolvidaEm: new Date("2026-10-05T12:00:00Z") });
  expect(await html()).not.toContain('aria-label="Em conferência"');
  expect(m.devolvida).not.toHaveBeenCalled();
});

it("M8.2c: reserva paga pelo site — o botão de cancelar de sempre some; o cancelamento pela política fica no quadro do pagamento", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const h = await html();
  expect(h).not.toContain(">Cancelar reserva</button>");
  expect(h).toContain('aria-label="Cancelamento pela política"');
  expect(h).toContain("Calcular o cancelamento pela política");
  expect(h.indexOf('aria-label="Cancelamento pela política"')).toBeGreaterThan(h.indexOf('aria-label="Pagamento no site"'));
  expect(m.cancelamento).toHaveBeenCalledWith({}, "org", "r1", expect.any(Date));
  expect(m.momentos).toHaveBeenCalledWith({}, "org", "r1");
  // A operação (sem o financeiro) registra o pedido; não calcula e não lê os momentos do cálculo.
  m.momentos.mockClear();
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const op = await html();
  expect(op).toContain("Registrar pedido de cancelamento");
  expect(op).not.toContain("Calcular o cancelamento");
  expect(m.momentos).not.toHaveBeenCalled();
});

it("M8.2c: reserva sem pagamento no site continua com o botão de cancelar de sempre e sem o quadro do cancelamento", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.pagamentos.mockResolvedValue([{ ...pagamento, desfecho: null }]);
  const h = await html();
  expect(h).toContain(">Cancelar reserva</button>");
  expect(h).not.toContain('aria-label="Cancelamento pela política"');
  expect(m.cancelamento).not.toHaveBeenCalled();
});

it("M8.2c: o resultado da ação do cancelamento vem só de chaves conhecidas", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  expect(await html({ cancelamento: "pedida" })).toContain("Reserva cancelada. Devolução pedida ao Mercado Pago: a confirmação aparece aqui quando ele concluir (use Conferir agora).");
  expect(await html({ cancelamento: "pedido_registrado" })).toContain("Pedido de cancelamento registrado");
  expect(await html({ cancelamento: "qualquer coisa" })).not.toContain("Reserva cancelada.");
});

// ---------------------------------------------------------------- M8.2d: alteração de reserva paga pelo site

const ALTERACAO_ID = "33333333-3333-4333-8333-333333333333";
const alteracao = (over: Partial<AlteracaoDoPainel> = {}): AlteracaoDoPainel => ({
  id: ALTERACAO_ID,
  situacao: "aplicada",
  quemPede: "hospede",
  motivoEmpresa: null,
  canal: "whatsapp",
  pedidoRecebidoEm: new Date("2026-10-01T15:30:00Z"),
  antes: { checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, valor: 182400 },
  depois: { checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, valor: 121600 },
  diferenca: -60800,
  valorNovo: 121600,
  origemValor: "cotacao",
  motivoValor: null,
  noitesNovas: null,
  holdAte: new Date("2026-10-01T16:30:00Z"),
  emCarencia: false,
  criadaEm: new Date("2026-10-01T15:35:00Z"),
  criadaPor: "Equipe Fictícia",
  aplicadaEm: new Date("2026-10-01T15:36:00Z"),
  aplicadaPor: "Equipe Fictícia",
  aplicadaTardia: false,
  expiradaEm: null,
  desistidaEm: null,
  desistidaPor: null,
  desistenciaMotivo: "",
  direito: "integral",
  base: "prazo",
  valorADevolver: 60800,
  politicaVersao: 1,
  integralAte: "2026-09-28",
  entradaDaPolitica: "2026-10-12",
  resultado: {
    meses: [{ mes: "2026-10", antes: { bruto: 182400, taxa: -1806, comissao: 27090, parte: 153504 }, depois: { bruto: 121600, taxa: -1204, comissao: 18060, parte: 102336 } }],
  },
  ota: null,
  avisados: { proposta: null, confirmacao: null, devolucao: null },
  devolucao: { estado: "aguardando_liberacao", valor: 60800, valorConfirmado: null, em: null, previstaEm: "2026-10-20", porFora: false, algumaPorFora: false, forma: "pix" },
  tentativas: [],
  mensagens: { proposta: null, confirmada: { texto: "Olá! A alteração da sua reserva SCL-TESTE1 está confirmada: 12/10–14/10, R$ 1.216,00.", falta: [], textoBase: true }, devolvida: null },
  ...over,
});
const historicoDaAlteracao = [
  {
    id: "h1",
    acao: "reserva.alterar",
    mudancas: { checkin: ["2026-10-12", "2026-10-12"], checkout: ["2026-10-15", "2026-10-14"], valorBruto: [182400, 121600], diferenca: [null, -60800], alteracao: [null, ALTERACAO_ID] },
    criadoEm: new Date("2026-10-01T15:36:00Z"),
    autor: "Equipe Fictícia",
  },
];
const longe = { entradaEm: new Date("2099-10-12T18:00:00Z"), naoComparecimentoApos: new Date("2099-10-13T15:00:00Z"), fuso: "America/Sao_Paulo" };

it("M8.2d: a operação vê a alteração aplicada sem nenhum valor (ficha, observações e histórico) e marca as OTAs; o admin vê os valores e o financeiro", async () => {
  m.reserva.mockResolvedValue({ ...reserva, checkout: "2026-10-14", valorBruto: 121600, observacoes: "Alterada em 01/10: de 12/10–15/10 (3 noites, 4 pessoas) para 12/10–14/10 (2 noites, 4 pessoas)." });
  m.alteracoes.mockResolvedValue([alteracao()]);
  m.historico.mockResolvedValue(historicoDaAlteracao);
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const op = await html();
  expect(m.alteracoes).toHaveBeenCalledWith({}, "org", "r1", expect.any(Date));
  expect(op).toContain('aria-label="Alteração da reserva"');
  expect(op).toContain("Alteração aplicada");
  expect(op).toContain("de 12/10–15/10 (3 noites, 4 pessoas) para 12/10–14/10 (2 noites, 4 pessoas)");
  expect(op).toContain("Esta reserva foi paga pelo site: a alteração é feita por quem cuida do financeiro.");
  expect(op).toContain("Datas atualizadas nas OTAs");
  expect(op).toContain("quem cuida do financeiro copia e envia esta mensagem");
  // Nenhum valor para quem não lê o financeiro: nem na ficha, nem nas observações, nem no histórico.
  expect(op).not.toContain("R$");
  expect(op).not.toMatch(/182400|121600|60800/);
  expect(op).not.toContain("Valor bruto");
  expect(op).not.toContain("Diferença (centavos)");
  expect(op).not.toContain("Copiar mensagem");
  expect(op).not.toContain("Calcular a alteração");
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const ad = await html();
  expect(ad).toContain("devolução de R$ 608,00 pela política");
  expect(ad).toContain("Devolução de R$ 608,00: esperando o Mercado Pago liberar o pagamento (previsto para 20/10): nada foi pedido ainda");
  expect(ad).toContain('aria-label="Financeiro da alteração"');
  expect(ad).toContain("-R$ 608,00");
  expect(ad).toContain("Copiar mensagem: alteração confirmada");
  expect(ad).toContain("Diferença (centavos)");
});

it("M8.2d: alteração segurada — o que espera, sem valores para a operação; o admin aplica (sem aumento) ou desiste, e o formulário some", async () => {
  m.momentos.mockResolvedValue(longe);
  const segurada = alteracao({ situacao: "segurada", aplicadaEm: null, aplicadaPor: null, holdAte: new Date("2099-10-01T16:30:00Z"), devolucao: null, resultado: null, mensagens: { proposta: { texto: "Olá! Preparamos a alteração…", falta: [], textoBase: true }, confirmada: null, devolvida: null } });
  m.alteracoes.mockResolvedValue([segurada]);
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const ad = await html();
  expect(ad).toContain("Alteração com as novas datas seguradas");
  expect(ad).toContain("esperando a confirmação do hóspede");
  expect(ad).toContain("Copiar a proposta");
  expect(ad).toContain("Conferir para aplicar (o hóspede aceitou)");
  expect(ad).toContain("Desistir da alteração");
  expect(ad).not.toContain("Calcular a alteração");
  // Aumento: o pagamento da diferença aplica sozinho (sem "Aplicar").
  m.alteracoes.mockResolvedValue([{ ...segurada, diferenca: 40000, direito: null, base: null, valorADevolver: null }]);
  const aumento = await html();
  expect(aumento).toContain("esperando o pagamento da diferença");
  expect(aumento).not.toContain("Conferir para aplicar");
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const op = await html();
  expect(op).toContain("Alteração com as novas datas seguradas");
  expect(op).not.toContain("R$");
  expect(op).not.toContain("Desistir da alteração");
  expect(op).not.toContain("Copiar a proposta");
});

it("M8.2d: o formulário da alteração é do financeiro, com a reserva confirmada, sem cancelamento e antes da entrada", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.momentos.mockResolvedValue(longe);
  const h = await html();
  expect(h).toContain("Calcular a alteração");
  expect(h).toContain('name="checkin" value="2026-10-12"');
  expect(h).toContain("Manter o valor atual (R$ 1.824,00)");
  m.cancelamento.mockResolvedValue({ situacao: "pedido", pedidoRecebidoEm: new Date("2026-10-01T15:30:00Z"), canal: "whatsapp", pedidoPor: null, quemCancela: "hospede", descartados: [], mensagens: { recebido: null, decidido: null, devolvida: null }, avisados: { pedido: null, decisao: null, devolucao: null } });
  const comPedido = await html();
  expect(comPedido).not.toContain("Calcular a alteração");
  expect(comPedido).toContain("Há um pedido de cancelamento desta reserva: decida ou descarte o pedido antes de alterar.");
  m.cancelamento.mockResolvedValue(null);
  m.momentos.mockResolvedValue({ ...longe, entradaEm: new Date("2020-01-01T18:00:00Z") });
  const iniciou = await html();
  expect(iniciou).not.toContain("Calcular a alteração");
  expect(iniciou).toContain("A estadia já começou: a alteração pelo sistema vale só antes da entrada.");
});

it("M8.2d: a reserva-pedido que segura as novas noites não confirma, não cancela, não guarda e-mail nem horários: aponta para a reserva alterada", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.reserva.mockResolvedValue({ ...reserva, id: "p1", codigo: "SCL-PORTA1", estado: "pedido", fonte: "alteracao", idFonte: ALTERACAO_ID, hospedeNome: "Alteração SCL-TESTE1", hospedeEmail: "", valorBruto: null });
  m.pagamentos.mockResolvedValue([]);
  m.portador.mockResolvedValue({ alteracaoId: ALTERACAO_ID, reservaId: "r1", reservaCodigo: "SCL-TESTE1", holdAte: new Date("2026-10-01T16:30:00Z"), situacao: "segurada" });
  const h = await html();
  expect(h).toContain('Datas seguradas para a alteração da reserva <a href="/painel/reservas/r1">SCL-TESTE1</a> até 01/10 às 13:30.');
  expect(h).not.toContain("Confirmar reserva");
  expect(h).not.toContain(">Cancelar reserva</button>");
  expect(h).not.toContain('aria-label="E-mail do hóspede"');
  expect(h).not.toContain("Sem e-mail do hóspede");
  expect(h).not.toContain('aria-label="Horários combinados"');
  expect(h).not.toContain("Pedido de reserva: ainda aguarda confirmação na origem");
});

it("M8.2d: o resultado da ação da alteração vem só de chaves conhecidas (o valor só para quem lê o financeiro)", async () => {
  m.alteracoes.mockResolvedValue([alteracao()]);
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  expect(await html({ alteracao: "aplicada_liberacao" })).toContain("Alteração aplicada. Devolução de R$ 608,00 pedida quando o Mercado Pago liberar o pagamento (previsto para 20/10).");
  expect(await html({ alteracao: "desistida" })).toContain("Alteração desfeita: as novas datas voltaram à venda e a reserva continua como estava.");
  expect(await html({ alteracao: "qualquer coisa" })).not.toContain("Alteração aplicada.");
  m.alteracoes.mockResolvedValue([alteracao({ situacao: "segurada", holdAte: new Date("2026-10-01T16:30:00Z"), aplicadaEm: null })]);
  // O prazo de outro dia leva o dia (revisão do M8.2d); a ficha usa o relógio de agora.
  expect(await html({ alteracao: "segurada" })).toMatch(/Datas seguradas até (01\/10 às )?13:30: copie a proposta para o hóspede\./);
  m.alteracoes.mockResolvedValue([alteracao()]);
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const op = await html({ alteracao: "aplicada_pedida" });
  expect(op).toContain("Alteração aplicada. Devolução da diferença pedida ao Mercado Pago");
  expect(op).not.toContain("R$");
});

it("M8.2d (D26): a operação, em cada caso da alteração — aumento aplicado, redução retida, cada resultado e pagamentos com avisos, devoluções e notas com valor — nunca vê R$ nem valores na ficha, nas observações e no histórico", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  const VALORES = /R\$|182400|222400|40000|60800|121600|29700|1\.824|2\.224|400,00|608,00/;
  const observacoes = "Alterada em 01/10: de 12/10–15/10 (3 noites, 4 pessoas) para 12/10–16/10 (4 noites, 4 pessoas).";
  const historico = (valorDepois: number, diferenca: number) => [
    { id: "h1", acao: "reserva.alterar", mudancas: { checkout: ["2026-10-15", "2026-10-16"], valorBruto: [182400, valorDepois], diferenca: [null, diferenca], alteracao: [null, ALTERACAO_ID] }, criadoEm: new Date("2026-10-01T15:36:00Z"), autor: "Equipe Fictícia" },
  ];
  // Aumento aplicado pelo pagamento da diferença: o pagamento da reserva (com um aviso que leva valor) e o da diferença.
  const aumento = alteracao({
    depois: { checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, valor: 222400 },
    diferenca: 40000,
    valorNovo: 222400,
    noitesNovas: { inicio: "2026-10-15", fim: "2026-10-16" },
    aplicadaPor: null,
    direito: null,
    base: null,
    valorADevolver: null,
    devolucao: null,
    resultado: { meses: [{ mes: "2026-10", antes: { bruto: 182400, taxa: -1806, comissao: 27090, parte: 153504 }, depois: { bruto: 222400, taxa: -2202, comissao: 33030, parte: 187168 } }] },
    tentativas: [{ id: "p2", forma: "pix", situacao: "aprovado", criadoEm: new Date("2026-10-01T15:40:00Z"), desfecho: "alteracao" }],
  });
  const diferenca: PagamentoDoPainel = { ...pagamento, id: "22222222-2222-4222-8222-222222222222", desfecho: "alteracao", alteracaoId: ALTERACAO_ID, valor: 40000, valorPago: 40000, taxa: 396, liquido: 39604 };
  const comAviso: PagamentoDoPainel = {
    ...pagamento,
    avisos: ["A liberação deste pagamento passou da data prevista e a devolução de R$ 608,00 continua esperando: confira no painel do Mercado Pago e registre a liberação à mão quando ela aparecer."],
    avisosSemValores: ["A liberação deste pagamento passou da data prevista e a devolução de parte do valor continua esperando: confira no painel do Mercado Pago e registre a liberação à mão quando ela aparecer."],
  };
  m.reserva.mockResolvedValue({ ...reserva, checkout: "2026-10-16", valorBruto: 222400, taxaCanal: 2202, valorLiquido: 220198, observacoes });
  m.alteracoes.mockResolvedValue([aumento]);
  m.historico.mockResolvedValue(historico(222400, 40000));
  m.pagamentos.mockResolvedValue([comAviso, diferenca]);
  const op = await html();
  expect(op).toContain("Alteração aplicada");
  expect(op).toContain("Aprovado: pagou a diferença da alteração");
  expect(op).toContain("a devolução de parte do valor continua esperando");
  expect(op).toContain(observacoes);
  expect(op).not.toMatch(VALORES);
  // O admin vê os mesmos com os valores (a regra é a permissão, não a falta do dado).
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  expect(await html()).toContain("a devolução de R$ 608,00 continua esperando");
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });

  // Redução retida pela política (o valor da reserva continua o mesmo, com as datas novas).
  const retida = alteracao({ direito: "nenhum", base: "prazo", valorADevolver: 0, valorNovo: 182400, devolucao: null, mensagens: { proposta: null, confirmada: null, devolvida: null } });
  m.reserva.mockResolvedValue({ ...reserva, checkout: "2026-10-14", observacoes: "Alterada em 01/10: de 12/10–15/10 (3 noites, 4 pessoas) para 12/10–14/10 (2 noites, 4 pessoas)." });
  m.alteracoes.mockResolvedValue([retida]);
  m.historico.mockResolvedValue(historico(182400, -60800));
  // O pagamento com uma devolução de cada tipo e as notas livres (que podem trazer valor).
  const linha = {
    id: "44444444-4444-4444-8444-444444444444",
    origem: "alteracao",
    alteracaoId: ALTERACAO_ID,
    valor: 60800,
    situacao: "confirmada" as const,
    valorConfirmado: 29700,
    ultimoCodigo: null,
    avisos: ["devolucao_a_menor"],
    restanteDe: null,
    temRestante: false,
    caixaLancadoEm: null,
    taxaPerdida: 297,
    criadoEm: new Date("2026-10-01T15:36:00Z"),
    confirmadaEm: new Date("2026-10-02T15:00:00Z"),
    porForaData: null,
    porForaValor: null,
    tentativas: 1,
    falhas: 0,
    confirmadaPor: "equipe" as const,
    confirmadaNota: "painel mostra R$ 297,00 devolvidos",
    porForaNota: "",
    recusaNoPainelEm: null,
    paradaEm: null,
    paradaPeloPrazo: false,
    aguardandoLiberacao: false,
    restanteSemReserva: null,
    acoes: { conferir: true, pedirDeNovo: false, porFora: false, confirmarVista: false, registrarRecusaNoPainel: false, parar: false, registrarTaxa: false, corrigirTaxa: true, pedirRestante: true, restantePorFora: true },
  };
  const porFora = { ...linha, id: "55555555-5555-4555-8555-555555555555", situacao: "por_fora" as const, valor: 31100, valorConfirmado: null, avisos: [], taxaPerdida: null, porForaData: "2026-10-03", porForaValor: 31100, porForaNota: "Pix de R$ 311,00 da conta da empresa", restanteDe: linha.id };
  m.pagamentos.mockResolvedValue([
    {
      ...pagamento,
      situacao: "devolvido_parcial",
      devolucoes: [linha, porFora],
      avisos: ["O Mercado Pago devolveu R$ 297,00 de R$ 608,00 pedidos nesta devolução: o que voltou já está no financeiro. Peça o restante ao Mercado Pago ou registre o restante devolvido por fora."],
      avisosSemValores: ["O Mercado Pago devolveu menos do que foi pedido nesta devolução: o que voltou já está no financeiro. Peça o restante ao Mercado Pago ou registre o restante devolvido por fora."],
      foraReconhecido: 0,
      devolvidoLido: 29700,
      restante: null,
    },
  ]);
  const retidaOp = await html();
  expect(retidaOp).toContain("Devolução da alteração de 01/10/2026: confirmada pela equipe (vista no painel do Mercado Pago) em 02/10/2026");
  expect(retidaOp).toContain("Restante de uma devolução: feita por fora em 03/10/2026");
  expect(retidaOp).toContain("O Mercado Pago devolveu menos do que foi pedido nesta devolução");
  expect(retidaOp).not.toContain("nota:");
  // As ações de dinheiro de cada devolução são do financeiro.
  expect(retidaOp).not.toContain("Pedir o restante ao Mercado Pago");
  expect(retidaOp).not.toContain("Corrigir taxa que não voltou");
  expect(retidaOp).not.toMatch(VALORES);

  // Cada resultado de ação no endereço, para a operação: nenhum valor (a devolução da última aplicada sem o valor).
  m.alteracoes.mockResolvedValue([alteracao()]);
  m.pagamentos.mockResolvedValue([pagamento]);
  for (const chave of ["segurada", "aplicada_pedida", "aplicada_liberacao", "aplicada_fora_do_prazo", "aplicada_sem_devolucao", "aplicada", "desistida", "ota", "avisado"]) {
    const h = await html({ alteracao: chave });
    expect(h).toContain('role="status"');
    expect(h).not.toMatch(VALORES);
  }
});

/** Um cancelamento pela política já decidido (a devolução integral), sem a marca das OTAs. */
const cancelada = {
  id: "c1",
  situacao: "cancelada",
  pedidoRecebidoEm: new Date("2026-10-01T15:30:00Z"),
  pedidoRegistradoOriginalEm: null,
  motivoMomento: "",
  canal: "whatsapp",
  pedidoPor: "Equipe Fictícia",
  quemCancela: "hospede",
  motivoEmpresa: null,
  motivoExcecao: null,
  politicaVersao: 1,
  integralAte: "2026-10-26",
  arrependimentoAte: "2026-10-08",
  arrependimentoAteEntrada: true,
  entradaEm: new Date("2026-10-12T18:00:00Z"),
  calculado: "integral",
  direito: "integral",
  base: "prazo",
  motivoDecisao: "",
  nota: "",
  valorPago: 182400,
  valorADevolver: 182400,
  canceladaEm: new Date("2026-10-01T16:00:00Z"),
  canceladaPor: "Equipe Fictícia",
  resultadoLancadoEm: new Date("2026-10-01T16:00:00Z"),
  espelhado: false,
  caixaLancadoEm: null,
  ota: null,
  descontos: [],
  avisados: { pedido: null, decisao: null, devolucao: null },
  descartados: [],
  mensagens: { recebido: null, decidido: null, devolvida: null },
};

describe("M8.3a: a reserva do site no Beds24 (só leitura)", () => {
  // Muda junto (M8.3c, bloco G): a ficha ganhou `acoes` (os botões do envio que valem agora); aqui, nenhum. M3.11b: e `direta`.
  const ficha = { desligada: ["ambiente", "chave", "credencial", "imovel", "sem_acompanhamento"], beds24Id: null, acompanhamento: null, operacoes: [], simular: true, pedido: null, tarefas: [], atencoes: [], acoes: { botoes: [], candidato: null, duplicadas: [], vincularSemMarca: false, automatico: false }, direta: null };
  const tarefa = (caso: string, texto: string, marca: string | null = null) => ({ reservaId: "r1", codigo: "SCL-TESTE1", caso, estado: "manual", checkin: "2026-10-12", checkout: "2026-10-15", desde: new Date(0), alteracaoIds: [], texto, marca });
  beforeEach(() => {
    m.reserva.mockResolvedValue({ ...reserva, fonte: "site" });
    m.noBeds24.mockResolvedValue(ficha);
  });

  it.each(["admin", "operacao"])("%s vê o bloco da reserva do site e o Simular (reserva:editar)", async (papel) => {
    m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    const h = await html();
    expect(m.noBeds24).toHaveBeenCalledWith({}, "org", "r1", process.env, expect.any(Date));
    expect(h).toContain('aria-label="Reserva no Beds24"');
    expect(h).toContain(">Simular</button>");
  });

  it("o resultado do Simular vem só de chaves conhecidas", async () => {
    m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    expect(await html({ beds24: "simulada_imovel_desligado" })).toContain("Simulação gravada");
    expect(await html({ beds24: "nada_marketplace" })).toContain("Nada seria enviado ao Beds24: o contrato é de marketplace");
    expect(await html({ beds24: "<b>forjada</b>" })).not.toContain("forjada");
  });

  it("M8.3b: a tarefa das OTAs da reserva com o botão da marca, e o texto dela no cancelamento e na alteração pagos pelo site", async () => {
    m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    m.noBeds24.mockResolvedValue({ ...ficha, tarefas: [tarefa("paga", "Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.", "datas_fechadas")] });
    const h = await html();
    expect(h).toContain("Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.");
    expect(h).toContain(">Datas fechadas nas OTAs</button>");
    // O resultado da marca e a recusa (o texto do domínio, em `?erro=`).
    expect(await html({ beds24: "ota_fechada" })).toContain("Datas marcadas como fechadas nas OTAs.");
    expect(await html({ erro: "Esta reserva não tem datas a fechar à mão nas OTAs agora." })).toContain("Esta reserva não tem datas a fechar à mão nas OTAs agora.");
    // A cancelada e a alterada pela política: o texto da tarefa (o mesmo do Início) no quadro do pagamento.
    m.cancelamento.mockResolvedValue(cancelada);
    m.reserva.mockResolvedValue({ ...reserva, fonte: "site", estado: "cancelada" });
    m.noBeds24.mockResolvedValue({ ...ficha, tarefas: [tarefa("cancelada_bloqueio", "Mude o bloqueio de 12/10 a 15/10 para Cancelado (não apague).")] });
    const fichaCancelada = await html();
    expect(fichaCancelada).toContain("Mude o bloqueio de 12/10 a 15/10 para Cancelado (não apague).");
    expect(fichaCancelada).not.toContain("Mude o bloqueio para Cancelado no Beds24 (não apague).");
    m.reserva.mockResolvedValue({ ...reserva, fonte: "site", checkout: "2026-10-16" });
    m.cancelamento.mockResolvedValue(null);
    m.alteracoes.mockResolvedValue([alteracao({ antes: { checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, valor: 182400 }, depois: { checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, valor: 235200 } })]);
    m.noBeds24.mockResolvedValue({ ...ficha, tarefas: [tarefa("alterada_bloqueio", "Mude as datas do bloqueio para 12/10 a 16/10 (não apague nem crie outro).")] });
    expect(await html()).toContain("Mude as datas do bloqueio para 12/10 a 16/10 (não apague nem crie outro).");
  });

  it("M8.3b: a confirmada à mão (sem pagamento pelo site) marcada como fechada nas OTAs: o \"Cancelar reserva\" de sempre diz o que fazer depois", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
      m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
      m.pagamentos.mockResolvedValue([]);
      const marcada = (situacao: string) => ({ ...ficha, acompanhamento: { situacao, motivo: null, quarto: null, conferidaEm: null, lido: null, lidoEm: null, otaFechadaEm: new Date("2026-10-02T12:00:00Z"), otaFechadaAMao: true } });
      m.noBeds24.mockResolvedValue(marcada("manual"));
      expect(await html()).toContain(
        'data-pergunta="Cancelar a reserva SCL-TESTE1? O financeiro dela será estornado. As datas foram marcadas como fechadas nas OTAs: depois de cancelar, no Beds24, mude o bloqueio de 12/10 a 15/10 para Cancelado (não apague) e marque Datas reabertas nas OTAs aqui na ficha."',
      );
      const deSempre = 'data-pergunta="Cancelar a reserva SCL-TESTE1? O financeiro dela será estornado."';
      // Só quando a tarefa vai existir depois: o acompanhamento manual (não o encerrado nem o do sistema) e a saída depois de hoje.
      for (const situacao of ["encerrada", "conferida", "pendente"]) {
        m.noBeds24.mockResolvedValue(marcada(situacao));
        expect(await html()).toContain(deSempre);
      }
      m.noBeds24.mockResolvedValue(marcada("manual"));
      vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
      expect(await html()).toContain(deSempre);
      // Sem a marca, a pergunta de sempre.
      vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
      m.noBeds24.mockResolvedValue(ficha);
      expect(await html()).toContain(deSempre);
    } finally {
      vi.useRealTimers();
    }
  });

  it("M8.3c (bloco G): os botões do envio pela permissão da sessão (a operação nunca vê os de configuração), o resultado em ?beds24= e a recusa em ?erro=", async () => {
    m.noBeds24.mockResolvedValue({ ...ficha, desligada: [], acoes: { ...ficha.acoes, botoes: ["conferir_agora", "deixar_a_mao", "nao_existe", "vincular"], candidato: "900001" } });
    m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    const admin = await html();
    for (const b of [">Conferir agora</button>", ">Deixar à mão</button>", ">Não existe, pode criar</button>", ">Vincular o id</button>"]) expect(admin).toContain(b);
    m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    const operacao = await html();
    expect(operacao).toContain(">Conferir agora</button>");
    expect(operacao).toContain(">Deixar à mão</button>");
    expect(operacao).not.toContain(">Não existe, pode criar</button>");
    expect(operacao).not.toContain(">Vincular o id</button>");
    expect(operacao).not.toContain('name="beds24Id"');
    expect(await html({ beds24: "na_fila" })).toContain("Na fila: o sistema envia ao Beds24 em até 10 minutos");
    expect(await html({ erro: "Ainda não deu 5 minutos desde o envio." })).toContain("Ainda não deu 5 minutos desde o envio.");
  });

  it("M8.3c (bloco G): a ficha tem a duração dos botões que leem o Beds24 (300 s, como Integrações)", () => {
    expect(maxDuration).toBe(300);
  });

  it("reserva de outra fonte (Beds24, planilha, manual): sem o bloco e sem ler nada dele", async () => {
    m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    for (const fonte of ["beds24", "csv", "manual", "alteracao"]) {
      m.reserva.mockResolvedValue({ ...reserva, fonte });
      expect(await html()).not.toContain('aria-label="Reserva no Beds24"');
    }
    // M3.11b: a direta e a de OTA com o id do Beds24, e a importada do Beds24, também não (a regra `reservaDiretaParaOtas`).
    for (const r of [{ origem: "direta", fonte: "beds24", beds24Id: "900001" }, { origem: "direta", fonte: "manual", beds24Id: "900001" }, { origem: "airbnb", fonte: "manual", beds24Id: null }]) {
      m.reserva.mockResolvedValue({ ...reserva, ...r });
      expect(await html()).not.toContain('aria-label="Reserva no Beds24"');
    }
    expect(m.noBeds24).not.toHaveBeenCalled();
  });

  it.each(["admin", "operacao"])("M3.11b: a reserva direta confirmada no SCL tem o bloco para %s (o aviso e a marca), com o lembrete no Cancelar quando marcada; o proprietário não", async (papel) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
      m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });
      m.reserva.mockResolvedValue({ ...reserva, origem: "direta", fonte: "manual", beds24Id: null });
      m.pagamentos.mockResolvedValue([]);
      const semMarca = { ...ficha, desligada: [], simular: false, tarefas: [tarefa("direta", "Reserva direta SCL-TESTE1: feche as datas de 12/10 a 15/10 no Beds24 como bloqueio (não crie reserva lá).", "datas_fechadas")], direta: { fechadasEm: null, reabertasEm: null } };
      m.noBeds24.mockResolvedValue(semMarca);
      const h = await html();
      expect(m.noBeds24).toHaveBeenCalledWith({}, "org", "r1", process.env, expect.any(Date));
      expect(h).toContain('aria-label="Reserva no Beds24"');
      expect(h).toContain("Reserva direta SCL-TESTE1: feche as datas de 12/10 a 15/10 no Beds24 como bloqueio (não crie reserva lá).");
      expect(h).toContain(">Datas fechadas nas OTAs</button>");
      expect(h).not.toContain(">Simular</button>");
      expect(h).not.toContain("marcadas como fechadas nas OTAs: depois de cancelar");
      // Marcada: o "Cancelar reserva" lembra de reabrir as datas e marcar (até o dia da saída); depois dela, não; reaberta, não.
      const marcada = { ...semMarca, tarefas: [], direta: { fechadasEm: new Date("2026-10-02T12:00:00Z"), reabertasEm: null } };
      m.noBeds24.mockResolvedValue(marcada);
      const lembrete = "As datas foram marcadas como fechadas nas OTAs: depois de cancelar, no Beds24, mude o bloqueio de 12/10 a 15/10 para Cancelado (não apague) e marque Datas reabertas nas OTAs aqui na ficha.";
      expect(await html()).toContain(lembrete);
      vi.setSystemTime(new Date("2026-10-15T15:00:00Z"));
      expect(await html()).toContain(lembrete);
      vi.setSystemTime(new Date("2026-10-16T15:00:00Z"));
      expect(await html()).not.toContain("marcadas como fechadas nas OTAs: depois de cancelar");
      vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
      m.noBeds24.mockResolvedValue({ ...marcada, direta: { fechadasEm: new Date("2026-10-02T12:00:00Z"), reabertasEm: new Date("2026-10-03T12:00:00Z") } });
      expect(await html()).not.toContain("marcadas como fechadas nas OTAs: depois de cancelar");
      m.sessao.mockResolvedValue({ papel: "proprietario", organizacaoId: "org", usuarioId: "u", imovelIds: ["im"] });
      m.noBeds24.mockClear();
      expect(await html()).not.toContain('aria-label="Reserva no Beds24"');
      expect(m.noBeds24).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("M10.1a: Conversa no WhatsApp na ficha", () => {
  const CONVERSA = "33333333-3333-4333-8333-333333333333";
  const comConversa = {
    confirmadas: [
      {
        id: CONVERSA,
        nome: "Visitante Fictício",
        ultimaMensagemEm: new Date("2026-10-11T15:00:00Z"),
        mensagens: [
          { id: "m1", direcao: "recebida", previa: "Chego às 15:00, tudo certo?", enviadaEm: new Date("2026-10-11T14:00:00Z") },
          { id: "m2", direcao: "enviada_celular", previa: "Tudo certo!", enviadaEm: new Date("2026-10-11T15:00:00Z") },
        ],
      },
    ],
    sugeridas: 2,
  };

  it("o admin vê o bloco: a conversa confirmada com as últimas mensagens e o link, e as sugestões apontando para a caixa de entrada", async () => {
    m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    m.conversas.mockResolvedValue(comConversa);
    const h = await html();
    expect(m.conversas).toHaveBeenCalledWith({}, expect.objectContaining({ papel: "admin", organizacaoId: "org" }), "r1", expect.any(Date));
    expect(h).toContain('aria-label="Conversa no WhatsApp"');
    expect(h).toContain("Conversa no WhatsApp");
    expect(h).toContain(" · última mensagem 11/10/2026 às 12:00");
    expect(h).toContain("Cliente · 11/10 às 11:00: Chego às 15:00, tudo certo?");
    expect(h).toContain("Celular · 11/10 às 12:00: Tudo certo!");
    expect(h).toContain(`href="/painel/mensagens/${CONVERSA}"`);
    expect(h).toContain(">Abrir a conversa<");
    expect(h).toContain("2 conversa(s) com sugestão de vínculo a esta reserva: ");
    expect(h).toContain('href="/painel/mensagens?filtro=sem_vinculo"');
  });

  it("sem conversa confirmada nem sugestão: o bloco não aparece", async () => {
    m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    expect(await html()).not.toContain("Conversa no WhatsApp");
  });

  it("operação com o padrão só o admin: o bloco não aparece e conversasDaReserva não é chamada", async () => {
    m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    m.conversas.mockResolvedValue(comConversa);
    const h = await html();
    expect(m.configWhatsapp).toHaveBeenCalledWith({}, "org");
    expect(m.conversas).not.toHaveBeenCalled();
    expect(h).not.toContain("Conversa no WhatsApp");
    expect(h).not.toContain("/painel/mensagens");
  });

  it("com a configuração liberada (admin e operação), a operação vê o bloco", async () => {
    m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    m.configWhatsapp.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas: "admin_e_operacao" });
    m.conversas.mockResolvedValue(comConversa);
    expect(await html()).toContain("Conversa no WhatsApp");
    expect(m.conversas).toHaveBeenCalledTimes(1);
  });

  it("o proprietário nunca vê o bloco, com qualquer valor da configuração (nem a configuração é lida)", async () => {
    m.sessao.mockResolvedValue({ papel: "proprietario", organizacaoId: "org", usuarioId: "u", imovelIds: ["im"] });
    m.configWhatsapp.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas: "admin_e_operacao" });
    m.conversas.mockResolvedValue(comConversa);
    const h = await html();
    expect(h).toContain("SCL-TESTE1");
    expect(m.configWhatsapp).not.toHaveBeenCalled();
    expect(m.conversas).not.toHaveBeenCalled();
    expect(h).not.toContain("Conversa no WhatsApp");
  });
});
