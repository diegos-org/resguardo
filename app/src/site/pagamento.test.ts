import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_PAGAMENTO_SITE_PADRAO, salvarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { cotacoes, disjuntoresCartao, imoveis, pagamentos, tentativasLogin } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { emitirAutorizacao, validadeDaAutorizacao } from "@/pagamentos/autorizacao";
import { conferirTentativa } from "@/pagamentos/conferencia";
import { ERROS_LIMITE, LIMITES_PAGAMENTO } from "@/pagamentos/limites";
import type { PortaoCobranca } from "@/pagamentos/oferta";
import type { CodigoFalhaCartao } from "@/pagamentos/cartao";
import { type CodigoFalhaPix, gerarPix } from "@/pagamentos/pix";
import { ProvedorFalso } from "@/pagamentos/falso";
import { ErroProvedor } from "@/pagamentos/provedor";
import { AGORA, type Cenario, CHAVE_PUBLICA_FICTICIA, EMAIL_HOSPEDE, env, minutos, montarCenario, TOTAL } from "@/pagamentos/testes";
import { CACHE_PAGAMENTO, cartaoNoSite, MENSAGENS_CARTAO_HOSPEDE, MENSAGENS_PIX_HOSPEDE, mensagemSemPix, pixPossivel, portaoDoSite, responderPagamento, vistaDoPagamento } from "./pagamento";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  vi.stubEnv("AUTH_SECRET", "segredo-de-teste-ficticio");
});

const desligado: PortaoCobranca = { ok: false, motivo: "desligado", texto: "desligado" };
const vista = (cotacaoId: string, quando: Date, comAutorizacao: boolean, gate: PortaoCobranca = c.gate) => vistaDoPagamento(db, c.org, cotacaoId, quando, { comAutorizacao, gate: async () => gate });
const token = (cotacaoId: string) => emitirAutorizacao(cotacaoId, validadeDaAutorizacao(minutos(30), AGORA));
const consultar = (codigo: string, o: { token?: string; origem?: string | null; quando?: Date; organizacao?: string | null } = {}) =>
  responderPagamento(db, codigo, {
    organizacao: async () => (o.organizacao === undefined ? c.org : o.organizacao),
    token: () => o.token,
    origem: o.origem === undefined ? "203.0.113.50" : o.origem,
    agora: o.quando ?? minutos(1),
    env: env(),
    provedor: c.provedor,
    chavePublica: CHAVE_PUBLICA_FICTICIA,
  });

describe("o que a página da cotação mostra do pagamento (M8.2a)", () => {
  it("'pagar' só com o Pix oferecido (a oferta só é conferida quando decide); QR só com a autorização, já pronto para o navegador", async () => {
    const s = await c.segurar();
    expect(await vista(s.cotacaoId, AGORA, true, desligado)).toMatchObject({ estado: "sem_pagamento", holdAte: minutos(30).toISOString() });
    expect(await vista(s.cotacaoId, AGORA, true)).toMatchObject({ estado: "pagar", pixRestantes: 3, ambienteTeste: true, pix: null });
    const p = await c.pix(s.cotacaoId);
    const com = await vista(s.cotacaoId, minutos(1), true);
    expect(com).toMatchObject({ estado: "pix_aguardando", pix: { imagem: "data:image/png;base64,RkFMU08=", expiraEm: minutos(30).toISOString() } });
    expect(com?.pix?.copiaECola).toContain(p.idProvedor);
    expect(com?.pix?.link).toMatch(/^https:\/\//);
    expect(await vista(s.cotacaoId, minutos(1), false)).toMatchObject({ estado: "pix_aguardando", pix: null });
    // Nada pessoal, nem com a autorização.
    expect(JSON.stringify(com)).not.toContain(EMAIL_HOSPEDE);
    expect(JSON.stringify(com)).not.toContain("Visitante");
  });

  it("prazo das datas acabado com o último Pix cancelado há pouco (ainda pode virar dinheiro): 'conferindo', e a página continua acompanhando até o fim da leitura", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    await db.update(pagamentos).set({ situacao: "cancelado" }).where(eq(pagamentos.id, p.pagamentoId));
    // 35 min: prazo das datas (30 min + 2) passado; o Pix (vencia aos 30) ainda está na folga de 15 min da leitura.
    expect(await vista(s.cotacaoId, minutos(35), true)).toMatchObject({ estado: "verificando", acompanhar: true, podeGerar: false });
    // Depois da folga, nada mais a acompanhar.
    expect(await vista(s.cotacaoId, minutos(50), true)).toMatchObject({ estado: "sem_pagamento", acompanhar: false });
  });

  it("dinheiro sem desfecho nunca aparece como 'sem pagamento' (nem com o pedido vencido): mostra 'conferindo'", async () => {
    const s = await c.segurar();
    const base = { organizacaoId: c.org, cotacaoId: s.cotacaoId, reservaId: s.reservaId, imovelId: c.imovel, ambiente: "teste" as const, forma: "pix" as const, valor: TOTAL };
    await db.insert(pagamentos).values({ ...base, referencia: "scl-antiga", chaveIdempotencia: "antiga", situacao: "pendente", criadoEm: minutos(-10) });
    await db.insert(pagamentos).values({ ...base, referencia: "scl-nova", chaveIdempotencia: "nova", situacao: "cancelado", criadoEm: minutos(-5) });
    // Prazo das datas passado: a vista do domínio cairia em "sem pagamento", com dinheiro em andamento.
    expect(await vista(s.cotacaoId, minutos(60), true)).toMatchObject({ estado: "verificando", dinheiroSemDesfecho: true });
  });

  it("Pix vencido: 'Gerar outro Pix' só com o Pix ainda oferecido; último Pix ainda pendente com o QR vencido: 'conferindo', não 'esgotado'", async () => {
    const s = await c.segurar();
    const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
    const p = await c.pix(s.cotacaoId);
    c.provedor.expirar(p.idProvedor);
    await conferir(p.pagamentoId, minutos(31));
    expect(await vista(s.cotacaoId, minutos(31), true)).toMatchObject({ estado: "pix_vencido", podeGerar: true });
    expect(await vista(s.cotacaoId, minutos(31), true, desligado)).toMatchObject({ estado: "pix_vencido", podeGerar: false });
    const segundo = await gerarPix(db, c.org, s.cotacaoId, minutos(31), c.provedor);
    if (!segundo.ok) throw new Error(segundo.erro);
    c.provedor.expirar((await c.tentativa(segundo.pagamentoId)).idProvedor!);
    await conferir(segundo.pagamentoId, minutos(61.5));
    // Terceiro Pix: o QR venceu no relógio, mas ninguém leu o provedor ainda (pode ter sido pago no último instante).
    const terceiro = await gerarPix(db, c.org, s.cotacaoId, minutos(62), c.provedor);
    if (!terceiro.ok) throw new Error(terceiro.erro);
    expect(await vista(s.cotacaoId, minutos(92.5), true)).toMatchObject({ estado: "verificando", dinheiroSemDesfecho: true, podeGerar: false });
    // Lido como vencido: aí sim, esgotado (e a página para de consultar).
    c.provedor.expirar((await c.tentativa(terceiro.pagamentoId)).idProvedor!);
    await conferir(terceiro.pagamentoId, minutos(92.6));
    expect(await vista(s.cotacaoId, minutos(92.6), true)).toMatchObject({ estado: "pix_esgotado", dinheiroSemDesfecho: false });
  });

  it("Pix marcado como real (live_mode) no teste, cancelado na hora: a página não oferece outro Pix (nem 'Gerar outro Pix'), e gerar de novo é recusado sem gastar outro dos 3", async () => {
    const s = await c.segurar();
    c.provedor.aoVivo = true;
    expect(await gerarPix(db, c.org, s.cotacaoId, minutos(1), c.provedor)).toMatchObject({ ok: false, codigo: "ao_vivo" });
    const [t] = await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, s.cotacaoId));
    expect(t).toMatchObject({ situacao: "cancelado", aoVivo: true });
    // As datas continuam seguradas, mas sem oferta: "o pagamento pelo site não está disponível agora" (fale com a equipe).
    expect(await vista(s.cotacaoId, minutos(1), true)).toMatchObject({ estado: "pix_vencido", podeGerar: false, pix: null, holdAte: minutos(30).toISOString() });
    expect(await (await consultar(s.codigo, { token: token(s.cotacaoId), quando: minutos(2) })).json()).toMatchObject({ estado: "pix_vencido", podeGerar: false, pix: null });
    // Mesmo que o próximo viesse normal, nenhum outro Pix é gerado nesta cotação.
    c.provedor.aoVivo = false;
    expect(await gerarPix(db, c.org, s.cotacaoId, minutos(3), c.provedor)).toMatchObject({ ok: false, codigo: "ao_vivo" });
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarPix")).toHaveLength(1);
    expect(MENSAGENS_PIX_HOSPEDE.ao_vivo).toContain("Fale com a equipe");
  });

  it("Pix marcado como real com o cancelamento falhando: nunca o QR nem 'aguardando' (mesmo com a autorização); 'conferindo' até o cancelamento pegar, sem reaproveitar o Pix", async () => {
    const s = await c.segurar();
    c.provedor.aoVivo = true;
    c.provedor.falhas.cancelar = new ErroProvedor("indisponivel", "fora do ar");
    expect(await gerarPix(db, c.org, s.cotacaoId, minutos(1), c.provedor)).toMatchObject({ ok: false, codigo: "ao_vivo" });
    const [t] = await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, s.cotacaoId));
    expect(t).toMatchObject({ situacao: "pendente", aoVivo: true });
    expect(t.pixCopiaECola).not.toBeNull();
    const v = await vista(s.cotacaoId, minutos(1), true);
    expect(v).toMatchObject({ estado: "verificando", pix: null, podeGerar: false });
    // "Gerar Pix" de novo: recusado, sem mostrar de novo o Pix real nem criar outro.
    expect(await gerarPix(db, c.org, s.cotacaoId, minutos(2), c.provedor)).toMatchObject({ ok: false, codigo: "ao_vivo" });
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarPix")).toHaveLength(1);
    // A consulta da página lê a order e manda cancelar de novo; com o Mercado Pago de volta, cancela e fica sem oferta.
    c.provedor.falhas.cancelar = null;
    const r = await (await consultar(s.codigo, { token: token(s.cotacaoId), quando: minutos(3) })).json();
    expect(r).toMatchObject({ estado: "pix_vencido", podeGerar: false, pix: null });
    expect((await c.tentativa(t.id)).situacao).toBe("cancelado");
  });

  it("Pix possível numa consulta ou cotação aberta: travas, situação disponível com valor, imóvel do site e motor sem pendência", async () => {
    const estadia = { imovel: { codigo: "403" }, checkin: "2026-10-12", checkout: "2026-10-15", situacao: "disponivel", total: TOTAL };
    expect(await pixPossivel(db, c.org, estadia, c.gate)).toBe(true);
    expect(await pixPossivel(db, c.org, { ...estadia, imovel: { id: c.imovel } }, c.gate)).toBe(true);
    expect(await pixPossivel(db, c.org, estadia, desligado)).toBe(false);
    expect(await pixPossivel(db, c.org, { ...estadia, situacao: "a_confirmar" }, c.gate)).toBe(false);
    expect(await pixPossivel(db, c.org, { ...estadia, total: null }, c.gate)).toBe(false);
    // Antes do contrato de gestão (início 2025-01-01): o motor teria pendência.
    expect(await pixPossivel(db, c.org, { ...estadia, checkin: "2024-12-10", checkout: "2024-12-12" }, c.gate)).toBe(false);
    // Imóvel sem proprietário nem contrato, e imóvel fora do site.
    await db.insert(imoveis).values({ organizacaoId: c.org, codigo: "501", nome: "Outro", publico: true, capacidade: 2 });
    expect(await pixPossivel(db, c.org, { ...estadia, imovel: { codigo: "501" } }, c.gate)).toBe(false);
    await db.update(imoveis).set({ publico: false }).where(eq(imoveis.id, c.imovel));
    expect(await pixPossivel(db, c.org, estadia, c.gate)).toBe(false);
  });

  it("travas do site: sem as chaves, não cobra; com o provedor de teste, cobra", async () => {
    expect(await portaoDoSite(db, c.org, AGORA, { env: env() })).toMatchObject({ ok: false, motivo: "desligado" });
    expect(await portaoDoSite(db, c.org, AGORA, { env: env(), provedor: c.provedor })).toMatchObject({ ok: true, ambiente: "teste" });
  });

  it("conta do Mercado Pago que não responde: as travas do site e a consulta da página não ficam presas — não cobra e segue no prazo", async () => {
    const s = await c.segurar();
    const lento = new ProvedorFalso(() => AGORA);
    lento.conferirContaDeTeste = () => new Promise<boolean | null>(() => {});
    const inicio = performance.now();
    expect(await portaoDoSite(db, c.org, AGORA, { env: env(), provedor: lento, esperaMs: 50 })).toMatchObject({ ok: false, motivo: "conta_nao_conferida" });
    const r = await responderPagamento(db, s.codigo, { organizacao: async () => c.org, token: () => undefined, origem: "203.0.113.51", agora: minutos(1), env: env(), provedor: lento, esperaMs: 50 });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ estado: "sem_pagamento" });
    expect(lento.chamadas.filter((x) => x.metodo === "consultar" || x.metodo === "buscarPorReferencia")).toEqual([]);
    expect(performance.now() - inicio).toBeLessThan(2_000);
  });

  it("mensagens ao hóspede: uma para cada falha do Pix, sem texto do provedor nem motivo interno", () => {
    // M8.2b: `em_analise` (um cartão desta cotação em análise impede o Pix).
    const codigos: CodigoFalhaPix[] = ["nao_encontrada", "nao_oferecido", "em_andamento", "em_analise", "ja_pago", "limite", "provedor", "incerto", "recusado", "ocupado", "ao_vivo", "aceite_pendente", "aceite_mudou"];
    expect(Object.keys(MENSAGENS_PIX_HOSPEDE).sort()).toEqual([...codigos].sort());
    for (const m of Object.values(MENSAGENS_PIX_HOSPEDE)) expect(m).not.toMatch(/Configurações|painel|Beds24|contrato|proprietário/i);
    expect(mensagemSemPix("prazo_vencido")).toBe("O prazo das datas desta cotação acabou.");
    expect(mensagemSemPix("varios_proprietarios")).toBe(MENSAGENS_PIX_HOSPEDE.nao_oferecido);
    expect(mensagemSemPix("desligado_no_painel")).toBe(MENSAGENS_PIX_HOSPEDE.nao_oferecido);
  });
});

describe("rota que a página consulta enquanto espera (M8.2a)", () => {
  it("código inválido, site sem organização e cotação inexistente: recusa sem cache e sem dizer nada", async () => {
    for (const [codigo, o, status] of [
      ["nada", {}, 400],
      ["COT-ABCDEFG0", {}, 400],
      ["COT-ABCDEFGH", { organizacao: null }, 404],
      ["COT-ABCDEFGH", {}, 404],
    ] as const) {
      const r = await consultar(codigo, o);
      expect(r.status).toBe(status);
      expect(r.headers.get("Cache-Control")).toBe(CACHE_PAGAMENTO);
      expect(Object.keys(await r.json())).toEqual(["erro"]);
    }
  });

  it("QR só com o cookie do pedido; nada pessoal na resposta; código em minúsculas vale", async () => {
    const s = await c.segurar();
    await c.pix(s.cotacaoId);
    const sem = await consultar(s.codigo);
    expect(sem.status).toBe(200);
    expect(sem.headers.get("Cache-Control")).toBe("no-store");
    expect(await sem.json()).toMatchObject({ estado: "pix_aguardando", pix: null });
    const outra = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "outra@example.com" });
    // Cookie de outra cotação não autoriza esta.
    expect(await (await consultar(s.codigo, { token: token(outra.cotacaoId) })).json()).toMatchObject({ pix: null });
    const com = await consultar(s.codigo.toLowerCase(), { token: token(s.cotacaoId) });
    const corpo = await com.text();
    expect(JSON.parse(corpo)).toMatchObject({ estado: "pix_aguardando", pix: { imagem: "data:image/png;base64,RkFMU08=" } });
    expect(corpo).not.toContain(EMAIL_HOSPEDE);
    expect(corpo).not.toContain("Visitante");
    expect(corpo).not.toContain("99999");
  });

  it("confere o pagamento com o provedor enquanto espera e mostra a reserva confirmada", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    c.provedor.aprovar(p.idProvedor);
    // Passados os 15 s da última leitura, a consulta da página lê o provedor e aplica a aprovação.
    const r = await consultar(s.codigo, { quando: minutos(2) });
    expect(await r.json()).toMatchObject({ estado: "confirmada", reservaCodigo: (await c.reserva(s.reservaId)).codigo });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
  });

  it("falha do provedor não derruba a consulta: mostra o que o banco já sabe", async () => {
    const s = await c.segurar();
    await c.pix(s.cotacaoId);
    c.provedor.falhar = new ErroProvedor("indisponivel", "fora do ar");
    const r = await consultar(s.codigo, { quando: minutos(3) });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ estado: "pix_aguardando" });
  });

  it("freio por endereço de internet antes de ler a cotação: 429 com a mensagem do domínio", async () => {
    const s = await c.segurar();
    const { tentativas } = LIMITES_PAGAMENTO.consulta.origem;
    await db.insert(tentativasLogin).values({ chave: `pagamento-consulta:origem:${c.org}:203.0.113.60`, erros: tentativas, atualizadoEm: minutos(1) });
    const r = await consultar(s.codigo, { origem: "203.0.113.60" });
    expect(r.status).toBe(429);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await r.json()).toEqual({ erro: ERROS_LIMITE.consulta });
    // Outro endereço segue.
    expect((await consultar(s.codigo, { origem: "203.0.113.61" })).status).toBe(200);
  });

  it("cotação aberta (sem pedido) e prazo vencido sem pagamento: 'sem pagamento', que a página trata como final", async () => {
    const s = await c.segurar();
    expect(await (await consultar(s.codigo, { quando: minutos(5) })).json()).toMatchObject({ estado: "pagar" });
    await db.update(cotacoes).set({ holdAte: minutos(1) }).where(eq(cotacoes.id, s.cotacaoId));
    expect(await (await consultar(s.codigo, { quando: minutos(5) })).json()).toMatchObject({ estado: "sem_pagamento", holdAte: null });
  });
});

describe("cartão de crédito na página da cotação (M8.2b)", () => {
  const FORMULARIO = { chavePublica: CHAVE_PUBLICA_FICTICIA, valor: TOTAL, parcelasMaximas: null, emailTeste: "test@testuser.com" };
  const desligarCartao = () => salvarConfigPagamentoSite(db, c.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, cartao: false }, null);

  it("oferecido ao lado do Pix: o formulário (chave pública, valor da cotação, parcelas, e-mail de teste) só com o cookie; nada pessoal", async () => {
    const s = await c.segurar();
    const com = await vista(s.cotacaoId, AGORA, true);
    expect(com).toMatchObject({ estado: "pagar", podeGerar: true, podePagarCartao: true, cartao: FORMULARIO, cartaoRestantes: 3 });
    expect(await vista(s.cotacaoId, AGORA, false)).toMatchObject({ estado: "pagar", podeGerar: true, podePagarCartao: true, cartao: null });
    expect(JSON.stringify(com)).not.toContain(EMAIL_HOSPEDE);
    // Parcelas do painel vão ao formulário.
    await salvarConfigPagamentoSite(db, c.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, cartao: true, parcelasMaximas: 6 }, null);
    expect((await vista(s.cotacaoId, AGORA, true))?.cartao).toEqual({ ...FORMULARIO, parcelasMaximas: 6 });
  });

  it("cartão desligado no painel, sem chave pública ou com o disjuntor aberto: só o Pix (o Pix nunca para por eles)", async () => {
    const s = await c.segurar();
    await desligarCartao();
    expect(await vista(s.cotacaoId, AGORA, true)).toMatchObject({ estado: "pagar", podeGerar: true, podePagarCartao: false, cartao: null });
    await salvarConfigPagamentoSite(db, c.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, cartao: true }, null);
    if (!c.gate.ok) throw new Error("portão");
    expect(await vista(s.cotacaoId, AGORA, true, { ...c.gate, chavePublica: null })).toMatchObject({ podeGerar: true, podePagarCartao: false, cartao: null });
    await db.insert(disjuntoresCartao).values({ organizacaoId: c.org, abertoEm: AGORA, ate: minutos(60), recusas: 8, janela: "30min" });
    expect(await vista(s.cotacaoId, minutos(1), true)).toMatchObject({ estado: "pagar", podeGerar: true, podePagarCartao: false, cartao: null });
  });

  it("Pix aguardando: sem 'Gerar Pix' (seria o mesmo), mas o cartão é outra forma; a rota leva os dois sinais", async () => {
    const s = await c.segurar();
    await c.pix(s.cotacaoId);
    expect(await vista(s.cotacaoId, minutos(1), true)).toMatchObject({ estado: "pix_aguardando", podeGerar: false, podePagarCartao: true, cartao: FORMULARIO });
    const j = await (await consultar(s.codigo, { token: token(s.cotacaoId), quando: minutos(1) })).json();
    expect(j).toMatchObject({ estado: "pix_aguardando", podeGerar: false, podePagarCartao: true, cartao: FORMULARIO });
    expect(await (await consultar(s.codigo, { quando: minutos(1) })).json()).toMatchObject({ podePagarCartao: true, cartao: null });
  });

  it("os 3 Pix gastos: esgotado, mas ainda dá para pagar com cartão", async () => {
    const s = await c.segurar();
    const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
    for (const t of [0, 31, 62]) {
      const r = await gerarPix(db, c.org, s.cotacaoId, minutos(t), c.provedor);
      if (!r.ok) throw new Error(r.erro);
      c.provedor.expirar((await c.tentativa(r.pagamentoId)).idProvedor!);
      await conferir(r.pagamentoId, minutos(t + 30.5));
    }
    expect(await vista(s.cotacaoId, minutos(93), true)).toMatchObject({ estado: "pix_esgotado", podeGerar: false, podePagarCartao: true, cartao: FORMULARIO });
  });

  it("desafio do banco: o endereço só com o cookie; o Pix e outro cartão continuam oferecidos (o domínio cancela o desafio antes)", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "desafio";
    const { resultado } = await c.cartao(s.cotacaoId);
    expect(resultado).toMatchObject({ ok: true, situacao: "desafio" });
    const com = await vista(s.cotacaoId, minutos(1), true);
    expect(com).toMatchObject({ estado: "cartao_desafio", forma: "cartao", podeGerar: true, podePagarCartao: true, cartaoRestantes: 2 });
    expect(com?.desafioUrl).toMatch(/^https:\/\/www\.mercadopago\.com\.br\//);
    expect(await vista(s.cotacaoId, minutos(1), false)).toMatchObject({ estado: "cartao_desafio", desafioUrl: null, cartao: null });
  });

  it("cartão em análise: nada de outro jeito (nem Pix nem cartão), o prazo das datas vai para a linha fixa, e a página acompanha", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "em_analise";
    await c.cartao(s.cotacaoId);
    const v = await vista(s.cotacaoId, minutos(2), true);
    expect(v).toMatchObject({ estado: "cartao_em_analise", podeGerar: false, podePagarCartao: false, cartao: null, forma: "cartao" });
    expect(v?.prazoDasDatas).toBe((await c.cotacao(s.cotacaoId)).holdAte!.toISOString());
  });

  it("cartão recusado: o mesmo texto para todo motivo (o motivo nunca chega); esgotadas as 3 tentativas, só o Pix", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "recusado";
    await c.cartao(s.cotacaoId);
    const v = await vista(s.cotacaoId, minutos(1), true);
    expect(v).toMatchObject({ estado: "cartao_recusado", recusa: "cartao", podeGerar: true, podePagarCartao: true, cartaoRestantes: 2 });
    expect(JSON.stringify(v)).not.toContain("rejected_by_issuer");
    await c.cartao(s.cotacaoId, {}, minutos(2));
    await c.cartao(s.cotacaoId, {}, minutos(3));
    expect(await vista(s.cotacaoId, minutos(4), true)).toMatchObject({ estado: "cartao_recusado", cartaoRestantes: 0, podeGerar: true, podePagarCartao: false, cartao: null });
  });

  it("cartão marcado como real (live_mode) no teste: nenhuma oferta, de nenhuma forma", async () => {
    const s = await c.segurar();
    c.provedor.aoVivo = true;
    expect((await c.cartao(s.cotacaoId)).resultado).toMatchObject({ ok: false, codigo: "ao_vivo" });
    expect(await vista(s.cotacaoId, minutos(1), true)).toMatchObject({ podeGerar: false, podePagarCartao: false, cartao: null });
  });

  it("textos de antes de segurar: o cartão ligado só com as travas, a chave pública, a chave do painel e o disjuntor fechado", async () => {
    expect(await cartaoNoSite(db, c.org, c.gate, AGORA)).toBe(true);
    expect(await cartaoNoSite(db, c.org, desligado, AGORA)).toBe(false);
    if (!c.gate.ok) throw new Error("portão");
    expect(await cartaoNoSite(db, c.org, { ...c.gate, chavePublica: null }, AGORA)).toBe(false);
    await db.insert(disjuntoresCartao).values({ organizacaoId: c.org, abertoEm: AGORA, ate: null, recusas: 20, janela: "24h", reincidente: true });
    expect(await cartaoNoSite(db, c.org, c.gate, minutos(1))).toBe(false);
    await db.delete(disjuntoresCartao);
    await desligarCartao();
    expect(await cartaoNoSite(db, c.org, c.gate, AGORA)).toBe(false);
  });

  it("mensagens ao hóspede: uma para cada falha do cartão; toda recusa com o mesmo texto; nada de painel, Beds24 ou texto do provedor", () => {
    const codigos: CodigoFalhaCartao[] = [
      "nao_encontrada", "nao_oferecido", "indisponivel", "em_andamento", "em_analise", "ja_pago", "limite", "limite_geral", "parcelas", "so_credito",
      "dados_cartao", "recusado", "verificacao", "provedor", "incerto", "ocupado", "ao_vivo", "aceite_pendente", "aceite_mudou", "prazo",
    ];
    expect(Object.keys(MENSAGENS_CARTAO_HOSPEDE).sort()).toEqual([...codigos].sort());
    for (const m of Object.values(MENSAGENS_CARTAO_HOSPEDE)) expect(m).not.toMatch(/Configurações|painel|Beds24|contrato|proprietário|disjuntor|recusas|rejected|high_risk/i);
    expect(MENSAGENS_CARTAO_HOSPEDE.recusado).toBe("Não foi possível aprovar o pagamento com este cartão. Confira os dados, use outro cartão ou pague com Pix.");
    expect(MENSAGENS_CARTAO_HOSPEDE.limite_geral).toBe("Muitas tentativas com cartão agora há pouco. Pague com Pix ou fale com a equipe pelo WhatsApp.");
    expect(MENSAGENS_CARTAO_HOSPEDE.incerto).toContain("Não pague de novo");
  });
});
