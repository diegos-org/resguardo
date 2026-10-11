import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Lancamento } from "@/financeiro/ledger";
vi.mock("@/repasses/acoes", () => ({ estornarRecebimentoAcao: vi.fn(), registrarRecebimentoAcao: vi.fn() }));
import { Recebimentos } from "./Recebimentos";

const recebimento = (id: string, chaveOrigem: string, comprovante = "") => ({ id, chaveOrigem, comprovante, dataCaixa: "2026-10-05", competencia: "2026-10-05", montante: 180594, estado: "realizado" }) as unknown as Lancamento;

it("recebimento da liberação do pagamento no site não é estornável na lista: aponta para o quadro (M8.2a)", () => {
  const h = renderToStaticMarkup(
    <Recebimentos
      reservaId="r"
      recebimentos={[recebimento("manual", "", "extrato"), recebimento("site", "mercadopago:11111111-1111-4111-8111-111111111111:recebimento")]}
      recebido={{ recebido: 361188, devido: 361188 }}
      quemRecebe="empresa"
      editar
      hoje="2026-10-09"
      cancelada={false}
    />,
  );
  // Só o recebimento manual oferece o estorno.
  expect(h.match(/name="id" value="manual"/g)).toHaveLength(1);
  expect(h).not.toContain('value="site"');
  expect(h.match(/>Estornar</g)).toHaveLength(1);
  expect(h).toContain("pelo quadro “Pagamento no site”");
});

it("M8.2e: o dinheiro que voltou de uma disputa do pagamento não é estornável pela reserva: aponta para o quadro da disputa", () => {
  const h = renderToStaticMarkup(
    <Recebimentos
      reservaId="r"
      recebimentos={[recebimento("volta", "mercadopago:11111111-1111-4111-8111-111111111111:contestacao:22222222-2222-4222-8222-222222222222:volta")]}
      recebido={{ recebido: 85000, devido: 85000 }}
      quemRecebe="empresa"
      editar
      hoje="2026-12-10"
      cancelada={false}
    />,
  );
  expect(h).not.toContain(">Estornar<");
  expect(h).not.toContain('value="volta"');
  expect(h).toContain("pelo quadro da disputa do pagamento");
});
