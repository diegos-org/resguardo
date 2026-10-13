import { describe, expect, it } from "vitest";
import { pessimista, ProvedorFalso } from "./falso";
import { type CasoDeContestacao, ErroProvedor, type PedidoCartao, type PedidoPix, RECUSA_GENERICA, semAcessoContestacao, urlDoDesafio } from "./provedor";

const AGORA = new Date("2026-10-08T15:00:00.000Z");
const novo = () => new ProvedorFalso(() => AGORA);

const pix = (over: Partial<PedidoPix> = {}): PedidoPix => ({
  referencia: "scl-1", chaveIdempotencia: "k-pix-1", valor: 100_000, email: "hospede@example.com", nome: "APRO",
  validadeMinutos: 45, descricao: "Reserva", descricaoFatura: null, ...over,
});

const cartao = (over: Partial<PedidoCartao> = {}): PedidoCartao => ({
  referencia: "scl-2", chaveIdempotencia: "k-cartao-1", valor: 50_000, token: "1c87b6b301010101ddcd92f9bbbb3be2", bandeira: "master",
  tipo: "credit_card", parcelas: 2, emissor: null, email: "hospede@example.com", documento: null, sessaoDispositivo: null,
  descricao: "Reserva", descricaoFatura: null, tresDS: "on_fraud_risk", ...over,
});
const NADA_FINANCEIRO = { taxa: null, liquido: null, liberacaoPrevista: null, liberado: null, idPagamento: null, liberacaoEmParcelas: false, custoParcelasVendedor: null };

describe("ProvedorFalso: criação", () => {
  it("Pix pendente com ids determinísticos, copia e cola e prazo = agora + validade", async () => {
    const p = novo();
    const r = await p.criarPix(pix());
    expect(r).toMatchObject({ ok: true, cobranca: { idProvedor: "ORDTST0001", idTransacao: "PAYTST0001", referencia: "scl-1", situacao: "pendente", forma: "pix", valor: 100_000, pago: null, devolvido: 0, aoVivo: false } });
    if (!r.ok) throw new Error();
    expect(r.cobranca.pix?.copiaECola).toMatch(/^000201/);
    expect(r.cobranca.pix?.expiraEm).toEqual(new Date("2026-10-08T15:45:00.000Z"));
    expect(r.cobranca.pix?.imagemBase64).toBe("RkFMU08=");
    const segundo = await p.criarPix(pix({ referencia: "scl-3", chaveIdempotencia: "k-pix-2", validadeMinutos: 1 }));
    expect(segundo).toMatchObject({ ok: true, cobranca: { idProvedor: "ORDTST0002" } });
    if (segundo.ok) expect(segundo.cobranca.pix?.expiraEm).toEqual(new Date("2026-10-08T15:30:00.000Z")); // mínimo de 30 min
    p.imagemPix = null;
    const semImagem = await p.criarPix(pix({ referencia: "scl-4", chaveIdempotencia: "k-pix-3" }));
    if (semImagem.ok) expect(semImagem.cobranca.pix?.imagemBase64).toBeNull();
  });

  it("valida como o cliente real (sem criar nada)", async () => {
    const p = novo();
    for (const r of [await p.criarPix(pix({ valor: 0 })), await p.criarPix(pix({ referencia: "a b" })), await p.criarPix(pix({ email: "x" })), await p.criarPix(pix({ validadeMinutos: Number.NaN })), await p.criarCartao(cartao({ parcelas: 37 }))]) {
      expect(r).toMatchObject({ ok: false, motivo: "dados_invalidos", cobranca: null });
    }
    expect(p.todas()).toHaveLength(0);
  });

  it("cartão: aprovado, recusado (com a order), em análise, processando e desafio (3DS)", async () => {
    const p = novo();
    expect(await p.criarCartao(cartao())).toMatchObject({ ok: true, cobranca: { situacao: "aprovado", pago: 50_000, parcelas: 2, forma: "cartao", detalhe: "processed/accredited", cartao: { desafio: false, analise: false, tresDSStatus: "AUTHENTICATED", bandeira: "master" } } });
    p.respostaCartao = "recusado";
    expect(await p.criarCartao(cartao({ referencia: "scl-3", chaveIdempotencia: "k2" }))).toEqual({
      ok: false, motivo: "recusado", mensagem: RECUSA_GENERICA, codigo: "rejected_by_issuer", cobranca: expect.objectContaining({ situacao: "recusado", pago: null, detalhe: "failed/failed; pagamento failed/rejected_by_issuer" }),
    });
    p.motivoRecusaCartao = "high_risk";
    expect(await p.criarCartao(cartao({ referencia: "scl-3b", chaveIdempotencia: "k2b" }))).toMatchObject({ ok: false, codigo: "high_risk", mensagem: RECUSA_GENERICA, cobranca: { detalhe: "failed/failed; pagamento failed/high_risk" } });
    p.respostaCartao = "em_analise";
    expect(await p.criarCartao(cartao({ referencia: "scl-4", chaveIdempotencia: "k3" }))).toMatchObject({ ok: true, cobranca: { situacao: "em_analise", detalhe: "processing/in_review", cartao: { analise: true, desafio: false } } });
    p.respostaCartao = "processando";
    expect(await p.criarCartao(cartao({ referencia: "scl-4b", chaveIdempotencia: "k3b" }))).toMatchObject({ ok: true, cobranca: { situacao: "em_analise", detalhe: "processing/in_process", cartao: { analise: false, desafio: false } } });
    p.respostaCartao = "desafio";
    expect(await p.criarCartao(cartao({ referencia: "scl-5", chaveIdempotencia: "k4" }))).toMatchObject({ ok: true, cobranca: { situacao: "pendente", detalhe: "action_required/pending_challenge", cartao: { desafio: true, tresDSStatus: "CHALLENGE" } } });
  });

  it("desafio: o endereço (de domínio do Mercado Pago) só na resposta da criação; consultar e buscar não trazem", async () => {
    const p = novo();
    p.respostaCartao = "desafio";
    const r = await p.criarCartao(cartao());
    if (!r.ok) throw new Error();
    expect(r.cobranca.cartao?.desafioUrl).toBe("https://www.mercadopago.com.br/checkout/v1/3ds/FALSO0001");
    expect(urlDoDesafio(r.cobranca.cartao?.desafioUrl)).toBe(r.cobranca.cartao?.desafioUrl);
    expect((await p.consultar("ORDTST0001"))!.cartao).toMatchObject({ desafio: true, desafioUrl: null });
    expect((await p.buscarPorReferencia("scl-2", AGORA))!.cartao).toMatchObject({ desafio: true, desafioUrl: null });
    const segundo = await p.criarCartao(cartao({ referencia: "scl-3", chaveIdempotencia: "k2" }));
    if (segundo.ok) expect(segundo.cobranca.cartao?.desafioUrl).toBe("https://www.mercadopago.com.br/checkout/v1/3ds/FALSO0002");
    // Sem 3DS pedido, nenhum resultado de verificação.
    p.respostaCartao = "aprovado";
    expect(await p.criarCartao(cartao({ referencia: "scl-4", chaveIdempotencia: "k3", tresDS: "never" }))).toMatchObject({ ok: true, cobranca: { cartao: { tresDSStatus: null } } });
  });

  it("recusado sem order (402 sem data): nada registrado, a busca não acha; mesma chave depois = incerto", async () => {
    const p = novo();
    p.respostaCartao = "recusado_sem_order";
    p.motivoRecusaCartao = "high_risk";
    expect(await p.criarCartao(cartao())).toEqual({ ok: false, motivo: "recusado", mensagem: RECUSA_GENERICA, cobranca: null, codigo: "high_risk" });
    expect(p.todas()).toHaveLength(0);
    expect(await p.buscarPorReferencia("scl-2", AGORA)).toBeNull();
    expect(await p.existePagamentoPorReferencia("scl-2", AGORA)).toBe(false);
    expect(await p.criarCartao(cartao())).toMatchObject({ ok: false, motivo: "incerto", cobranca: null });
    p.chaveRepetida = "mesma_resposta";
    expect(await p.criarCartao(cartao())).toMatchObject({ ok: false, motivo: "recusado", cobranca: null, codigo: "high_risk" });
  });

  it("guarda o último cartão recebido sem o token (3DS, parcelas, documento e aparelho chegam ao provedor)", async () => {
    const p = novo();
    await p.criarCartao(cartao({ parcelas: 3, tresDS: "never", documento: { tipo: "CPF", numero: "12345678909" }, sessaoDispositivo: "dispositivo-ficticio-0001" }));
    expect(p.ultimoPedidoCartao).toMatchObject({ parcelas: 3, tresDS: "never", documento: { tipo: "CPF", numero: "12345678909" }, sessaoDispositivo: "dispositivo-ficticio-0001", comToken: true });
    expect(JSON.stringify(p.ultimoPedidoCartao)).not.toContain("1c87b6b301010101ddcd92f9bbbb3be2");
    expect(p.ultimoPedidoCartao).not.toHaveProperty("token");
    // Pedido inválido (3DS fora da lista) também fica registrado, mas nada é criado.
    expect(await p.criarCartao(cartao({ chaveIdempotencia: "k2", tresDS: "always" as never }))).toMatchObject({ ok: false, motivo: "dados_invalidos", codigo: null });
    expect(p.todas()).toHaveLength(1);
  });

  it("chave repetida: por padrão responde como a API real (incerto), sem criar outra order", async () => {
    const p = novo();
    await p.criarPix(pix());
    expect(await p.criarPix(pix())).toMatchObject({ ok: false, motivo: "incerto", cobranca: null });
    expect(await p.criarCartao(cartao({ chaveIdempotencia: "k-pix-1" }))).toMatchObject({ ok: false, motivo: "incerto" });
    expect(p.todas()).toHaveLength(1);
  });

  it("chave repetida em 'mesma_resposta': devolve a mesma order, no estado atual", async () => {
    const p = novo();
    p.chaveRepetida = "mesma_resposta";
    await p.criarPix(pix());
    p.aprovar("ORDTST0001");
    expect(await p.criarPix(pix())).toMatchObject({ ok: true, cobranca: { idProvedor: "ORDTST0001", situacao: "aprovado" } });
    p.respostaCartao = "recusado";
    await p.criarCartao(cartao());
    expect(await p.criarCartao(cartao())).toMatchObject({ ok: false, motivo: "recusado", cobranca: { idProvedor: "ORDTST0002" } });
    expect(p.todas()).toHaveLength(2);
  });

  it("registra as chamadas com as chaves", async () => {
    const p = novo();
    await p.criarPix(pix());
    await p.consultar("ORDTST0001");
    await p.cancelar("ORDTST0001", "k-cancelar");
    expect(p.chamadas).toEqual([
      { metodo: "criarPix", chave: "k-pix-1", id: null, referencia: "scl-1", valor: 100_000 },
      { metodo: "consultar", chave: null, id: "ORDTST0001", referencia: null, valor: null },
      { metodo: "cancelar", chave: "k-cancelar", id: "ORDTST0001", referencia: null, valor: null },
    ]);
  });
});

describe("ProvedorFalso: falhas injetadas", () => {
  it("falhar lança antes de criar; falhas por método", async () => {
    const p = novo();
    p.falhar = new ErroProvedor("indisponivel", "fora do ar");
    await expect(p.criarPix(pix())).rejects.toMatchObject({ tipo: "indisponivel" });
    expect(p.todas()).toHaveLength(0);
    p.falhar = null;
    p.falhas.consultar = new ErroProvedor("credencial", "chave");
    await p.criarPix(pix());
    await expect(p.consultar("ORDTST0001")).rejects.toMatchObject({ tipo: "credencial" });
    p.falhas.buscarPorReferencia = new ErroProvedor("limite", "limite");
    await expect(p.buscarPorReferencia("scl-1", AGORA)).rejects.toMatchObject({ tipo: "limite" });
  });

  it("falha depois de criar: a order existe e a busca pela referência acha", async () => {
    const p = novo();
    p.falhasDepois.criarCartao = new ErroProvedor("incerto", "tempo");
    await expect(p.criarCartao(cartao())).rejects.toMatchObject({ tipo: "incerto" });
    p.falhasDepois.criarCartao = null;
    // Repetir com a mesma chave: incerto, como na API.
    expect(await p.criarCartao(cartao())).toMatchObject({ ok: false, motivo: "incerto" });
    expect(await p.buscarPorReferencia("scl-2", new Date(AGORA.getTime() - 60_000))).toMatchObject({ idProvedor: "ORDTST0001", situacao: "aprovado" });
  });

  it("métodos que nunca lançam viram erro/incerta/null", async () => {
    const p = novo();
    await p.criarCartao(cartao());
    const [c] = p.todas();
    p.falhar = new ErroProvedor("incerto", "tempo");
    expect(await p.cancelar(c.idProvedor, "k")).toBe("erro");
    expect(await p.devolver(c, "k", null)).toMatchObject({ situacao: "incerta" });
    expect(await p.detalheFinanceiro(c)).toEqual(NADA_FINANCEIRO);
    expect(await p.existePagamentoPorReferencia("scl-2", AGORA).catch((e: ErroProvedor) => e.tipo)).toBe("incerto");
    expect(await p.conferirContaDeTeste()).toBeNull();
    p.falhar = new ErroProvedor("credencial", "chave");
    expect(await p.devolver(c, "k", null)).toMatchObject({ situacao: "recusada" });
  });
});

describe("ProvedorFalso: consulta, busca e simuladores", () => {
  it("consultar devolve cópia; id desconhecido → null", async () => {
    const p = novo();
    await p.criarPix(pix());
    const c = (await p.consultar("ORDTST0001"))!;
    c.situacao = "aprovado";
    c.pix!.expiraEm!.setTime(0);
    expect((await p.consultar("ORDTST0001"))!.situacao).toBe("pendente");
    expect((await p.consultar("ORDTST0001"))!.pix!.expiraEm).toEqual(new Date("2026-10-08T15:45:00.000Z"));
    expect(await p.consultar("ORDTST9999")).toBeNull();
    expect(await p.consultar("../x")).toBeNull();
  });

  it("buscarPorReferencia respeita 'desde' (com a mesma margem do cliente real)", async () => {
    const p = novo();
    await p.criarPix(pix());
    expect(await p.buscarPorReferencia("scl-1", new Date(AGORA.getTime() - 3600_000))).toMatchObject({ idProvedor: "ORDTST0001" });
    expect(await p.buscarPorReferencia("scl-1", new Date(AGORA.getTime() + 10 * 60_000))).toMatchObject({ idProvedor: "ORDTST0001" });
    expect(await p.buscarPorReferencia("scl-9", AGORA)).toBeNull();
    expect(await p.buscarPorReferencia("scl 1", AGORA)).toBeNull();
  });

  it("aprovar com taxa, liberação e o financeiro; sem opções fica tudo desconhecido", async () => {
    const p = novo();
    await p.criarPix(pix());
    await p.criarPix(pix({ referencia: "scl-2", chaveIdempotencia: "k2" }));
    const previsao = new Date("2026-10-08T15:10:00.000Z");
    p.aprovar("ORDTST0001", { taxa: 990, liberacaoPrevista: previsao, liberado: false });
    const c = (await p.consultar("ORDTST0001"))!;
    expect(c).toMatchObject({ situacao: "aprovado", pago: 100_000, detalhe: "processed/accredited" });
    expect(await p.detalheFinanceiro(c)).toEqual({ taxa: 990, liquido: 99_010, liberacaoPrevista: previsao, liberado: false, idPagamento: "9000000001", liberacaoEmParcelas: false, custoParcelasVendedor: null });
    p.atualizarFinanceiro("ORDTST0001", { liberado: true });
    expect((await p.detalheFinanceiro(c)).liberado).toBe(true);
    p.aprovar("ORDTST0002");
    expect(await p.detalheFinanceiro((await p.consultar("ORDTST0002"))!)).toMatchObject({ taxa: null, liquido: null, liberacaoPrevista: null, liberado: null });
  });

  it("busca e Payments API pela referência só acham depois do atraso (atrasoBuscaMs)", async () => {
    const relogio = { agora: AGORA };
    const p = new ProvedorFalso(() => relogio.agora);
    p.atrasoBuscaMs = 20 * 60_000;
    await p.criarCartao(cartao());
    expect(await p.buscarPorReferencia("scl-2", AGORA)).toBeNull();
    expect(await p.existePagamentoPorReferencia("scl-2", AGORA)).toBe(false);
    relogio.agora = new Date(AGORA.getTime() + 19 * 60_000);
    expect(await p.existePagamentoPorReferencia("scl-2", AGORA)).toBe(false);
    relogio.agora = new Date(AGORA.getTime() + 20 * 60_000);
    expect(await p.buscarPorReferencia("scl-2", AGORA)).toMatchObject({ idProvedor: "ORDTST0001" });
    expect(await p.existePagamentoPorReferencia("scl-2", AGORA)).toBe(true);
    expect(await p.existePagamentoPorReferencia("scl-9", AGORA)).toBe(false);
    expect(await p.existePagamentoPorReferencia("scl 2", AGORA)).toBe(false);
    expect(p.chamadas.filter((x) => x.metodo === "existePagamentoPorReferencia")).toHaveLength(5);
    p.falhas.existePagamentoPorReferencia = new ErroProvedor("incerto", "tempo");
    await expect(p.existePagamentoPorReferencia("scl-2", AGORA)).rejects.toMatchObject({ tipo: "incerto" });
  });

  it("juros do parcelamento: do hóspede (pago = valor + juros) ou da SCL (sem acréscimo: pago = valor e custo no financeiro)", async () => {
    const p = novo();
    p.jurosCartao = 3_742;
    expect(await p.criarCartao(cartao({ parcelas: 3 }))).toMatchObject({ ok: true, cobranca: { valor: 50_000, valorTransacao: 50_000, pago: 53_742 } });
    expect(await p.detalheFinanceiro((await p.consultar("ORDTST0001"))!)).toMatchObject({ custoParcelasVendedor: 0, idPagamento: "9000000001" });
    // À vista não tem juros.
    expect(await p.criarCartao(cartao({ referencia: "scl-3", chaveIdempotencia: "k2", parcelas: 1 }))).toMatchObject({ ok: true, cobranca: { pago: 50_000 } });
    p.jurosPor = "vendedor";
    p.respostaCartao = "em_analise";
    await p.criarCartao(cartao({ referencia: "scl-4", chaveIdempotencia: "k3", parcelas: 3 }));
    p.aprovar("ORDTST0003", { taxa: 2_000, liberado: true });
    const vendedor = (await p.consultar("ORDTST0003"))!;
    expect(vendedor).toMatchObject({ situacao: "aprovado", pago: 50_000 });
    // O custo entra na taxa e sai do líquido, como a financing_fee da SCL na Payments API.
    expect(await p.detalheFinanceiro(vendedor)).toMatchObject({ taxa: 5_742, liquido: 44_258, custoParcelasVendedor: 3_742, liberado: true });
    // Sem `jurosCartao`, o custo é 5% do valor; à vista, nenhum.
    p.jurosCartao = 0;
    p.respostaCartao = "aprovado";
    await p.criarCartao(cartao({ referencia: "scl-5", chaveIdempotencia: "k4", parcelas: 2 }));
    expect(await p.detalheFinanceiro((await p.consultar("ORDTST0004"))!)).toMatchObject({ custoParcelasVendedor: 2_500 });
    await p.criarCartao(cartao({ referencia: "scl-6", chaveIdempotencia: "k5", parcelas: 1 }));
    expect(await p.detalheFinanceiro((await p.consultar("ORDTST0005"))!)).toMatchObject({ custoParcelasVendedor: 0 });
  });

  it("liberação em parcelas: o financeiro do cartão nunca vem 'liberado'; o Pix não muda", async () => {
    const p = novo();
    p.liberacaoEmParcelas = true;
    await p.criarCartao(cartao());
    p.aprovar("ORDTST0001", { taxa: 990, liberado: true });
    expect(await p.detalheFinanceiro((await p.consultar("ORDTST0001"))!)).toMatchObject({ liberado: null, liberacaoEmParcelas: true, taxa: 990 });
    await p.criarPix(pix({ referencia: "scl-9", chaveIdempotencia: "k9" }));
    p.aprovar("ORDTST0002", { taxa: 990, liberado: true });
    expect(await p.detalheFinanceiro((await p.consultar("ORDTST0002"))!)).toMatchObject({ liberado: true, liberacaoEmParcelas: false });
  });

  it("concluirDesafio: aprovado (autenticado), recusado como o sandbox (failed/failed, NOT_AUTHENTICATED) ou com o detalhe dado, expirado", async () => {
    const p = novo();
    p.respostaCartao = "desafio";
    for (let i = 1; i <= 4; i++) await p.criarCartao(cartao({ referencia: `scl-${i}`, chaveIdempotencia: `k${i}`, parcelas: 1 }));
    p.concluirDesafio("ORDTST0001", "aprovado");
    p.concluirDesafio("ORDTST0002", "recusado");
    p.concluirDesafio("ORDTST0003", "recusado", { detalhe: "cc_rejected_3ds_challenge" });
    p.concluirDesafio("ORDTST0004", "expirado");
    const [a, b, c, d] = p.todas();
    expect(a).toMatchObject({ situacao: "aprovado", pago: 50_000, detalhe: "processed/accredited", cartao: { desafio: false, tresDSStatus: "AUTHENTICATED" } });
    expect(b).toMatchObject({ situacao: "recusado", pago: null, detalhe: "failed/failed", cartao: { desafio: false, tresDSStatus: "NOT_AUTHENTICATED" } });
    expect(c).toMatchObject({ situacao: "recusado", detalhe: "failed/failed; pagamento failed/cc_rejected_3ds_challenge", cartao: { tresDSStatus: "NOT_AUTHENTICATED" } });
    expect(d).toMatchObject({ situacao: "expirado", detalhe: "canceled/expired", cartao: { desafio: false } });
  });

  it("concluirAnalise: aprovado ou recusado (com o motivo da próxima recusa); em análise ou processando não se cancela", async () => {
    const p = novo();
    p.respostaCartao = "em_analise";
    await p.criarCartao(cartao());
    await p.criarCartao(cartao({ referencia: "scl-3", chaveIdempotencia: "k2" }));
    p.respostaCartao = "processando";
    await p.criarCartao(cartao({ referencia: "scl-4", chaveIdempotencia: "k3" }));
    expect(await p.cancelar("ORDTST0001", "c1")).toBe("nao_cancelavel");
    expect(await p.cancelar("ORDTST0003", "c2")).toBe("nao_cancelavel");
    expect((await p.consultar("ORDTST0001"))!.situacao).toBe("em_analise");
    p.concluirAnalise("ORDTST0001", "aprovado");
    p.motivoRecusaCartao = "high_risk";
    p.concluirAnalise("ORDTST0002", "recusado");
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "aprovado", pago: 50_000, cartao: { analise: false } });
    expect(await p.consultar("ORDTST0002")).toMatchObject({ situacao: "recusado", detalhe: "failed/failed; pagamento failed/high_risk", cartao: { analise: false } });
    // O desafio (action_required) se cancela.
    p.respostaCartao = "desafio";
    await p.criarCartao(cartao({ referencia: "scl-5", chaveIdempotencia: "k4" }));
    expect(await p.cancelar("ORDTST0004", "c3")).toBe("cancelado");
    expect(await p.consultar("ORDTST0004")).toMatchObject({ situacao: "cancelado", cartao: { desafio: false } });
  });

  it("contestar: a order inteira (padrão), só a transação ou uma entrada na lista de contestações", async () => {
    const p = novo();
    for (let i = 1; i <= 3; i++) await p.criarCartao(cartao({ referencia: `scl-${i}`, chaveIdempotencia: `k${i}` }));
    p.contestar("ORDTST0001");
    p.contestar("ORDTST0002", "transacao");
    p.contestar("ORDTST0003", "lista");
    expect(p.todas().map((c) => [c.situacao, c.detalhe])).toEqual([
      ["contestado", "charged_back/in_process"],
      ["contestado", "processed/accredited; pagamento charged_back/in_process"],
      ["contestado", "processed/accredited"],
    ]);
  });

  it("recusar, expirar, cancelar no provedor e contestar mudam a situação", async () => {
    const p = novo();
    for (let i = 1; i <= 4; i++) await p.criarPix(pix({ referencia: `scl-${i}`, chaveIdempotencia: `k${i}` }));
    p.recusar("ORDTST0001");
    p.expirar("ORDTST0002");
    p.cancelarNoProvedor("ORDTST0003");
    p.aprovar("ORDTST0004");
    p.contestar("ORDTST0004");
    expect(p.todas().map((c) => c.situacao)).toEqual(["recusado", "expirado", "cancelado", "contestado"]);
    expect(() => p.aprovar("ORDTST9999")).toThrow();
  });
});

describe("ProvedorFalso: cancelar e devolver", () => {
  it("cancela o pendente; o aprovado não é cancelável; desconhecido → erro", async () => {
    const p = novo();
    await p.criarPix(pix());
    await p.criarCartao(cartao());
    expect(await p.cancelar("ORDTST0001", "c1")).toBe("cancelado");
    expect((await p.consultar("ORDTST0001"))!.situacao).toBe("cancelado");
    expect(await p.cancelar("ORDTST0001", "c2")).toBe("cancelado");
    expect(await p.cancelar("ORDTST0002", "c3")).toBe("nao_cancelavel");
    expect(await p.cancelar("ORDTST0099", "c4")).toBe("erro");
    // Chave repetida: como a API (erro), ou a mesma resposta.
    expect(await p.cancelar("ORDTST0001", "c1")).toBe("erro");
    p.chaveRepetida = "mesma_resposta";
    expect(await p.cancelar("ORDTST0001", "c1")).toBe("cancelado");
  });

  it("falha depois de cancelar: cancela e responde erro", async () => {
    const p = novo();
    await p.criarPix(pix());
    p.falhasDepois.cancelar = new ErroProvedor("incerto", "tempo");
    expect(await p.cancelar("ORDTST0001", "c1")).toBe("erro");
    expect((await p.consultar("ORDTST0001"))!.situacao).toBe("cancelado");
  });

  it("devolução integral confirmada; depois já devolvido", async () => {
    const p = novo();
    await p.criarCartao(cartao());
    const c = (await p.consultar("ORDTST0001"))!;
    expect(await p.devolver(c, "d1", null)).toEqual({ situacao: "confirmada", idDevolucao: "REFTST0001", mensagem: "Devolução confirmada pelo Mercado Pago.", codigo: null });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido", devolvido: 50_000, detalhe: "refunded/refunded" });
    expect(await p.devolver(c, "d2", null)).toMatchObject({ situacao: "confirmada", idDevolucao: null });
  });

  it("parcial: soma até o total; acima do disponível é recusada; sem transação é recusada", async () => {
    const p = novo();
    await p.criarCartao(cartao());
    const c = (await p.consultar("ORDTST0001"))!;
    expect(await p.devolver(c, "d1", 20_000)).toMatchObject({ situacao: "confirmada" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido_parcial", devolvido: 20_000 });
    expect(await p.devolver(c, "d2", 30_001)).toMatchObject({ situacao: "recusada" });
    expect(await p.devolver({ ...c, idTransacao: null }, "d3", 100)).toMatchObject({ situacao: "recusada" });
    expect(await p.devolver(c, "d4", 0)).toMatchObject({ situacao: "recusada" });
    expect(await p.devolver(c, "d5", 30_000)).toMatchObject({ situacao: "confirmada" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido", devolvido: 50_000 });
  });

  it("pendente ou recusado não devolve", async () => {
    const p = novo();
    await p.criarPix(pix());
    expect(await p.devolver((await p.consultar("ORDTST0001"))!, "d1", null)).toMatchObject({ situacao: "recusada" });
    expect(await p.devolver({ ...(await p.consultar("ORDTST0001"))!, idProvedor: "ORDTST0099" }, "d2", null)).toMatchObject({ situacao: "recusada" });
  });

  it("devolução 'pedida' espera a confirmação; nova integral enquanto pende → aguarde (M8.2c: não é aceita por esta chave)", async () => {
    const p = novo();
    p.respostaDevolucao = "pedida";
    await p.criarCartao(cartao());
    const c = (await p.consultar("ORDTST0001"))!;
    expect(await p.devolver(c, "d1", null)).toMatchObject({ situacao: "pedida", idDevolucao: "REFTST0001" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "aprovado", devolvido: 0 });
    expect(await p.devolver(c, "d2", null)).toEqual({ situacao: "aguarde", idDevolucao: null, mensagem: "Já há uma devolução em andamento para este pagamento: aguardar o Mercado Pago concluir.", codigo: "em_andamento" });
    p.confirmarDevolucoes("ORDTST0001");
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido", devolvido: 50_000 });
  });

  it("chave repetida na devolução: incerta (API) ou a mesma resposta; falha depois: devolve e responde incerta", async () => {
    const p = novo();
    await p.criarCartao(cartao());
    const c = (await p.consultar("ORDTST0001"))!;
    p.falhasDepois.devolver = new ErroProvedor("incerto", "tempo");
    expect(await p.devolver(c, "d1", 10_000)).toMatchObject({ situacao: "incerta" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ devolvido: 10_000 });
    p.falhasDepois.devolver = null;
    expect(await p.devolver(c, "d1", 10_000)).toMatchObject({ situacao: "incerta" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ devolvido: 10_000 });
    p.chaveRepetida = "mesma_resposta";
    expect(await p.devolver(c, "d1", 10_000)).toMatchObject({ situacao: "confirmada", idDevolucao: "REFTST0001" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ devolvido: 10_000 });
  });

  it("devolução feita no painel do provedor", async () => {
    const p = novo();
    await p.criarCartao(cartao());
    p.devolverNoProvedor("ORDTST0001", 5_000);
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido_parcial", devolvido: 5_000, detalhe: "processed/partially_refunded" });
    expect(() => p.devolverNoProvedor("ORDTST0001", -1)).toThrow();
  });
});

describe("ProvedorFalso: devoluções do M8.2c (ids, respostas com código e simuladores)", () => {
  const aprovado = async (p: ProvedorFalso) => {
    await p.criarCartao(cartao({ parcelas: 1 }));
    return (await p.consultar("ORDTST0001"))!;
  };

  it("as devoluções aparecem na leitura com id e estado; a do painel do provedor tem id próprio", async () => {
    const p = novo();
    p.respostaDevolucao = "pedida";
    const c = await aprovado(p);
    expect(c.devolucoes).toEqual([]);
    await p.devolver(c, "d1", null);
    expect(await p.consultar("ORDTST0001")).toMatchObject({ devolucaoEmAndamento: true, devolucoes: [{ id: "REFTST0001", estado: "andamento", valor: 50_000 }] });
    p.confirmarDevolucoes("ORDTST0001");
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido", devolucaoEmAndamento: false, devolucoes: [{ id: "REFTST0001", estado: "confirmada", valor: 50_000 }] });
    // A cópia é independente: mexer nela não muda a order.
    const lida = (await p.consultar("ORDTST0001"))!;
    lida.devolucoes[0].estado = "falhou";
    expect((await p.consultar("ORDTST0001"))!.devolucoes[0].estado).toBe("confirmada");
    const outro = novo();
    await aprovado(outro);
    outro.devolverNoProvedor("ORDTST0001", 5_000);
    expect((await outro.consultar("ORDTST0001"))!.devolucoes).toEqual([{ id: "REFPNL0001", estado: "confirmada", valor: 5_000 }]);
  });

  it.each([
    ["saldo_insuficiente", "recusada", "saldo_insuficiente"],
    ["prazo", "recusada", "prazo"],
    ["em_andamento", "aguarde", "em_andamento"],
    ["transitorio", "aguarde", "transitorio"],
  ] as const)("respostaDevolucao %s → %s com o código, sem mexer na order", async (resposta, situacao, codigo) => {
    const p = novo();
    const c = await aprovado(p);
    p.respostaDevolucao = resposta;
    expect(await p.devolver(c, "d1", null)).toMatchObject({ situacao, codigo, idDevolucao: null });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "aprovado", devolvido: 0, devolucaoEmAndamento: false, devolucoes: [] });
    // A espera não guarda a chave (nada foi aceito): a mesma chave vale depois. A recusa guarda (como a API).
    p.respostaDevolucao = "confirmada";
    expect((await p.devolver(c, "d1", null)).situacao).toBe(situacao === "aguarde" ? "confirmada" : "incerta");
  });

  it("toda resposta traz o código: aceitas e validações locais null; recusas do provedor com o código da lista", async () => {
    const p = novo();
    const c = await aprovado(p);
    expect((await p.devolver(c, "", null)).codigo).toBeNull();
    expect(await p.devolver(c, "d1", 60_000)).toMatchObject({ situacao: "recusada", codigo: "valor_excede" });
    expect(await p.devolver(c, "d2", null)).toMatchObject({ situacao: "confirmada", codigo: null });
    expect(await p.devolver(c, "d3", null)).toMatchObject({ situacao: "confirmada", idDevolucao: null, codigo: null });
    const pendente = novo();
    await pendente.criarPix(pix());
    expect(await pendente.devolver((await pendente.consultar("ORDTST0001"))!, "d1", null)).toMatchObject({ situacao: "recusada", codigo: "nao_permitido" });
  });

  it("falharDevolucao: a aceita passa a falhou na leitura; o devolvido e a situação não mudam", async () => {
    const p = novo();
    p.respostaDevolucao = "pedida";
    const c = await aprovado(p);
    await p.devolver(c, "d1", null);
    p.falharDevolucao("REFTST0001");
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "aprovado", devolvido: 0, devolucaoEmAndamento: false, devolucoes: [{ id: "REFTST0001", estado: "falhou" }] });
    expect(() => p.falharDevolucao("REFTST0099")).toThrow();
    // Sem devolução em andamento, um pedido novo cria outra.
    p.respostaDevolucao = "confirmada";
    expect(await p.devolver(c, "d2", null)).toMatchObject({ situacao: "confirmada", idDevolucao: "REFTST0002" });
  });

  it("atrasarListagem: a próxima aceita fica fora das próximas leituras (consultar), depois aparece", async () => {
    const p = novo();
    p.respostaDevolucao = "pedida";
    const c = await aprovado(p);
    await p.devolver(c, "d1", null);
    p.falharDevolucao("REFTST0001");
    p.atrasarListagem(2);
    expect(await p.devolver(c, "d2", null)).toMatchObject({ situacao: "pedida", idDevolucao: "REFTST0002" });
    // Leituras 1 e 2: só a antiga (que falhou); nada em andamento à vista.
    for (let i = 0; i < 2; i++) expect(await p.consultar("ORDTST0001")).toMatchObject({ devolucaoEmAndamento: false, devolucoes: [{ id: "REFTST0001", estado: "falhou" }] });
    // O provedor sabe dela: outra integral agora é "aguarde".
    expect((await p.devolver(c, "d3", null)).situacao).toBe("aguarde");
    expect((await p.consultar("ORDTST0001"))!.devolucoes.map((d) => [d.id, d.estado])).toEqual([["REFTST0001", "falhou"], ["REFTST0002", "andamento"]]);
    expect(() => p.atrasarListagem(-1)).toThrow();
  });

  it("detalheDevolvido processed/refunded: a order inteira devolvida vem desconhecida, com a devolução confirmada; nova devolução = já devolvida", async () => {
    const p = novo();
    p.detalheDevolvido = "processed/refunded";
    const c = await aprovado(p);
    expect(await p.devolver(c, "d1", null)).toMatchObject({ situacao: "confirmada", idDevolucao: "REFTST0001" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "desconhecido", detalhe: "processed/refunded", devolvido: 50_000, devolucoes: [{ id: "REFTST0001", estado: "confirmada", valor: 50_000 }] });
    expect(await p.devolver(c, "d2", null)).toMatchObject({ situacao: "confirmada", idDevolucao: null });
  });

  it("devolverAMenos: a próxima aceita conclui por menos (devolvida em parte), na hora ou ao confirmar", async () => {
    const p = novo();
    const c = await aprovado(p);
    p.devolverAMenos(30_000);
    expect(await p.devolver(c, "d1", null)).toMatchObject({ situacao: "confirmada", idDevolucao: "REFTST0001" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido_parcial", devolvido: 30_000, devolucoes: [{ id: "REFTST0001", estado: "confirmada", valor: 30_000 }] });
    const q = novo();
    q.respostaDevolucao = "pedida";
    const d = await aprovado(q);
    q.devolverAMenos(10_000);
    await q.devolver(d, "d1", null);
    expect((await q.consultar("ORDTST0001"))!.devolucoes).toEqual([{ id: "REFTST0001", estado: "andamento", valor: 50_000 }]);
    q.confirmarDevolucoes("ORDTST0001");
    expect(await q.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido_parcial", devolvido: 10_000, devolucoes: [{ id: "REFTST0001", estado: "confirmada", valor: 10_000 }] });
    // Só a próxima: a seguinte devolve o que pedir.
    expect(await q.devolver(d, "d2", null)).toMatchObject({ situacao: "pedida", idDevolucao: "REFTST0002" });
    expect(() => q.devolverAMenos(0)).toThrow();
  });

  it("esquecerOrder: a leitura não acha mais a order e a devolução é recusada como não encontrada", async () => {
    const p = novo();
    const c = await aprovado(p);
    p.esquecerOrder("ORDTST0001");
    expect(await p.consultar("ORDTST0001")).toBeNull();
    expect(await p.buscarPorReferencia("scl-2", new Date(AGORA.getTime() - 60_000))).toBeNull();
    expect(await p.devolver(c, "d1", null)).toMatchObject({ situacao: "recusada", codigo: "nao_encontrado" });
  });
});

describe("ProvedorFalso: devoluções de parte do valor (M8.2d) e o que a documentação não garante", () => {
  const SEM = { repetida: false, conhecidas: [] };
  const aprovado = async (p: ProvedorFalso) => {
    await p.criarPix(pix({ valor: 150_000 }));
    p.aprovar("ORDTST0001");
    return (await p.consultar("ORDTST0001"))!;
  };

  it("parcial termina devolvido em parte (processed/partially_refunded); somando o pago, a order fica devolvida (refunded/refunded)", async () => {
    const p = novo();
    const c = await aprovado(p);
    expect(await p.devolver(c, "d1", 30_000, SEM)).toMatchObject({ situacao: "confirmada", idDevolucao: "REFTST0001", codigo: null });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido_parcial", detalhe: "processed/partially_refunded", devolvido: 30_000, pago: 150_000 });
    expect(await p.devolver(c, "d2", 120_000, { repetida: false, conhecidas: ["REFTST0001"] })).toMatchObject({ situacao: "confirmada", idDevolucao: "REFTST0002" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido", detalhe: "refunded/refunded", devolvido: 150_000 });
    // As conhecidas chegam ao provedor (para os testes conferirem o que o domínio mandou).
    expect(p.chamadas.filter((x) => x.metodo === "devolver").map((x) => x.conhecidas)).toEqual([[], ["REFTST0001"]]);
  });

  it("parcial enquanto outra devolução está em andamento → aguarde/em_andamento (não só a integral), sem guardar a chave", async () => {
    const p = novo();
    p.respostaDevolucao = "pedida";
    const c = await aprovado(p);
    expect(await p.devolver(c, "d1", 30_000, SEM)).toMatchObject({ situacao: "pedida", idDevolucao: "REFTST0001" });
    expect(await p.devolver(c, "d2", 10_000, SEM)).toMatchObject({ situacao: "aguarde", codigo: "em_andamento", idDevolucao: null });
    p.confirmarDevolucoes("ORDTST0001");
    expect(await p.devolver(c, "d2", 10_000, SEM)).toMatchObject({ situacao: "pedida", idDevolucao: "REFTST0002" });
  });

  it("parte do valor numa order já devolvida inteira: recusada/ja_devolvido; com a chave repetida, incerta; a integral continua confirmada", async () => {
    const p = novo();
    const c = await aprovado(p);
    p.devolverNoProvedor("ORDTST0001", 150_000);
    expect(await p.devolver(c, "d1", 30_000, SEM)).toMatchObject({ situacao: "recusada", codigo: "ja_devolvido", idDevolucao: null });
    expect(await p.devolver(c, "d2", 30_000, { repetida: true, conhecidas: [] })).toMatchObject({ situacao: "incerta", codigo: null, idDevolucao: null });
    expect(await p.devolver(c, "d3", null, SEM)).toMatchObject({ situacao: "confirmada", idDevolucao: null, codigo: null });
  });

  it("devolverAMenos: aquela devolução conclui por menos e mantém o id; devolverNoProvedor é a devolução fora do sistema", async () => {
    const p = novo();
    const c = await aprovado(p);
    p.devolverAMenos(29_000);
    expect(await p.devolver(c, "d1", 30_000, SEM)).toMatchObject({ situacao: "confirmada", idDevolucao: "REFTST0001" });
    p.devolverNoProvedor("ORDTST0001", 5_000);
    expect(await p.consultar("ORDTST0001")).toMatchObject({
      situacao: "devolvido_parcial",
      devolvido: 34_000,
      devolucoes: [{ id: "REFTST0001", estado: "confirmada", valor: 29_000 }, { id: "REFPNL0001", estado: "confirmada", valor: 5_000 }],
    });
  });

  it("idDaDevolucao ausente: a resposta aceita não diz qual é a nossa (pedida, sem id); a leitura mostra a devolução com id", async () => {
    const p = novo();
    p.idDaDevolucao = "ausente";
    const c = await aprovado(p);
    expect(await p.devolver(c, "d1", 30_000, SEM)).toEqual({ situacao: "pedida", idDevolucao: null, mensagem: "Devolução pedida; aguardando confirmação do Mercado Pago.", codigo: null });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido_parcial", devolvido: 30_000, devolucoes: [{ id: "REFTST0001", estado: "confirmada", valor: 30_000 }] });
    // A mesma chave, na "mesma resposta": de novo sem id.
    p.chaveRepetida = "mesma_resposta";
    expect(await p.devolver(c, "d1", 30_000, { repetida: true, conhecidas: [] })).toMatchObject({ situacao: "pedida", idDevolucao: null });
  });

  it("listaNaLeitura desligada: a leitura vem sem a lista, com devolvido 0 e nada em andamento; o provedor continua limitando pelo real", async () => {
    const p = novo();
    p.listaNaLeitura = false;
    p.respostaDevolucao = "pedida";
    const c = await aprovado(p);
    await p.devolver(c, "d1", 30_000, SEM);
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "aprovado", devolvido: 0, devolucaoEmAndamento: false, devolucoes: [] });
    p.confirmarDevolucoes("ORDTST0001");
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido_parcial", devolvido: 0, devolucaoEmAndamento: false, devolucoes: [] });
    expect(await p.buscarPorReferencia("scl-1", AGORA)).toMatchObject({ devolvido: 0, devolucoes: [] });
    // O provedor sabe dos 30.000 devolvidos: 120.001 passa do que falta.
    p.respostaDevolucao = "confirmada";
    expect(await p.devolver(c, "d2", 120_001, SEM)).toMatchObject({ situacao: "recusada", codigo: "valor_excede" });
    expect(await p.devolver(c, "d3", 120_000, SEM)).toMatchObject({ situacao: "confirmada" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido", devolvido: 0 });
  });

  it("detalheParcial processed/refunded: a parcial vem desconhecida (como o exemplo da documentação), e a order ainda aceita o restante", async () => {
    const p = novo();
    p.detalheParcial = "processed/refunded";
    const c = await aprovado(p);
    expect(await p.devolver(c, "d1", 30_000, SEM)).toMatchObject({ situacao: "confirmada" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "desconhecido", detalhe: "processed/refunded", devolvido: 30_000 });
    expect(await p.devolver(c, "d2", 20_000, SEM)).toMatchObject({ situacao: "confirmada", idDevolucao: "REFTST0002" });
    expect(await p.devolver(c, "d3", null, SEM)).toMatchObject({ situacao: "confirmada", idDevolucao: "REFTST0003" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido", detalhe: "refunded/refunded", devolvido: 150_000 });
  });

  it("pagoLiquidoDeDevolucoes: o pago da leitura cai pelo devolvido; o limite do provedor continua o pago real", async () => {
    const p = novo();
    p.pagoLiquidoDeDevolucoes = true;
    const c = await aprovado(p);
    expect((await p.consultar("ORDTST0001"))!.pago).toBe(150_000);
    await p.devolver(c, "d1", 30_000, SEM);
    expect(await p.consultar("ORDTST0001")).toMatchObject({ pago: 120_000, valor: 150_000, devolvido: 30_000 });
    expect(await p.devolver(c, "d2", 120_000, SEM)).toMatchObject({ situacao: "confirmada" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido", pago: 0 });
  });

  it.each(["unsupported_partially_refunds", "max_refunds_exceeded"] as const)("parcialRecusada %s: a primeira parcial sai; a segunda é recusada/nao_permitido; a integral do restante sai", async (codigo) => {
    const p = novo();
    p.parcialRecusada = codigo;
    const c = await aprovado(p);
    expect(await p.devolver(c, "d1", 30_000, SEM)).toMatchObject({ situacao: "confirmada" });
    expect(await p.devolver(c, "d2", 10_000, SEM)).toMatchObject({ situacao: "recusada", codigo: "nao_permitido", idDevolucao: null });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ devolvido: 30_000 });
    expect(await p.devolver(c, "d3", null, SEM)).toMatchObject({ situacao: "confirmada" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido", devolvido: 150_000 });
  });

  it("o conjunto pessimista junto (sem id, sem lista, processed/refunded, pago líquido): nada trava, o provedor devolve o certo", async () => {
    const p = pessimista(novo());
    expect(p).toMatchObject({ idDaDevolucao: "ausente", listaNaLeitura: false, detalheParcial: "processed/refunded", pagoLiquidoDeDevolucoes: true, parcialRecusada: null });
    const c = await aprovado(p);
    expect(await p.devolver(c, "d1", 30_000, SEM)).toMatchObject({ situacao: "pedida", idDevolucao: null });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "desconhecido", detalhe: "processed/refunded", pago: 120_000, devolvido: 0, devolucoes: [] });
    expect(await p.devolver(c, "d2", 120_000, SEM)).toMatchObject({ situacao: "pedida", idDevolucao: null });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "devolvido", pago: 0, devolvido: 0 });
  });
});

describe("ProvedorFalso: conta de teste", () => {
  it("resposta ajustável (padrão true)", async () => {
    const p = novo();
    expect(await p.conferirContaDeTeste()).toBe(true);
    p.contaDeTeste = false;
    expect(await p.conferirContaDeTeste()).toBe(false);
    p.contaDeTeste = null;
    expect(await p.conferirContaDeTeste()).toBeNull();
    expect(p.chamadas.filter((c) => c.metodo === "conferirContaDeTeste")).toHaveLength(3);
  });
});

describe("ProvedorFalso: contestações (M8.2e)", () => {
  /** Um cartão aprovado (ORDTST0001, pagamento 9000000001) e, se pedido, um Pix aprovado (ORDTST0002, 9000000002). */
  async function comCartao(n = 1) {
    const p = novo();
    for (let i = 1; i <= n; i++) await p.criarCartao(cartao({ referencia: `scl-c${i}`, chaveIdempotencia: `kc${i}` }));
    return p;
  }
  const casoDe = (r: CasoDeContestacao | CasoDeContestacao[] | null | { semAcesso: true }): CasoDeContestacao => {
    if (!r || semAcessoContestacao(r)) throw new Error("sem caso");
    return Array.isArray(r) ? r[0] : r;
  };

  it("contestar: o item na lista da order (CBK, caso, valor; transaction_id diferente do pagamento) e o caso na Chargebacks API com o número do pagamento", async () => {
    const p = await comCartao();
    const ids = p.contestar("ORDTST0001", "transacao");
    expect(ids).toEqual({ idCaso: "7000000001", idCbk: "CBKTST0001" });
    const c = (await p.consultar("ORDTST0001"))!;
    expect(c).toMatchObject({ situacao: "contestado", detalhe: "processed/accredited; pagamento charged_back/in_process", transacaoAprovada: false });
    expect(c.contestacoes).toEqual([{ idContestacao: "CBKTST0001", idCaso: "7000000001", idTransacao: "PAYCBK0001", estadoLido: "in_process", codigo: "in_process", valor: 50_000, daTransacao: false }]);
    expect(c.contestacoes[0].idTransacao).not.toBe(c.idTransacao);
    const caso = casoDe(await p.consultarContestacao("7000000001"));
    expect(caso).toEqual({
      idCaso: "7000000001", pagamentos: ["9000000001"], valor: 50_000, motivoId: null, motivoCodigo: null, coberturaAplicada: null, coberturaElegivel: true, documentacao: "pending",
      prazoDocumentacao: new Date("2026-10-18T15:00:00.000Z"), criadoEm: AGORA, atualizadoEm: AGORA, aoVivo: false,
    });
    expect(await p.buscarContestacoes("9000000001")).toEqual([caso]);
    expect(await p.buscarContestacoes("9000000099")).toEqual([]);
    expect(await p.consultarContestacao("7000000099")).toBeNull();
    expect(p.chamadas.slice(-4).map((x) => [x.metodo, x.id])).toEqual([["consultarContestacao", "7000000001"], ["buscarContestacoes", "9000000001"], ["buscarContestacoes", "9000000099"], ["consultarContestacao", "7000000099"]]);
  });

  it("opções: valor, ids, documentação, prazo, cobertura e motivo (uma frase nunca passa, como no cliente real)", async () => {
    const p = await comCartao();
    p.contestar("ORDTST0001", "order", { valor: 20_000, idCaso: "234000", idCbk: "CBK01FICTICIO", documentacao: "review_pending", prazo: null, cobertura: false, elegivel: null, motivoId: "4837", motivoCodigo: "Maria Ficticia diz que não reconhece" });
    expect((await p.consultar("ORDTST0001"))!.contestacoes).toMatchObject([{ idContestacao: "CBK01FICTICIO", idCaso: "234000", valor: 20_000 }]);
    expect(casoDe(await p.consultarContestacao("234000"))).toMatchObject({ valor: 20_000, documentacao: "review_pending", prazoDocumentacao: null, coberturaAplicada: false, coberturaElegivel: null, motivoId: "4837", motivoCodigo: null });
    expect(() => p.contestar("ORDTST0001", "order", { idCaso: "234000" })).toThrow();
    expect(() => p.contestar("ORDTST0001", "order", { idCaso: "12a" })).toThrow();
    expect(() => p.contestar("ORDTST0001", "order", { idCbk: "REF01" })).toThrow();
    expect(() => p.contestar("ORDTST0001", "order", { valor: 0 })).toThrow();
    expect(() => p.contestar("ORDTST0001", "lista", { naLista: false })).toThrow();
  });

  it("resolverContestacao: settled e reimbursed (com cobertura false) na order e na transação; só na lista, reimbursed volta a aprovado (como normalizarSituacao)", async () => {
    const p = await comCartao(3);
    p.contestar("ORDTST0001");
    p.contestar("ORDTST0002", "transacao");
    p.contestar("ORDTST0003", "lista");
    p.resolverContestacao("ORDTST0001", { estado: "settled" });
    p.resolverContestacao("CBKTST0002", { estado: "reimbursed", cobertura: false });
    p.resolverContestacao("7000000003", { estado: "reimbursed", cobertura: false });
    const [a, b, c] = p.todas();
    expect([a.situacao, a.detalhe, a.contestacoes[0].estadoLido]).toEqual(["contestado", "charged_back/settled", "settled"]);
    expect([b.situacao, b.detalhe, b.contestacoes[0].estadoLido]).toEqual(["contestado", "processed/accredited; pagamento charged_back/reimbursed", "reimbursed"]);
    expect([c.situacao, c.detalhe, c.contestacoes[0].estadoLido, c.transacaoAprovada]).toEqual(["aprovado", "processed/accredited", "reimbursed", true]);
    expect(casoDe(await p.consultarContestacao("7000000002")).coberturaAplicada).toBe(false);
  });

  it("cobertura null → true/false sem mudar o estado; a transação de volta a aprovada (o fato) com a contestação ainda na lista", async () => {
    const p = await comCartao();
    p.contestar("ORDTST0001", "order");
    expect(casoDe(await p.consultarContestacao("7000000001")).coberturaAplicada).toBeNull();
    p.resolverContestacao("7000000001", { cobertura: true });
    expect(casoDe(await p.consultarContestacao("7000000001"))).toMatchObject({ coberturaAplicada: true });
    expect((await p.consultar("ORDTST0001"))!.contestacoes[0].estadoLido).toBe("in_process");
    p.resolverContestacao("7000000001", { estado: "settled", transacaoAprovada: true });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "contestado", detalhe: "processed/accredited", transacaoAprovada: true, contestacoes: [{ estadoLido: "settled" }] });
    p.resolverContestacao("7000000001", { cobertura: false });
    expect(casoDe(await p.consultarContestacao("7000000001")).coberturaAplicada).toBe(false);
    // Volta a in_process (reapresentação): a transação contestada de novo.
    p.resolverContestacao("7000000001", { estado: "in_process", transacaoAprovada: false });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "contestado", detalhe: "charged_back/in_process", transacaoAprovada: false });
  });

  it("status estranho: a leitura vem desconhecida, com o código cru", async () => {
    const p = await comCartao();
    p.contestar("ORDTST0001", "order", { estado: "in_mediation" });
    expect((await p.consultar("ORDTST0001"))!.contestacoes).toMatchObject([{ estadoLido: "desconhecido", codigo: "in_mediation" }]);
    expect(() => p.resolverContestacao("ORDTST0001", { estado: "Maria Ficticia" })).toThrow();
  });

  it("transação contestada sem a lista: uma leitura sem identificação nem valor; depois a lista traz o item com os ids", async () => {
    const p = await comCartao();
    p.contestar("ORDTST0001", "transacao", { naLista: false });
    expect((await p.consultar("ORDTST0001"))!.contestacoes).toEqual([{ idContestacao: null, idCaso: null, idTransacao: null, estadoLido: "in_process", codigo: "in_process", valor: null, daTransacao: true }]);
    // A Chargebacks API já conhece o caso.
    expect(await p.buscarContestacoes("9000000001")).toHaveLength(1);
    p.resolverContestacao("ORDTST0001", { estado: "settled" });
    expect((await p.consultar("ORDTST0001"))!.contestacoes).toMatchObject([{ daTransacao: true, estadoLido: "settled" }]);
    p.mostrarNaLista("ORDTST0001");
    expect((await p.consultar("ORDTST0001"))!.contestacoes).toMatchObject([{ idContestacao: "CBKTST0001", idCaso: "7000000001", estadoLido: "settled", daTransacao: false }]);
  });

  it("documentacaoDoCaso: situação e prazo (null = sem prazo); fora da lista vira desconhecida", async () => {
    const p = await comCartao();
    p.contestar("ORDTST0001");
    p.documentacaoDoCaso("7000000001", "valid", null);
    expect(casoDe(await p.consultarContestacao("7000000001"))).toMatchObject({ documentacao: "valid", prazoDocumentacao: null });
    p.documentacaoDoCaso("7000000001", "algo_novo");
    expect(casoDe(await p.consultarContestacao("7000000001"))).toMatchObject({ documentacao: "desconhecida", prazoDocumentacao: null });
    p.documentacaoDoCaso("7000000001", "pending", new Date("2026-10-20T00:00:00.000Z"));
    expect(casoDe(await p.consultarContestacao("7000000001")).prazoDocumentacao).toEqual(new Date("2026-10-20T00:00:00.000Z"));
  });

  it("casoDeOutroPagamento: o caso mostra outro número em payments[] (a busca deste pagamento não o acha)", async () => {
    const p = await comCartao();
    p.contestar("ORDTST0001");
    p.casoDeOutroPagamento("7000000001");
    expect(casoDe(await p.consultarContestacao("7000000001")).pagamentos).toEqual(["8999999999"]);
    expect(await p.buscarContestacoes("9000000001")).toEqual([]);
    expect(await p.buscarContestacoes("8999999999")).toHaveLength(1);
    expect(() => p.casoDeOutroPagamento("7000000001", "x")).toThrow();
  });

  it("contestarTarde: só pela Chargebacks API, com a order apagada; sem order conhecida, só com o número (e o valor)", async () => {
    const p = await comCartao();
    p.aprovar("ORDTST0001", { liberado: true });
    expect(p.contestarTarde("9000000001")).toEqual({ idCaso: "7000000001", idCbk: "CBKTST0001" });
    expect(await p.consultar("ORDTST0001")).toBeNull();
    expect(casoDe(await p.buscarContestacoes("9000000001"))).toMatchObject({ idCaso: "7000000001", pagamentos: ["9000000001"], valor: 50_000 });
    expect(await p.situacaoDoPagamento("9000000001")).toEqual({ status: "charged_back", statusDetail: "in_process", moneyReleaseStatus: "released" });
    p.resolverContestacao("9000000001", { estado: "settled", cobertura: true });
    expect(await p.situacaoDoPagamento("9000000001")).toMatchObject({ status: "charged_back", statusDetail: "settled" });
    expect(() => p.contestarTarde("1234")).toThrow();
    p.contestarTarde("1234", { valor: 1_000 });
    expect(casoDe(await p.buscarContestacoes("1234"))).toMatchObject({ pagamentos: ["1234"], valor: 1_000 });
    expect(await p.situacaoDoPagamento("1234")).toEqual({ status: "charged_back", statusDetail: "in_process", moneyReleaseStatus: null });
    expect(() => p.contestarTarde("PAY01")).toThrow();
  });

  it("id como número: um id seguro é lido igual; com 18 algarismos chega arredondado (a order fica sem o caso, a Chargebacks API ilegível)", async () => {
    const p = await comCartao(2);
    p.contestar("ORDTST0001", "order", { idComo: "numero", idCaso: "123456789" });
    p.contestar("ORDTST0002", "order", { idComo: "numero", idCaso: "234000062890459000" });
    expect((await p.consultar("ORDTST0001"))!.contestacoes[0].idCaso).toBe("123456789");
    expect(casoDe(await p.consultarContestacao("123456789")).idCaso).toBe("123456789");
    expect((await p.consultar("ORDTST0002"))!.contestacoes[0]).toMatchObject({ idContestacao: "CBKTST0002", idCaso: null });
    await expect(p.consultarContestacao("234000062890459000")).rejects.toBeInstanceOf(ErroProvedor);
    await expect(p.buscarContestacoes("9000000002")).rejects.toBeInstanceOf(ErroProvedor);
    // Como texto (o exemplo oficial), o mesmo número é lido.
    const q = await comCartao();
    q.contestar("ORDTST0001", "order", { idCaso: "234000062890459000" });
    expect((await q.consultar("ORDTST0001"))!.contestacoes[0].idCaso).toBe("234000062890459000");
    expect(casoDe(await q.consultarContestacao("234000062890459000")).idCaso).toBe("234000062890459000");
  });

  it("segunda disputa no mesmo pagamento: dois itens e dois casos; a order mostra o estado da mais nova", async () => {
    const p = await comCartao();
    p.contestar("ORDTST0001");
    p.resolverContestacao("7000000001", { estado: "settled" });
    p.contestar("ORDTST0001", "order", { valor: 10_000 });
    const c = (await p.consultar("ORDTST0001"))!;
    expect(c.detalhe).toBe("charged_back/in_process");
    expect(c.contestacoes.map((x) => [x.idCaso, x.estadoLido, x.valor])).toEqual([["7000000001", "settled", 50_000], ["7000000002", "in_process", 10_000]]);
    expect(await p.buscarContestacoes("9000000001")).toHaveLength(2);
  });

  it("respostaChargebacks por método: 403 = sem acesso; 404 = consulta null e busca lança; falha lança; falhas[metodo] também", async () => {
    const p = await comCartao();
    p.contestar("ORDTST0001");
    p.respostaChargebacks = { consultarContestacao: "403", buscarContestacoes: "403" };
    expect(await p.consultarContestacao("7000000001")).toEqual({ semAcesso: true });
    expect(await p.buscarContestacoes("9000000001")).toEqual({ semAcesso: true });
    p.respostaChargebacks = { consultarContestacao: "404", buscarContestacoes: "404" };
    expect(await p.consultarContestacao("7000000001")).toBeNull();
    await expect(p.buscarContestacoes("9000000001")).rejects.toMatchObject({ tipo: "incerto" });
    p.respostaChargebacks = { consultarContestacao: "falha" };
    await expect(p.consultarContestacao("7000000001")).rejects.toMatchObject({ tipo: "incerto" });
    expect(await p.buscarContestacoes("9000000001")).toHaveLength(1);
    p.respostaChargebacks = { buscarContestacoes: "falha" };
    await expect(p.buscarContestacoes("9000000001")).rejects.toBeInstanceOf(ErroProvedor);
    p.respostaChargebacks = {};
    p.falhas.situacaoDoPagamento = new ErroProvedor("indisponivel", "x");
    await expect(p.situacaoDoPagamento("9000000001")).rejects.toMatchObject({ tipo: "indisponivel" });
    // Id que não pode existir: como o cliente real, sem resposta forçada.
    p.respostaChargebacks = { consultarContestacao: "falha", buscarContestacoes: "falha" };
    expect(await p.consultarContestacao("CBK1")).toBeNull();
    expect(await p.buscarContestacoes("PAY1")).toEqual([]);
  });

  it("situacaoDoPagamento: pela situação da order, com a liberação do financeiro; desconhecido ou situacaoAusente = null", async () => {
    const p = novo();
    await p.criarPix(pix());
    expect(await p.situacaoDoPagamento("9000000001")).toEqual({ status: "pending", statusDetail: "pending_waiting_payment", moneyReleaseStatus: null });
    p.aprovar("ORDTST0001", { liberado: false });
    expect(await p.situacaoDoPagamento("9000000001")).toEqual({ status: "approved", statusDetail: "accredited", moneyReleaseStatus: "pending" });
    p.contestar("ORDTST0001", "lista");
    expect(await p.situacaoDoPagamento("9000000001")).toMatchObject({ status: "charged_back", statusDetail: "in_process" });
    p.resolverContestacao("ORDTST0001", { estado: "settled", cobertura: true, transacaoAprovada: true });
    expect(await p.situacaoDoPagamento("9000000001")).toMatchObject({ status: "approved", statusDetail: "accredited" });
    expect(await p.situacaoDoPagamento("9000000099")).toBeNull();
    expect(await p.situacaoDoPagamento("x")).toBeNull();
    p.situacaoAusente = true;
    expect(await p.situacaoDoPagamento("9000000001")).toBeNull();
  });

  it("Pix contestado: o mesmo caminho (o número do pagamento existe também no Pix)", async () => {
    const p = novo();
    await p.criarPix(pix());
    p.aprovar("ORDTST0001");
    p.contestar("ORDTST0001");
    expect(await p.consultar("ORDTST0001")).toMatchObject({ forma: "pix", situacao: "contestado", contestacoes: [{ idCaso: "7000000001", valor: 100_000 }] });
    expect(await p.buscarContestacoes("9000000001")).toHaveLength(1);
  });
});
