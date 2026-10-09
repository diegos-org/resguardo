import { describe, expect, it } from "vitest";
import { ProvedorFalso } from "./falso";
import { ErroProvedor, type PedidoCartao, type PedidoPix, RECUSA_GENERICA, urlDoDesafio } from "./provedor";

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
    expect(await p.devolver(c, "d1", null)).toEqual({ situacao: "confirmada", idDevolucao: "REFTST0001", mensagem: "Devolução confirmada pelo Mercado Pago." });
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

  it("devolução 'pedida' espera a confirmação; nova integral enquanto pende → pedida", async () => {
    const p = novo();
    p.respostaDevolucao = "pedida";
    await p.criarCartao(cartao());
    const c = (await p.consultar("ORDTST0001"))!;
    expect(await p.devolver(c, "d1", null)).toMatchObject({ situacao: "pedida", idDevolucao: "REFTST0001" });
    expect(await p.consultar("ORDTST0001")).toMatchObject({ situacao: "aprovado", devolvido: 0 });
    expect(await p.devolver(c, "d2", null)).toMatchObject({ situacao: "pedida", idDevolucao: null });
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
