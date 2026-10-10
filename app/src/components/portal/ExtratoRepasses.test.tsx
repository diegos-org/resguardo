import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { classificarParte, type ParteBruta } from "@/repasses/extrato";
import { REGRAS_REPASSES_PADRAO } from "@/repasses/periodicidade";
import type { ItemDoRepasse, Repasse } from "@/repasses/repasses";
import { ExtratoRepasses } from "./ExtratoRepasses";

const parte = (over: Partial<ParteBruta> = {}): ParteBruta => ({
  lancamentoId: Math.random().toString(36).slice(2), proprietarioId: "d1", reservaId: "r1", codigoReserva: "R-1", imovelId: "i1", codigoImovel: "403", competencia: "2026-10-01", valor: 72250, efeitoSaldo: 72250, estado: "previsto",
  checkin: "2026-10-10", checkout: "2026-10-13", hospede: "Hóspede Fictício", origem: "booking", hoje: "2026-10-12", recebido: { recebido: 85000, devido: 85000 }, pagamento: null, emConferencia: false, repasse: null, ...over,
});
const repasse = (over: Partial<Repasse> = {}): Repasse => ({
  id: "rep1", organizacaoId: "org", proprietarioId: "d1", tipo: "antecipado", mes: "2026-10-01", data: "2026-10-11", saldo: 72250, descontado: 0, contestado: 0, valor: 72250, foraDoFechamento: 0, antecipado: 72250, situacao: "pago", dataPagamento: "2026-10-11",
  comprovante: "E2E-1", comprovanteArquivoId: "arq", emailSituacao: "enviado", emailEm: new Date("2026-10-11T15:00:00Z"), emailPara: "dona@example.com", emailChave: "", emailTentativaEm: null, emailPedido: null, chavePixPaga: "", pedidoEm: new Date("2026-10-11T10:00:00Z"), motivoEstorno: "", criadoPor: null, criadoEm: new Date("2026-10-11T10:00:00Z"), estornadoEm: null, ...over,
});
const item = (over: Partial<ItemDoRepasse> = {}): ItemDoRepasse => ({
  id: "it1", organizacaoId: "org", repasseId: "rep1", lancamentoId: "l1", reservaId: "r1", imovelId: "i1", competencia: "2026-10-01", valor: 72250, criadoEm: new Date("2026-10-11T10:00:00Z"), liberadoEm: null,
  codigoReserva: "R-1", codigoImovel: "403", checkin: "2026-10-10", checkout: "2026-10-13", hospede: "Hóspede Fictício", parcial: false, diferenca: 0, ...over,
});
const acao = async () => {};
const render = (props: Partial<Parameters<typeof ExtratoRepasses>[0]> = {}) =>
  renderToStaticMarkup(
    <ExtratoRepasses
      donos={[{ id: "d1", nome: "Dona" }]}
      periodicidades={[{ proprietarioId: "d1", escolha: null, efetiva: "mensal", nome: "Mensal, no dia do fechamento (padrão)", descricao: "mensal, no dia 2, junto com o fechamento do mês", tiposContrato: ["gestao_completa"], proximaData: "2026-11-02" }]}
      partes={[classificarParte(parte()), classificarParte(parte({ lancamentoId: "l2", reservaId: "r2", codigoReserva: "R-2", recebido: { recebido: 0, devido: 85000 }, valor: 1000 })), classificarParte(parte({ lancamentoId: "l3", efeitoSaldo: 0, valor: 500 }))]}
      repasses={[repasse()]}
      itens={{ rep1: [item()] }}
      regras={REGRAS_REPASSES_PADRAO}
      hoje="2026-10-12"
      empresa="SCL"
      escolher={acao}
      pedir={acao}
      {...props}
    />,
  );

describe("extrato e repasses no portal (M4.10)", () => {
  it("mostra a periodicidade com a próxima data, o resumo, as partes com situação e motivo, e os repasses com comprovante", () => {
    const h = render();
    expect(h).toContain("Próximo repasse previsto: <strong>02/11/2026</strong>");
    expect(h).toContain("O mensal (dia 2) é o padrão");
    expect(h).toContain('<option value="" selected="">Padrão do contrato (Mensal, no dia do fechamento (padrão))</option>');
    expect(h).toContain("Disponível para o próximo repasse");
    expect(h).toContain("R$ 722,50");
    expect(h).toContain("<strong>A liberar</strong>");
    expect(h).toContain("A empresa ainda não registrou o recebimento desta reserva");
    expect(h).toContain("<strong>Paga pelo canal</strong>");
    expect(h).toContain("Pedir repasse agora (R$ 722,50)");
    expect(h).toContain("Repasse de 11/10/2026 (pedido por você)");
    expect(h).toContain("Pago em 11/10/2026");
    expect(h).toContain('href="/portal/repasses/rep1/comprovante"');
    expect(h).toContain("E-mail enviado");
    // As reservas que o repasse cobriu, com integral/parcial.
    expect(h).toContain("<summary");
    expect(h).toContain("1 reserva");
    expect(h).toContain("403 · Hóspede Fictício · 10/10/2026 → 13/10/2026 · R$ 722,50 (integral)");
  });
  it("acerto por fora (M4.11): a parte de antes do início aparece acertada por fora, o resumo a separa do que o sistema pagou e o repasse não promete comprovante nem e-mail", () => {
    const porFora = repasse({ id: "pf", tipo: "por_fora", mes: "2026-09-01", data: "2026-09-30", dataPagamento: "2026-09-30", comprovante: "", comprovanteArquivoId: null, emailSituacao: "pendente", emailEm: null, emailPara: "", pedidoEm: null });
    const parteAntiga = classificarParte(parte({ lancamentoId: "l9", reservaId: "r9", codigoReserva: "R-9", competencia: "2026-09-01", checkin: "2026-09-10", checkout: "2026-09-13", repasse: { id: "pf", tipo: "por_fora", data: "2026-09-30", situacao: "pago", dataPagamento: "2026-09-30", valor: 72250 } }));
    const h = render({ partes: [classificarParte(parte()), parteAntiga], repasses: [porFora], itens: { pf: [item({ id: "it9", repasseId: "pf", reservaId: "r9", codigoReserva: "R-9", competencia: "2026-09-01", checkin: "2026-09-10", checkout: "2026-09-13" })] } });
    expect(h).toContain("Acertada por fora, antes do início do sistema (até 30/09/2026).");
    expect(h).toContain("Acertado por fora (antes do sistema)");
    expect(h).toContain("Acertado por fora, antes do sistema (até 30/09/2026)");
    expect(h).toContain("Acertado fora do sistema, antes do início");
    expect(h).not.toContain("ainda não registrado pela empresa");
    expect(h).not.toContain("/portal/repasses/pf/comprovante");
    expect(h).not.toContain("E-mail ainda não enviado");
    // O "já repassado (pago)" é só o que o sistema pagou: a parte acertada por fora não entra nele.
    expect(h).toMatch(/Já repassado \(pago\)<\/div><div[^>]*>R\$ 0,00/);
  });
  it("repasse estornado continua no histórico, com a situação explicada; parte de um mês aparece como parcial; fechamento antigo sem itens avisa", () => {
    const h = render({
      repasses: [repasse(), repasse({ id: "rep2", situacao: "estornado", estornadoEm: new Date("2026-10-12T15:00:00Z"), motivoEstorno: "valor errado" }), repasse({ id: "rep3", tipo: "fechamento", mes: "2026-09-01", data: "2026-10-01", pedidoEm: null })],
      itens: { rep1: [item({ parcial: true, competencia: "2026-11-01" })], rep2: [item({ id: "it2", repasseId: "rep2", liberadoEm: new Date("2026-10-12T15:00:00Z") })] },
    });
    expect(h).toContain("Estornado pela empresa em 12/10/2026: as reservas voltaram ao extrato");
    expect(h).toContain("R$ 722,50 (parte de novembro de 2026; o restante vem em outro repasse)");
    expect(h).toContain("Fechamento de setembro de 2026");
    expect(h).toContain("sem detalhe por reserva (fechamento antigo)");
    expect(h.match(/<summary/g)).toHaveLength(2);
  });
  it("no dia do fechamento (dia 2) não oferece pedir repasse; no dia 1º oferece; sem disponível, idem; mensagem de retorno aparece", () => {
    expect(render({ hoje: "2026-11-02" })).toContain("Hoje é o dia do fechamento");
    expect(render({ hoje: "2026-11-02" })).not.toContain("Pedir repasse agora");
    expect(render({ hoje: "2026-11-01" })).toContain("Pedir repasse agora");
    expect(render({ hoje: "2026-11-01", regras: { ...REGRAS_REPASSES_PADRAO, fechamento: [{ dia: 1, desde: "2026-10" }] } })).toContain("Hoje é o dia do fechamento");
    expect(render({ partes: [] })).not.toContain("Pedir repasse agora");
    expect(render({ mensagem: { tipo: "ok", texto: "Salvo." } })).toContain('role="status"');
  });
  it("usuário com dois proprietários: o botão de pedir só aparece para quem tem valor disponível", () => {
    const h = render({
      donos: [{ id: "d1", nome: "Dona" }, { id: "d2", nome: "Empresa Dela" }],
      periodicidades: [
        { proprietarioId: "d1", escolha: null, efetiva: "mensal", nome: "Mensal, no dia do fechamento (padrão)", descricao: "mensal", tiposContrato: ["gestao_completa"], proximaData: "2026-11-02" },
        { proprietarioId: "d2", escolha: "semanal", efetiva: "semanal", nome: "Semanal", descricao: "semanal", tiposContrato: ["marketplace"], proximaData: "2026-10-19" },
      ],
      partes: [classificarParte(parte({ proprietarioId: "d1" })), classificarParte(parte({ lancamentoId: "l2", proprietarioId: "d2", recebido: { recebido: 0, devido: 85000 } }))],
    });
    expect(h).toContain("Pedir repasse agora (R$ 722,50 · Dona)");
    expect(h).not.toContain("Empresa Dela)");
    expect(h.match(/Pedir repasse agora/g)).toHaveLength(1);
  });

  it("M8.2c: o desconto da parte já repassada de uma reserva cancelada com devolução aparece como 'Desconto', a descontar ou descontado, com a explicação", () => {
    const desconto = parte({ lancamentoId: "d1", reservaId: "r9", codigoReserva: "SCL-CANC", valor: -63119, efeitoSaldo: -63119, origemLancamento: "cancelamento" });
    const h = render({ partes: [classificarParte(desconto)] });
    expect(h).toContain("<strong>Desconto</strong> · a descontar");
    expect(h).toContain("Desconto da sua parte já repassada da reserva SCL-CANC (cancelada com devolução integral ao hóspede): sai do próximo repasse.");
    expect(h).toContain("“Desconto” é a sua parte já repassada de uma reserva paga pelo site e cancelada com devolução integral ao hóspede: sai do próximo repasse.");
    // Descontado num repasse: a situação e o repasse.
    const descontado = classificarParte({ ...desconto, repasse: { id: "rep2", tipo: "antecipado", data: "2026-10-20", situacao: "pago", dataPagamento: "2026-10-20", valor: -63119 } });
    const h2 = render({ partes: [descontado] });
    expect(h2).toContain("<strong>Desconto</strong> · descontado");
    expect(h2).toContain("descontado no repasse de 20/10/2026");
    // Sem desconto, sem a explicação.
    expect(render()).not.toContain("“Desconto” é a sua parte");
  });
});
