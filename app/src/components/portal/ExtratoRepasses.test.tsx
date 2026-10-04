import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { classificarParte, type ParteBruta } from "@/repasses/extrato";
import { REGRAS_REPASSES_PADRAO } from "@/repasses/periodicidade";
import type { Repasse } from "@/repasses/repasses";
import { ExtratoRepasses } from "./ExtratoRepasses";

const parte = (over: Partial<ParteBruta> = {}): ParteBruta => ({
  lancamentoId: Math.random().toString(36).slice(2), reservaId: "r1", codigoReserva: "R-1", imovelId: "i1", codigoImovel: "403", competencia: "2026-10-01", valor: 72250, efeitoSaldo: 72250, estado: "previsto",
  checkin: "2026-10-10", checkout: "2026-10-13", hospede: "Hóspede Fictício", hoje: "2026-10-12", recebido: { recebido: 85000, devido: 85000 }, emConferencia: false, repasse: null, ...over,
});
const repasse = (over: Partial<Repasse> = {}): Repasse => ({
  id: "rep1", organizacaoId: "org", proprietarioId: "d1", tipo: "antecipado", mes: "2026-10-01", data: "2026-10-11", saldo: 72250, descontado: 0, contestado: 0, valor: 72250, foraDoFechamento: 0, antecipado: 72250, situacao: "pago", dataPagamento: "2026-10-11",
  comprovante: "E2E-1", comprovanteArquivoId: "arq", emailSituacao: "enviado", emailEm: new Date("2026-10-11T15:00:00Z"), emailPara: "dona@example.com", pedidoEm: new Date("2026-10-11T10:00:00Z"), motivoEstorno: "", criadoPor: null, criadoEm: new Date("2026-10-11T10:00:00Z"), estornadoEm: null, ...over,
});
const acao = async () => {};
const render = (props: Partial<Parameters<typeof ExtratoRepasses>[0]> = {}) =>
  renderToStaticMarkup(
    <ExtratoRepasses
      donos={[{ id: "d1", nome: "Dona" }]}
      periodicidades={[{ proprietarioId: "d1", escolha: null, efetiva: "mensal", nome: "Mensal, no dia 1º (padrão)", descricao: "mensal, no dia 1º, junto com o fechamento do mês", tiposContrato: ["gestao_completa"], proximaData: "2026-11-01" }]}
      partes={[classificarParte(parte()), classificarParte(parte({ lancamentoId: "l2", reservaId: "r2", codigoReserva: "R-2", recebido: { recebido: 0, devido: 85000 }, valor: 1000 })), classificarParte(parte({ lancamentoId: "l3", efeitoSaldo: 0, valor: 500 }))]}
      repasses={[repasse()]}
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
    expect(h).toContain("Próximo repasse previsto: <strong>01/11/2026</strong>");
    expect(h).toContain('<option value="" selected="">Padrão do contrato (Mensal, no dia 1º (padrão))</option>');
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
  });
  it("no dia 1º não oferece pedir repasse; sem disponível, idem; mensagem de retorno aparece", () => {
    expect(render({ hoje: "2026-11-01" })).toContain("Hoje é dia 1º");
    expect(render({ partes: [] })).not.toContain("Pedir repasse agora");
    expect(render({ mensagem: { tipo: "ok", texto: "Salvo." } })).toContain('role="status"');
  });
});
