import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ItemDoRepasse, Repasse } from "@/repasses/repasses";
vi.mock("@/repasses/acoes", () => ({ anexarComprovanteAcao: vi.fn(), enviarEmailRepasseAcao: vi.fn(), estornarRepasseAcao: vi.fn(), pagarRepasseAcao: vi.fn() }));
import { CartaoRepasse } from "./CartaoRepasse";

const repasse = (over: Partial<Repasse> = {}): Repasse => ({
  id: "rep1", organizacaoId: "org", proprietarioId: "d1", tipo: "antecipado", mes: "2026-10-01", data: "2026-10-14", saldo: 72250, descontado: 0, contestado: 0, valor: 72250, foraDoFechamento: 0, antecipado: 72250, situacao: "a_pagar", dataPagamento: null,
  comprovante: "", comprovanteArquivoId: null, emailSituacao: "pendente", emailEm: null, emailPara: "", emailChave: "", emailTentativaEm: null, emailPedido: null, chavePixPaga: "", pedidoEm: null, motivoEstorno: "", criadoPor: null, criadoEm: new Date("2026-10-14T10:00:00Z"), estornadoEm: null, ...over,
});
const item = (over: Partial<ItemDoRepasse> = {}): ItemDoRepasse => ({
  id: "it1", organizacaoId: "org", repasseId: "rep1", lancamentoId: "l1", reservaId: "r1", imovelId: "i1", competencia: "2026-10-01", valor: 72250, criadoEm: new Date("2026-10-14T10:00:00Z"), liberadoEm: null,
  codigoReserva: "SCL-0001", codigoImovel: "403", checkin: "2026-10-10", checkout: "2026-10-13", hospede: "Hóspede Fictício", parcial: false, diferenca: 0, ...over,
});
const render = (r: Repasse, itens: ItemDoRepasse[]) => renderToStaticMarkup(<CartaoRepasse r={r} nome="Dona" chavePix="dona@example.com" itens={itens} mes="2026-10" hoje="2026-10-16" editar />);

it("M8.2e: repasse a pagar com parte de reserva em disputa do pagamento mostra o aviso (sem bloquear o pagamento); pago, não", () => {
  const comDisputa = [item({ disputaAbertaEm: new Date("2026-10-15T15:00:00Z") })];
  const h = render(repasse(), comDisputa);
  expect(h).toContain("A reserva SCL-0001 tem uma disputa do pagamento aberta desde 15/10: estorne o repasse antes de pagar, se quiser segurar a parte dela.");
  expect(h).toContain(">Marcar como pago</button>");
  expect(render(repasse(), [item()])).not.toContain("disputa do pagamento aberta");
  expect(render(repasse({ situacao: "pago", dataPagamento: "2026-10-16" }), comDisputa)).not.toContain("disputa do pagamento aberta");
  // A linha da disputa no repasse: a descrição própria, só o código da reserva.
  const linha = render(repasse(), [item({ id: "it2", valor: -85000, hospede: "", disputa: { variante: "segurado", situacao: "aberta" } })]);
  expect(linha).toContain("valor segurado pela disputa do pagamento (até o resultado)");
});
