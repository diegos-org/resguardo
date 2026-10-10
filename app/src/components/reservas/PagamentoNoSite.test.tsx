import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";
vi.mock("@/pagamentos/acoes-painel", () => ({
  conferirAgoraAcao: vi.fn(),
  devolverAcao: vi.fn(),
  devolucaoPorForaAcao: vi.fn(),
  registrarLiberacaoAcao: vi.fn(),
  estornarLiberacaoAcao: vi.fn(),
  registrarTaxaPerdidaAcao: vi.fn(),
  confirmarDevolucaoVistaAcao: vi.fn(),
  registrarRecusaNoPainelAcao: vi.fn(),
  pararDevolucaoPedidaAcao: vi.fn(),
  corrigirTaxaPerdidaAcao: vi.fn(),
}));
import { AVISOS_PAGAMENTO } from "@/pagamentos/situacoes";
import { DEVOLUCAO_FALHOU_CARTAO, NAO_INFORME_O_MOTIVO, PagamentoNoSite, situacaoEmPalavras } from "./PagamentoNoSite";

const sem = { conferir: false, devolver: false, devolucaoPorFora: false, registrarLiberacao: false, estornarLiberacao: false, registrarTaxaPerdida: false };
const base: PagamentoDoPainel = {
  id: "11111111-1111-4111-8111-111111111111",
  cotacaoId: "c",
  reservaId: "r",
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
  consultadoEm: new Date("2026-10-01T15:06:00Z"),
  criadoEm: new Date("2026-10-01T15:00:00Z"),
  desfecho: "reserva",
  desfechoEm: new Date("2026-10-01T15:05:00Z"),
  motivoSemReserva: null,
  motivoSemReservaTexto: null,
  avisos: [],
  devolucao: null,
  pedeAtencao: false,
  acoes: { ...sem, conferir: true, registrarLiberacao: true },
};
const html = (p: PagamentoDoPainel[], o: { verValores?: boolean; editar?: boolean } = {}) =>
  renderToStaticMarkup(<PagamentoNoSite pagamentos={p} verValores={o.verValores ?? true} editar={o.editar ?? true} hoje="2026-10-09" />);

describe("quadro Pagamento no site", () => {
  it("sem tentativas, nada aparece", () => {
    expect(html([])).toBe("");
  });

  it("quem só lê reservas vê forma, situação em palavras, datas e o selo de teste — nenhum valor nem ação", () => {
    const h = html([base], { verValores: false, editar: false });
    expect(h).toContain("Pagamento no site");
    expect(h).toContain("Pix");
    expect(h).toContain("Aprovado: confirmou a reserva");
    expect(h).toContain("pagamento de teste");
    expect(h).toContain("01/10/2026");
    expect(h).not.toContain("R$");
    expect(h).not.toContain("Taxa do Mercado Pago");
    expect(h).not.toContain("<form");
  });

  it("quem lê o financeiro vê valor, taxa, líquido e a liberação prevista; sem editar, nenhuma ação", () => {
    const h = html([base], { editar: false });
    expect(h).toContain("R$ 1.824,00");
    expect(h).toContain("R$ 18,06");
    expect(h).toContain("R$ 1.805,94");
    expect(h).toContain("o Mercado Pago libera em 20/10/2026 (previsão)");
    expect(h).not.toContain("<form");
  });

  it("quem edita o financeiro vê só as ações que o pagamento permite; registrar liberação pede confirmação, com data até hoje", () => {
    const h = html([base]);
    expect(h).toContain("Conferir agora");
    expect(h).toContain("Registrar liberação");
    expect(h).toContain('max="2026-10-09"');
    expect(h).toContain('value="1805,94"');
    expect(h).not.toContain("Devolver pelo Mercado Pago");
    expect(h).not.toContain("Estornar liberação");
    expect(h).not.toContain("Registrar devolução feita por fora");
    expect(h).toContain(`name="pagamentoId" value="${base.id}"`);
  });

  it("aprovado sem reserva: o motivo, o aviso de devolver e as duas devoluções", () => {
    const p: PagamentoDoPainel = {
      ...base,
      desfecho: null,
      desfechoEm: null,
      motivoSemReserva: "conflito:SCL-123",
      motivoSemReservaTexto: "As noites ficaram ocupadas pela reserva SCL-123.",
      pedeAtencao: true,
      avisos: ["O Mercado Pago marcou este pagamento como real (live_mode) no ambiente de teste."],
      acoes: { ...sem, conferir: true, devolver: true, devolucaoPorFora: true },
    };
    const h = html([p]);
    expect(situacaoEmPalavras(p)).toBe("Aprovado sem reserva: As noites ficaram ocupadas pela reserva SCL-123. O valor precisa ser devolvido ao hóspede.");
    expect(h).toContain("pede atenção");
    expect(h).toContain("live_mode");
    expect(h).toContain("Devolver pelo Mercado Pago");
    expect(h).toContain("Registrar devolução feita por fora");
    expect(h).toContain('name="nota"');
    expect(h).toContain('value="1824,00"');
    expect(h).not.toContain("Registrar liberação");
    // Sem quem lê o financeiro, a pergunta não leva o valor (a ação continua exigindo financeiro:editar no servidor).
    expect(html([p], { verValores: false })).not.toContain("1.824");
  });

  it("liberação registrada à mão: estornar com motivo e confirmação; devolução por fora e Pix aguardando em palavras", () => {
    const manual: PagamentoDoPainel = { ...base, liberacaoConfirmadaEm: new Date("2026-10-08T15:00:00Z"), liberacaoOrigem: "manual", acoes: { ...sem, conferir: true, estornarLiberacao: true } };
    const h = html([manual]);
    expect(h).toContain("registrada à mão em 08/10/2026");
    expect(h).toContain("Estornar liberação");
    expect(h).toMatch(/<input required=""[^>]*name="motivo"/);
    const porFora: PagamentoDoPainel = {
      ...base,
      desfecho: "por_fora",
      devolucao: { situacao: "por_fora", valor: 182400, tentativas: 0, falhas: 0, confirmadaEm: null, porForaData: "2026-10-05", porForaValor: 182400, porForaNota: "Pix da empresa", taxaPerdida: null },
      acoes: sem,
    };
    expect(html([porFora])).toContain("feita por fora · R$ 1.824,00 · em 05/10/2026 · nota: Pix da empresa");
    // Recusada: o quadro não afirma que o Mercado Pago não fez; manda conferir lá antes.
    const recusada: PagamentoDoPainel = { ...base, desfecho: null, devolucao: { situacao: "recusada", valor: 182400, tentativas: 3, falhas: 3, confirmadaEm: null, porForaData: null, porForaValor: null, porForaNota: "", taxaPerdida: null }, acoes: sem };
    const hr = html([recusada]);
    expect(hr).toContain("o Mercado Pago recusou ou não respondeu três vezes: confira no painel do Mercado Pago antes de tentar de novo ou de registrar a devolução feita por fora");
    expect(hr).not.toContain("não fez");
    // Devolução confirmada sem a taxa que não voltou: o formulário para a equipe informar, com confirmação.
    const confirmada: PagamentoDoPainel = {
      ...base,
      desfecho: "devolucao",
      devolucao: { situacao: "confirmada", valor: 182400, tentativas: 1, falhas: 0, confirmadaEm: new Date("2026-10-02T15:00:00Z"), porForaData: null, porForaValor: null, porForaNota: "", taxaPerdida: null },
      acoes: { ...sem, registrarTaxaPerdida: true },
    };
    const hc = html([confirmada]);
    expect(hc).toContain("Registrar taxa que não voltou");
    expect(hc).toContain('name="valor"');
    expect(html([confirmada], { editar: false })).not.toContain("Registrar taxa que não voltou");
    const pendente: PagamentoDoPainel = { ...base, situacao: "pendente", desfecho: null, pixExpiraEm: new Date("2026-10-01T15:30:00Z"), acoes: { ...sem, conferir: true } };
    expect(situacaoEmPalavras(pendente)).toBe("Aguardando o pagamento do Pix (vale até 12:30 de 01/10/2026)");
  });

  it("aceite das páginas legais (M7.4): por tentativa, as versões com link para cada uma, o prazo do reembolso dessa política e quando; tentativa sem aceite diz que não foi registrado", () => {
    const comAceite: PagamentoDoPainel = { ...base, aceite: { versoes: { termos: 1, privacidade: 2, cancelamento: 3 }, aceitoEm: new Date("2026-10-01T15:02:00Z"), diasReembolsoIntegral: 14 } };
    // Mesmo quem só lê reservas vê o aceite (não é valor).
    const h = html([comAceite], { verValores: false, editar: false });
    expect(h).toContain("<dt");
    expect(h).toContain(">Aceite</dt>");
    expect(h).toContain('<a href="/termos?versao=1" target="_blank" rel="noopener noreferrer">Termos v1</a>');
    expect(h).toContain('<a href="/privacidade?versao=2" target="_blank" rel="noopener noreferrer">Privacidade v2</a>');
    expect(h).toContain('<a href="/cancelamento?versao=3" target="_blank" rel="noopener noreferrer">Cancelamento v3</a> (reembolso integral até 14 dias antes)');
    expect(h).toContain(" — 01/10/2026, 12:02");
    expect(html([{ ...base, aceite: null }])).toContain("não registrado (tentativa anterior às páginas legais do site)");
    // Sem o campo (tentativa montada sem ele), nada é dito.
    expect(html([base])).not.toContain(">Aceite</dt>");
  });
});

describe("cartão de crédito no quadro (M8.2b)", () => {
  const cartao: PagamentoDoPainel = {
    ...base,
    forma: "cartao",
    valorPago: 191520,
    idProvedor: "ORDTST0001",
    referencia: "scl-11111111-1111-4111-8111-111111111111",
    idPagamentoProvedor: "123456789",
    parcelas: 3,
    bandeira: "visa",
    tresDS: "on_fraud_risk",
    tresDSStatus: "AUTHENTICATED",
    etapaCartao: null,
    juros: 9120,
    custoParcelasVendedor: null,
    motivoRecusa: null,
  };
  const recusado: PagamentoDoPainel = { ...cartao, situacao: "recusado", desfecho: null, desfechoEm: null, valorPago: null, juros: null, tresDSStatus: "NOT_AUTHENTICATED", motivoRecusa: "Recusado pelo banco emissor do cartão.", acoes: { ...sem, conferir: true } };

  it("quem só lê reservas: forma com bandeira e parcelas, situação genérica e os identificadores no Mercado Pago com copiar — nenhum motivo, verificação do banco, juros ou valor", () => {
    const h = html([recusado], { verValores: false, editar: false });
    expect(h).toContain("<strong>Cartão de crédito · Visa · 3x</strong>");
    expect(h).toContain("Recusado pelo Mercado Pago");
    expect(h).toContain("<code>ORDTST0001</code>");
    expect(h).toContain("<code>scl-11111111-1111-4111-8111-111111111111</code>");
    expect(h).toContain("<code>pagamento 123456789</code>");
    expect(h.match(/>Copiar</g)).toHaveLength(3);
    expect(h).not.toContain("banco emissor");
    expect(h).not.toContain(NAO_INFORME_O_MOTIVO);
    expect(h).not.toContain("Verificação do banco");
    expect(h).not.toContain("juros");
    expect(h).not.toContain("R$");
    // Nunca BIN, últimos dígitos ou titular (nem existem na tentativa).
    expect(h).not.toMatch(/últimos|BIN|titular/i);
  });

  it("quem lê o financeiro: o motivo com a linha de não informar ao hóspede, a verificação do banco e o resultado, os juros e o custo do sem acréscimo", () => {
    const h = html([recusado], { editar: false });
    expect(h).toContain("Motivo (só para a equipe)");
    expect(h).toContain("Recusado pelo banco emissor do cartão.");
    expect(h).toContain(`<strong>${NAO_INFORME_O_MOTIVO}</strong>`);
    expect(h).toContain("quando houver risco (resultado deste pagamento: não autenticado)");
    const pago = html([{ ...cartao, custoParcelasVendedor: 4560 }], { editar: false });
    expect(pago).toContain("Valor da reserva");
    expect(pago).toContain("R$ 1.915,20 (inclui R$ 91,20 de juros do parcelamento, que ficam com o Mercado Pago)");
    expect(pago).toContain("quando houver risco (resultado deste pagamento: autenticado pelo banco)");
    expect(pago).toContain("Custo do parcelamento sem acréscimo cobrado da SCL");
    expect(pago).toContain("R$ 45,60");
  });

  it("situação em palavras do cartão (igual para toda a equipe): desafio até quando, análise, processando, criação sem resposta", () => {
    const pendente = { ...cartao, situacao: "pendente" as const, desfecho: null };
    expect(situacaoEmPalavras({ ...pendente, etapaCartao: "desafio" })).toBe("Aguardando a verificação do banco do hóspede (até 12:40)");
    expect(situacaoEmPalavras({ ...pendente, etapaCartao: "analise" })).toBe("Em análise no Mercado Pago (pode levar até 2 dias úteis)");
    expect(situacaoEmPalavras({ ...pendente, etapaCartao: "processando" })).toBe("O Mercado Pago está processando");
    expect(situacaoEmPalavras({ ...cartao, situacao: "incerta", desfecho: null })).toBe("Conferindo no Mercado Pago se o pagamento foi criado");
    expect(situacaoEmPalavras(cartao)).toBe("Aprovado: confirmou a reserva");
  });

  it("devolução recusada no cartão: o aviso fala do saldo antes da liberação; por fora pergunta com o risco da contestação", () => {
    const parada: PagamentoDoPainel = { ...cartao, desfecho: null, motivoSemReserva: "noites_ocupadas", motivoSemReservaTexto: "As noites ficaram ocupadas.", avisos: [AVISOS_PAGAMENTO.devolucao_falhou], acoes: { ...sem, devolucaoPorFora: true } };
    const h = html([parada]);
    expect(h).toContain(DEVOLUCAO_FALHOU_CARTAO);
    expect(html([{ ...parada, forma: "pix" }])).toContain(AVISOS_PAGAMENTO.devolucao_falhou);
    expect(h).toContain("Registrar devolução feita por fora");
  });

  it("introdução fala de Pix e cartão", () => {
    expect(html([cartao])).toContain("Cada tentativa de pagamento (Pix ou cartão) feita pelo hóspede no site.");
  });
});

describe("reserva cancelada pela política no quadro (M8.2c)", () => {
  const devolucao = (over: Partial<NonNullable<PagamentoDoPainel["devolucao"]>> = {}): NonNullable<PagamentoDoPainel["devolucao"]> => ({
    situacao: "pedida",
    valor: 182400,
    tentativas: 1,
    falhas: 0,
    confirmadaEm: null,
    porForaData: null,
    porForaValor: null,
    porForaNota: "",
    taxaPerdida: null,
    origem: "cancelamento",
    ultimoCodigo: null,
    confirmadaPor: null,
    confirmadaNota: "",
    valorConfirmado: null,
    recusaNoPainelEm: null,
    paradaEm: null,
    paradaPeloPrazo: false,
    ...over,
  });
  const cancelado = (over: Partial<PagamentoDoPainel> = {}): PagamentoDoPainel => ({ ...base, cancelada: { estado: "cancelada_devolucao_pedida", estornoPelaEquipe: false }, devolucao: devolucao(), acoes: sem, ...over });

  it("a situação em palavras é a da reserva cancelada (as mesmas da página do hóspede); o texto antigo do M8.2c virou M8.2d", () => {
    expect(situacaoEmPalavras(cancelado())).toBe("Reserva cancelada: devolução pedida");
    expect(situacaoEmPalavras(cancelado({ cancelada: { estado: "cancelada_devolucao_pedida", estornoPelaEquipe: true } }))).toBe(
      "Reserva cancelada: devolução pelo painel do Mercado Pago (pagamento com mais de 78 dias)",
    );
    expect(situacaoEmPalavras(cancelado({ cancelada: { estado: "cancelada_devolvida", estornoPelaEquipe: false } }))).toBe("Reserva cancelada: devolvida");
    expect(situacaoEmPalavras(cancelado({ cancelada: { estado: "cancelada_com_a_equipe", estornoPelaEquipe: false } }))).toBe("Reserva cancelada: com a equipe");
    expect(situacaoEmPalavras(cancelado({ cancelada: { estado: "cancelada_em_conferencia", estornoPelaEquipe: false } }))).toBe("Reserva cancelada: em conferência");
    expect(situacaoEmPalavras(cancelado({ cancelada: { estado: "cancelada_sem_devolucao", estornoPelaEquipe: false }, devolucao: null }))).toBe("Reserva cancelada: sem devolução (valor retido)");
    const parcial: PagamentoDoPainel = { ...base, situacao: "devolvido_parcial", desfecho: null, motivoSemReservaTexto: "Chegou já devolvido em parte." };
    expect(situacaoEmPalavras(parcial)).toContain("a devolução de parte do valor pelo sistema chega no M8.2d");
    expect(situacaoEmPalavras(parcial)).not.toContain("M8.2c");
  });

  it("a linha da devolução explica a espera ou a recusa pelo último código do Mercado Pago, a confirmação da equipe e a parada pelo prazo", () => {
    expect(html([cancelado({ devolucao: devolucao({ ultimoCodigo: "em_andamento" }) })])).toContain("o Mercado Pago pediu para esperar: o sistema tenta de novo sozinho");
    expect(html([cancelado({ devolucao: devolucao({ situacao: "recusada", falhas: 3, ultimoCodigo: "saldo_insuficiente" }) })])).toContain("o Mercado Pago pediu saldo disponível na conta: coloque saldo e peça de novo");
    const equipe = cancelado({ devolucao: devolucao({ situacao: "confirmada", confirmadaEm: new Date("2026-10-03T15:00:00Z"), confirmadaPor: "equipe", confirmadaNota: "painel mostra devolvida" }) });
    expect(html([equipe])).toContain("confirmada pelo Mercado Pago · R$ 1.824,00 · em 03/10/2026 · confirmada pela equipe: painel mostra devolvida");
    expect(html([equipe], { verValores: false })).not.toContain("painel mostra devolvida");
    // A parada pelo prazo vem da regra do domínio (aviso do pagamento com mais de 78 dias), nunca adivinhada pelos números:
    // a parada por outro motivo (devolvido em parte, contestado, outra referência) também fica recusada sem falha nem código.
    expect(html([cancelado({ devolucao: devolucao({ situacao: "recusada", tentativas: 0, falhas: 0, paradaPeloPrazo: true }) })])).toContain("parada pelo prazo: o pagamento tem mais de 78 dias");
    const paradaPorOutroMotivo = html([cancelado({ devolucao: devolucao({ situacao: "recusada", tentativas: 1, falhas: 0, paradaPeloPrazo: false }) })]);
    expect(paradaPorOutroMotivo).not.toContain("parada pelo prazo");
    expect(paradaPorOutroMotivo).not.toContain("mais de 78 dias");
    // Parada depois de uma espera pedida pelo Mercado Pago: a recusada não "tenta de novo sozinha".
    expect(html([cancelado({ devolucao: devolucao({ situacao: "recusada", falhas: 0, ultimoCodigo: "em_andamento" }) })])).not.toContain("o sistema tenta de novo sozinho");
    expect(html([cancelado({ devolucao: devolucao({ situacao: "recusada", falhas: 0, recusaNoPainelEm: new Date("2026-10-04T15:00:00Z") }) })])).toContain("recusada no painel do Mercado Pago (registrado pela equipe)");
    expect(html([cancelado({ devolucao: devolucao({ situacao: "confirmada", confirmadaEm: new Date("2026-10-03T15:00:00Z"), valorConfirmado: 177400 }) })])).toContain("o Mercado Pago mostrou R$ 1.774,00 devolvidos");
  });

  it("as ações novas aparecem só quando o domínio permite: pedir de novo, confirmar a vista no painel, registrar a recusa, parar e corrigir a taxa", () => {
    const todas = cancelado({
      devolucao: devolucao({ situacao: "recusada", falhas: 3, taxaPerdida: 1806 }),
      acoes: { ...sem, devolver: true, confirmarDevolucaoVista: true, registrarRecusaNoPainel: true, pararDevolucaoPedida: true, corrigirTaxaPerdida: true },
    });
    const h = html([todas]);
    expect(h).toContain("Pedir a devolução de novo");
    expect(h).not.toContain("Devolver pelo Mercado Pago");
    expect(h).toContain("Confirmar devolução feita no painel do Mercado Pago");
    expect(h).toContain("Confirme só se o painel do Mercado Pago mostra a devolução <strong>do valor integral</strong> concluída.");
    expect(h).toContain("Registrar que o Mercado Pago recusou a devolução no painel");
    expect(h).toContain("Parar a devolução pedida");
    expect(h).toContain("Corrigir taxa que não voltou");
    expect(h).toContain('name="motivo"');
    const nenhuma = html([cancelado()]);
    for (const t of ["Pedir a devolução de novo", "Confirmar devolução feita no painel", "Registrar que o Mercado Pago recusou", "Parar a devolução pedida", "Corrigir taxa que não voltou"]) expect(nenhuma).not.toContain(t);
    // Sem financeiro:editar, nenhuma.
    expect(html([todas], { editar: false })).not.toContain("<form");
  });

  it("o quadro do cancelamento entra dentro da seção, antes das tentativas", () => {
    const h = renderToStaticMarkup(<PagamentoNoSite pagamentos={[cancelado()]} verValores editar={false} hoje="2026-10-09" cancelamento={<div id="quadro-do-cancelamento" />} />);
    expect(h.indexOf('id="quadro-do-cancelamento"')).toBeGreaterThan(h.indexOf("Pagamento no site"));
    expect(h.indexOf('id="quadro-do-cancelamento"')).toBeLessThan(h.indexOf("<article"));
  });
});
