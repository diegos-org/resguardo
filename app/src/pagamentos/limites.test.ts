import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { autorizacaoValida, emitirAutorizacao, validadeDaAutorizacao } from "./autorizacao";
import { conferirEmailDoPedido, conferirLimite, ERRO_EMAIL_DO_PEDIDO, ERROS_LIMITE, LIMITE_EMAIL_POR_COTACAO, LIMITES_PAGAMENTO } from "./limites";
import { AGORA, type Cenario, EMAIL_HOSPEDE, minutos, montarCenario } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

const SEGREDO = "segredo-de-teste-ficticio";

describe("freios das ações públicas do pagamento (M8.2a)", () => {
  it("por origem: o teto vale por endereço; outro endereço segue", async () => {
    const { tentativas } = LIMITES_PAGAMENTO.gerar_pix.origem;
    for (let i = 0; i < tentativas; i++) expect(await conferirLimite(db, c.org, "gerar_pix", "203.0.113.7", AGORA)).toEqual({ ok: true });
    expect(await conferirLimite(db, c.org, "gerar_pix", "203.0.113.7", AGORA)).toEqual({ ok: false, erro: ERROS_LIMITE.gerar_pix });
    expect(await conferirLimite(db, c.org, "gerar_pix", "203.0.113.8", AGORA)).toEqual({ ok: true });
    // Passada a janela, volta.
    expect(await conferirLimite(db, c.org, "gerar_pix", "203.0.113.7", minutos(61))).toEqual({ ok: true });
  });

  it("origem desconhecida conta numa chave compartilhada com teto baixo; o teto geral da organização vem antes", async () => {
    const semOrigem = LIMITES_PAGAMENTO.continuar.semOrigem.tentativas;
    for (let i = 0; i < semOrigem; i++) expect((await conferirLimite(db, c.org, "continuar", null, AGORA)).ok).toBe(true);
    expect(await conferirLimite(db, c.org, "continuar", null, AGORA)).toMatchObject({ ok: false });
    const geral = LIMITES_PAGAMENTO.segurar.geral.tentativas;
    for (let i = 0; i < geral; i++) await conferirLimite(db, c.org, "segurar", `198.51.100.${i % 250}`, minutos(1));
    // Teto geral atingido: até um endereço novo é recusado (e a conta por origem nem é tocada).
    expect(await conferirLimite(db, c.org, "segurar", "192.0.2.1", minutos(1))).toEqual({ ok: false, erro: ERROS_LIMITE.segurar });
    // Os tetos são por organização.
    expect(await conferirLimite(db, "00000000-0000-4000-8000-000000000123", "segurar", "192.0.2.1", minutos(1))).toEqual({ ok: true });
    expect(Object.keys(LIMITES_PAGAMENTO).sort()).toEqual(["consulta", "continuar", "gerar_pix", "segurar"]);
  });

  it("Continuar o pagamento: confere o e-mail do pedido sem dizer nada dele; tentativas limitadas por cotação", async () => {
    const s = await c.segurar();
    const ok = await conferirEmailDoPedido(db, c.org, s.cotacaoId, "  Visitante@Example.com ", "203.0.113.20", AGORA);
    expect(ok).toEqual({ ok: true, ate: validadeDaAutorizacao(minutos(30), AGORA) });
    expect(await conferirEmailDoPedido(db, c.org, s.cotacaoId, "outro@example.com", "203.0.113.21", AGORA)).toEqual({ ok: false, erro: ERRO_EMAIL_DO_PEDIDO });
    expect(await conferirEmailDoPedido(db, c.org, "00000000-0000-4000-8000-000000000000", EMAIL_HOSPEDE, "203.0.113.22", AGORA)).toEqual({ ok: false, erro: ERRO_EMAIL_DO_PEDIDO });
    for (let i = 0; i < LIMITE_EMAIL_POR_COTACAO.tentativas; i++) await conferirEmailDoPedido(db, c.org, s.cotacaoId, "x@example.com", `203.0.113.${30 + i}`, minutos(1));
    // Mesmo o e-mail certo, de outro endereço, espera a janela da cotação.
    expect(await conferirEmailDoPedido(db, c.org, s.cotacaoId, EMAIL_HOSPEDE, "203.0.113.99", minutos(1))).toEqual({ ok: false, erro: ERROS_LIMITE.continuar });
  });
});

describe("autorização do pagamento (cookie assinado, M8.2a)", () => {
  it("vale só para a cotação dele, até a validade, com o segredo; adulterado ou de outra finalidade não vale", () => {
    const cot = "11111111-1111-4111-8111-111111111111";
    const outra = "22222222-2222-4222-8222-222222222222";
    const ate = minutos(60);
    const t = emitirAutorizacao(cot, ate, SEGREDO);
    expect(autorizacaoValida(t, cot, minutos(59), SEGREDO)).toBe(true);
    expect(autorizacaoValida(t, cot, minutos(60), SEGREDO)).toBe(false);
    expect(autorizacaoValida(t, outra, minutos(1), SEGREDO)).toBe(false);
    expect(autorizacaoValida(t, cot, minutos(1), "outro-segredo")).toBe(false);
    expect(autorizacaoValida(`${t}x`, cot, minutos(1), SEGREDO)).toBe(false);
    expect(autorizacaoValida(undefined, cot, minutos(1), SEGREDO)).toBe(false);
    expect(autorizacaoValida(t, cot, minutos(1), undefined)).toBe(false);
    expect(() => emitirAutorizacao(cot, ate, undefined)).toThrow("AUTH_SECRET");
    expect(() => emitirAutorizacao("nada", ate, SEGREDO)).toThrow();
    // Cobre o prazo das datas estendido pelos 3 Pix e a carência.
    expect(validadeDaAutorizacao(minutos(30), AGORA).getTime()).toBe(minutos(30 + 3 * 32 + 15).getTime());
    expect(validadeDaAutorizacao(null, AGORA).getTime()).toBeGreaterThan(minutos(30).getTime());
  });
});
