import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { appSettings, auditoria, execucoesAutomacao, lancamentos, imoveis, organizacoes, proprietarioImoveis, proprietarios, representantes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { registrarDespesa } from "@/despesas/despesas";
import { type Correio, CorreioMemoria, ErroEnvioIncerto, type Mensagem } from "@/email/correio";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { estornarRepasse, fecharMes, listarRepasses } from "@/repasses/repasses";
import { fechamentoDeTodas, fechamentoManual } from "./cron";
import { chaveDoEnvio, chaveDoReenvio, enviarFechamentos, enviarFechamentosAutomaticos, lerConfigFechamentoEmail, salvarConfigFechamentoEmail, situacaoDosFechamentos } from "./email";

let db: Db;
let close: () => Promise<void>;
let org: string;
let a: string;
let b: string;
let dona: string;
let outro: string;
const MES = "2026-10";
const DIA1 = new Date("2026-11-01T12:00:00Z");

const reserva = (imovelId: string, checkin: string, checkout: string): DadosReserva => ({
  imovelId,
  origem: "booking",
  estado: "confirmada",
  checkin,
  checkout,
  hospedes: 2,
  hospedeNome: "Hóspede Fictício",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 100000,
  taxaCanal: 15000,
  valorLiquido: null,
  codigoCanal: "",
  observacoes: "",
});

const ligar = () => salvarConfigFechamentoEmail(db, org, { ativo: true, assunto: "Fechamento de {mes}", texto: "Olá, {nome}. Segue o relatório de {mes}." }, null);
const fechar = (dono = dona) => fecharMes(db, org, dono, MES, "2026-11-01", null);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: a }, { id: b }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro" },
      { organizacaoId: org, codigo: "102", nome: "Um" },
    ])
    .returning();
  [{ id: dona }, { id: outro }] = await db
    .insert(proprietarios)
    .values([
      { organizacaoId: org, nome: "Dona Exemplo", email: "dona@example.com" },
      { organizacaoId: org, nome: "Outro Exemplo", email: "" },
    ])
    .returning();
  await db.insert(proprietarioImoveis).values([
    { proprietarioId: dona, imovelId: a },
    { proprietarioId: outro, imovelId: b },
  ]);
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  await criarContrato(db, org, b, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  await criarReserva(db, org, reserva(a, "2026-10-05", "2026-10-10"), null);
  await criarReserva(db, org, reserva(b, "2026-10-05", "2026-10-10"), null);
});
afterEach(() => close());

describe("e-mail do fechamento (M5.4)", () => {
  it("desligado não envia sozinho; o botão do painel envia mesmo assim", async () => {
    await fechar();
    const correio = new CorreioMemoria();
    expect(await enviarFechamentos(db, org, correio, DIA1)).toMatchObject({ aviso: "envio do fechamento desligado", enviados: 0 });
    expect(await fechamentoManual(db, org, correio, DIA1, { mes: MES, proprietarioId: dona }, null)).toMatchObject({ enviados: 1 });
    expect(correio.enviadas).toHaveLength(1);
  });

  it("depois de fechado, envia uma vez o PDF do mês, com o texto do painel e o valor do repasse", async () => {
    await ligar();
    await fechar();
    const correio = new CorreioMemoria();
    const r = await enviarFechamentos(db, org, correio, DIA1);
    // O outro proprietário ainda não fechou o mês (e não tem e-mail): fica de fora, com o nome.
    expect(r).toMatchObject({ mes: MES, enviados: 1, pendentes: ["Outro Exemplo"], falhas: [] });
    await fechar(outro);
    expect(await enviarFechamentos(db, org, new CorreioMemoria(), DIA1)).toMatchObject({ enviados: 0, jaEnviados: 1, semEmail: ["Outro Exemplo"] });
    const m = correio.enviadas[0];
    expect(m).toMatchObject({ para: "dona@example.com", assunto: "Fechamento de outubro de 2026", chave: chaveDoEnvio(org, dona, MES) });
    expect(m.texto).toContain("Olá, Dona Exemplo. Segue o relatório de outubro de 2026.");
    expect(m.texto).toContain("Repasse do mês: R$");
    expect(m.anexos).toHaveLength(1);
    expect(m.anexos![0].nome).toBe("relatorio-2026-10-403.pdf");
    expect(Buffer.from(m.anexos![0].conteudo).subarray(0, 5).toString()).toBe("%PDF-");
    // No dia seguinte: já enviado, nada sai de novo; o PDF não fica guardado.
    expect(await enviarFechamentos(db, org, correio, new Date("2026-11-02T12:00:00Z"))).toMatchObject({ enviados: 0, jaEnviados: 1 });
    expect(correio.enviadas).toHaveLength(1);
    const [marca] = await db.select().from(appSettings).where(eq(appSettings.key, chaveDoEnvio(org, dona, MES)));
    expect(marca.value).toEqual({ estado: "enviado", em: DIA1.toISOString(), destinos: ["dona@example.com"] });
  });

  it("mês ainda não fechado não sai: avisa quem ficou; sai quando fechar", async () => {
    await ligar();
    const correio = new CorreioMemoria();
    expect(await enviarFechamentos(db, org, correio, DIA1)).toMatchObject({ enviados: 0, pendentes: ["Dona Exemplo", "Outro Exemplo"] });
    expect(correio.enviadas).toHaveLength(0);
    await fechar();
    expect(await enviarFechamentos(db, org, correio, new Date("2026-11-03T12:00:00Z"))).toMatchObject({ enviados: 1 });
  });

  it("nada a repassar e sem pendência: o mês está fechado e o e-mail diz que o proprietário deve", async () => {
    await ligar();
    const c = await criarCategoria(db, org, "Manutenção", null);
    if (!c.ok) throw new Error("categoria");
    await registrarDespesa(
      db,
      org,
      { responsavel: "proprietario", pagoPor: "empresa", categoriaId: c.categoria.id, descricao: "Reparo", valor: 500000, data: "2026-10-05", imovelId: a, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-06" },
      null,
    );
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-01")).filter((x) => x.proprietarioId === dona);
    expect(p.situacao).toBe("pronto");
    const correio = new CorreioMemoria();
    await enviarFechamentos(db, org, correio, DIA1);
    expect(correio.enviadas[0].texto).toContain("você deve R$");
  });

  it("provedor recusou: a marca sai e a próxima execução tenta de novo", async () => {
    await ligar();
    await fechar();
    const recusa: Correio = { nome: "recusa", enviar: async () => Promise.reject(new Error("Falha ao enviar e-mail (HTTP 422).")) };
    expect(await enviarFechamentos(db, org, recusa, DIA1)).toMatchObject({ enviados: 0, falhas: [expect.stringContaining("HTTP 422")] });
    const correio = new CorreioMemoria();
    expect(await enviarFechamentos(db, org, correio, new Date(DIA1.getTime() + 60_000))).toMatchObject({ enviados: 1 });
  });

  it("envio incerto: espera 15 minutos e repete exatamente o mesmo pedido, com a mesma chave", async () => {
    await ligar();
    await fechar();
    const pedidos: Mensagem[] = [];
    const caiu: Correio = {
      nome: "caiu",
      enviar: async (m) => {
        pedidos.push(m);
        throw new ErroEnvioIncerto("Sem resposta do provedor de e-mail");
      },
    };
    expect(await enviarFechamentos(db, org, caiu, DIA1)).toMatchObject({ falhas: [expect.stringContaining("envio incerto")] });
    // O texto muda no painel depois da tentativa: a retomada manda o pedido original.
    await salvarConfigFechamentoEmail(db, org, { ativo: true, assunto: "Outro assunto", texto: "Outro texto" }, null);
    const correio = new CorreioMemoria();
    expect(await enviarFechamentos(db, org, correio, new Date(DIA1.getTime() + 5 * 60_000))).toMatchObject({ enviados: 0, falhas: [expect.stringContaining("ainda não foi confirmado")] });
    expect(await enviarFechamentos(db, org, correio, new Date(DIA1.getTime() + 20 * 60_000))).toMatchObject({ enviados: 1 });
    expect(correio.enviadas[0]).toMatchObject({ assunto: pedidos[0].assunto, texto: pedidos[0].texto, chave: pedidos[0].chave });
    expect(Buffer.from(correio.enviadas[0].anexos![0].conteudo)).toEqual(Buffer.from(pedidos[0].anexos![0].conteudo));
  });

  it("enviar de novo pelo painel: outra chave, a marca do mês continua enviada", async () => {
    await ligar();
    await fechar();
    const correio = new CorreioMemoria();
    await enviarFechamentos(db, org, correio, DIA1);
    const depois = new Date(DIA1.getTime() + 3_600_000);
    expect(await fechamentoManual(db, org, correio, depois, { mes: MES, proprietarioId: dona, reenviar: true }, null)).toMatchObject({ enviados: 1 });
    expect(correio.enviadas).toHaveLength(2);
    expect(correio.enviadas[1].chave).not.toBe(correio.enviadas[0].chave);
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-01")).filter((x) => x.proprietarioId === dona);
    expect(p).toMatchObject({ situacao: "enviado", enviadoEm: depois.toISOString() });
  });

  it("texto do painel: só {nome} e {mes}; vazio volta ao padrão", async () => {
    expect(await salvarConfigFechamentoEmail(db, org, { ativo: true, assunto: "Fechamento {mes}", texto: "Pix {chave}" }, null)).toEqual({
      ok: false,
      erro: "Campo desconhecido: {chave}. Use {nome} e {mes}.",
    });
    expect(await salvarConfigFechamentoEmail(db, org, { ativo: true, assunto: " ", texto: "x" }, null)).toMatchObject({ ok: false });
    expect(await lerConfigFechamentoEmail(db, org)).toMatchObject({ ativo: false, assunto: "Fechamento de {mes} — Sua Casa Leblon" });
  });

  it("agendador: ligado e sem provedor fica registrado como falha na página Sistema", async () => {
    await ligar();
    await expect(fechamentoDeTodas(db, null, DIA1)).rejects.toThrow("sem provedor");
    const [e] = await db.select().from(execucoesAutomacao);
    expect(e).toMatchObject({ nome: "fechamento-email" });
  });

  it("proprietário com imóvel e saldo zero no mês também recebe o relatório", async () => {
    await ligar();
    const [{ id: c }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "303", nome: "Três" }).returning();
    const [{ id: terceiro }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Terceira Exemplo", email: "terceira@example.com" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: terceiro, imovelId: c });
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-01")).filter((x) => x.proprietarioId === terceiro);
    expect(p.situacao).toBe("pronto");
    const correio = new CorreioMemoria();
    await enviarFechamentos(db, org, correio, DIA1, { proprietarioId: terceiro });
    expect(correio.enviadas[0]).toMatchObject({ para: "terceira@example.com" });
    expect(correio.enviadas[0].texto).toContain("Não há valor a repassar neste mês.");
  });

  it("representantes que recebem os relatórios vão em cópia; os outros não", async () => {
    await ligar();
    await fechar();
    await db.insert(representantes).values([
      { proprietarioId: dona, nome: "Rep Fictício", email: "rep@example.com", recebeRelatorios: true },
      { proprietarioId: dona, nome: "Outro Rep", email: "nao@example.com", recebeRelatorios: false },
    ]);
    const correio = new CorreioMemoria();
    await enviarFechamentos(db, org, correio, DIA1);
    expect(correio.enviadas[0]).toMatchObject({ para: "dona@example.com", copias: ["rep@example.com"] });
  });

  it("retomada de envio incerto vai para os mesmos endereços, mesmo se o cadastro mudou", async () => {
    await ligar();
    await fechar();
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarFechamentos(db, org, caiu, DIA1);
    await db.update(proprietarios).set({ email: "novo@example.com" }).where(eq(proprietarios.id, dona));
    const correio = new CorreioMemoria();
    expect(await enviarFechamentos(db, org, correio, new Date(DIA1.getTime() + 20 * 60_000))).toMatchObject({ enviados: 1 });
    expect(correio.enviadas[0].para).toBe("dona@example.com");
  });

  it("proprietário ligado ao imóvel só depois do mês, com saldo zero: fica fora do e-mail daquele mês", async () => {
    await ligar();
    const [{ id: c }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "303", nome: "Três" }).returning();
    const [{ id: novo }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Nova Exemplo", email: "nova@example.com" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: novo, imovelId: c, criadoEm: new Date("2026-11-15T12:00:00Z") });
    expect((await situacaoDosFechamentos(db, org, MES, "2026-11-20")).some((x) => x.proprietarioId === novo)).toBe(false);
  });

  it("mês reaberto (repasse estornado) depois do envio: não reenvia até fechar de novo", async () => {
    await ligar();
    await fechar();
    const correio = new CorreioMemoria();
    await enviarFechamentos(db, org, correio, DIA1);
    const [rep] = await listarRepasses(db, org, dona);
    expect((await estornarRepasse(db, org, rep.id, "refazer", "2026-11-02", null)).ok).toBe(true);
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-02")).filter((x) => x.proprietarioId === dona);
    expect(p.situacao).toBe("pendente");
    expect(await fechamentoManual(db, org, correio, new Date("2026-11-02T12:00:00Z"), { mes: MES, proprietarioId: dona, reenviar: true }, null)).toMatchObject({ enviados: 0, pendentes: ["Dona Exemplo"] });
    expect(correio.enviadas).toHaveLength(1);
    // Fechado de novo: "enviar de novo" manda.
    await fecharMes(db, org, dona, MES, "2026-11-02", null);
    expect(await fechamentoManual(db, org, correio, new Date("2026-11-02T13:00:00Z"), { mes: MES, proprietarioId: dona, reenviar: true }, null)).toMatchObject({ enviados: 1 });
  });

  it("reenvio incerto: o clique seguinte retoma o mesmo pedido, com a mesma chave", async () => {
    await ligar();
    await fechar();
    await enviarFechamentos(db, org, new CorreioMemoria(), DIA1);
    const pedidos: Mensagem[] = [];
    const caiu: Correio = {
      nome: "caiu",
      enviar: async (m) => {
        pedidos.push(m);
        throw new ErroEnvioIncerto("Sem resposta do provedor de e-mail");
      },
    };
    const t1 = new Date(DIA1.getTime() + 3_600_000);
    await fechamentoManual(db, org, caiu, t1, { mes: MES, proprietarioId: dona, reenviar: true }, null);
    const correio = new CorreioMemoria();
    // Antes de 15 minutos: espera; depois: o mesmo pedido.
    expect(await fechamentoManual(db, org, correio, new Date(t1.getTime() + 5 * 60_000), { mes: MES, proprietarioId: dona, reenviar: true }, null)).toMatchObject({ enviados: 0 });
    expect(await fechamentoManual(db, org, correio, new Date(t1.getTime() + 20 * 60_000), { mes: MES, proprietarioId: dona, reenviar: true }, null)).toMatchObject({ enviados: 1 });
    expect(correio.enviadas[0].chave).toBe(pedidos[0].chave);
  });

  it("a tela mostra para quem o e-mail foi, como gravado no envio", async () => {
    await ligar();
    await fechar();
    await enviarFechamentos(db, org, new CorreioMemoria(), DIA1);
    await db.update(proprietarios).set({ email: "trocado@example.com" }).where(eq(proprietarios.id, dona));
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-02")).filter((x) => x.proprietarioId === dona);
    expect(p).toMatchObject({ situacao: "enviado", enviadoPara: ["dona@example.com"], destinos: ["trocado@example.com"] });
  });

  it("sem confirmação por mais de um dia (fora da janela da chave do provedor): não repete sozinho; o painel decide", async () => {
    await ligar();
    await fechar();
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarFechamentos(db, org, caiu, DIA1);
    const correio = new CorreioMemoria();
    const depois = new Date(DIA1.getTime() + 25 * 3_600_000);
    expect(await enviarFechamentos(db, org, correio, depois)).toMatchObject({ enviados: 0, incertos: ["Dona Exemplo"], falhas: [] });
    expect(correio.enviadas).toHaveLength(0);
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-02")).filter((x) => x.proprietarioId === dona);
    expect(p.situacao).toBe("incerto");
    // Nos dias seguintes continua sem repetir.
    expect(await enviarFechamentos(db, org, correio, new Date(depois.getTime() + 86_400_000))).toMatchObject({ enviados: 0, incertos: ["Dona Exemplo"] });
    // "Enviar de novo" no painel: outra chave.
    expect(await fechamentoManual(db, org, correio, depois, { mes: MES, proprietarioId: dona, reenviar: true }, null)).toMatchObject({ enviados: 1 });
    expect(correio.enviadas[0].chave).not.toBe(chaveDoEnvio(org, dona, MES));
    const [q] = (await situacaoDosFechamentos(db, org, MES, "2026-11-02")).filter((x) => x.proprietarioId === dona);
    expect(q.situacao).toBe("enviado");
  });

  it("automático: mês fechado com atraso ainda sai, mas nada de antes de o envio ser ligado", async () => {
    // Ligado em 01/11: cobre de outubro em diante.
    await salvarConfigFechamentoEmail(db, org, { ativo: true, assunto: "Fechamento de {mes}", texto: "Olá, {nome}." }, null, DIA1);
    expect((await lerConfigFechamentoEmail(db, org)).ativoDesde).toBe("2026-10");
    // Outubro só é fechado em 05/12, quando o mês a fechar já é novembro.
    await fecharMes(db, org, dona, MES, "2026-12-05", null);
    const correio = new CorreioMemoria();
    const rs = await enviarFechamentosAutomaticos(db, org, correio, new Date("2026-12-05T12:00:00Z"));
    expect(rs.map((r) => r.mes)).toContain("2026-10");
    expect(correio.enviadas.some((m) => m.para === "dona@example.com" && m.assunto === "Fechamento de outubro de 2026")).toBe(true);
    expect(correio.enviadas.some((m) => m.assunto.includes("setembro"))).toBe(false);
  });

  it("dois cliques de \"enviar de novo\" ao mesmo tempo: uma chave só, um e-mail só", async () => {
    await ligar();
    await fechar();
    await enviarFechamentos(db, org, new CorreioMemoria(), DIA1);
    const enviadas: Mensagem[] = [];
    const lento: Correio = {
      nome: "lento",
      enviar: async (m) => {
        await new Promise((ok) => setTimeout(ok, 50));
        enviadas.push(m);
      },
    };
    const [a, b] = await Promise.all([
      fechamentoManual(db, org, lento, new Date(DIA1.getTime() + 3_600_000), { mes: MES, proprietarioId: dona, reenviar: true }, null),
      fechamentoManual(db, org, lento, new Date(DIA1.getTime() + 3_600_001), { mes: MES, proprietarioId: dona, reenviar: true }, null),
    ]);
    expect(a.enviados + b.enviados).toBe(1);
    expect(enviadas).toHaveLength(1);
  });

  it("retomadas dentro de cada 23h não esticam a janela: conta desde o primeiro pedido", async () => {
    await ligar();
    await fechar();
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarFechamentos(db, org, caiu, DIA1);
    await enviarFechamentos(db, org, caiu, new Date(DIA1.getTime() + 20 * 3_600_000));
    const correio = new CorreioMemoria();
    expect(await enviarFechamentos(db, org, correio, new Date(DIA1.getTime() + 40 * 3_600_000))).toMatchObject({ enviados: 0, incertos: ["Dona Exemplo"] });
    expect(correio.enviadas).toHaveLength(0);
  });

  it("\"enviar de novo\" sem confirmação aparece na situação do mês", async () => {
    await ligar();
    await fechar();
    await enviarFechamentos(db, org, new CorreioMemoria(), DIA1);
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    const t1 = new Date(DIA1.getTime() + 3_600_000);
    await fechamentoManual(db, org, caiu, t1, { mes: MES, proprietarioId: dona, reenviar: true }, null);
    const situacao = async () => (await situacaoDosFechamentos(db, org, MES, "2026-11-02")).find((x) => x.proprietarioId === dona)!;
    expect(await situacao()).toMatchObject({ situacao: "enviado", reenvioPendente: { estado: "enviando" } });
    // Mais de um dia depois, sem ninguém clicar: a tela já mostra "incerto".
    const depois = new Date(t1.getTime() + 25 * 3_600_000);
    const [q] = (await situacaoDosFechamentos(db, org, MES, "2026-11-03", depois)).filter((x) => x.proprietarioId === dona);
    expect(q.reenvioPendente).toMatchObject({ estado: "incerto", destinos: ["dona@example.com"] });
    // E o próximo clique já manda (com outra chave), sem um clique perdido só para marcar.
    const correio = new CorreioMemoria();
    expect(await fechamentoManual(db, org, correio, depois, { mes: MES, proprietarioId: dona, reenviar: true }, null)).toMatchObject({ enviados: 1 });
  });

  it("reenvio concluído sem a marca do mês atualizada (queda no meio): o próximo abre outra chave", async () => {
    await ligar();
    await fechar();
    await enviarFechamentos(db, org, new CorreioMemoria(), DIA1);
    // Como se o reenvio tivesse terminado e a marca do mês ainda apontasse para ele.
    const base = chaveDoEnvio(org, dona, MES);
    const velha = `${base}:reenvio:1`;
    await db.insert(appSettings).values({ key: velha, value: { estado: "enviado", em: DIA1.toISOString() } });
    await db.update(appSettings).set({ value: { estado: "enviado", em: DIA1.toISOString(), destinos: ["dona@example.com"], reenvio: velha } }).where(eq(appSettings.key, base));
    const correio = new CorreioMemoria();
    expect(await fechamentoManual(db, org, correio, new Date(DIA1.getTime() + 3_600_000), { mes: MES, proprietarioId: dona, reenviar: true }, null)).toMatchObject({ enviados: 1 });
    expect(correio.enviadas[0].chave).not.toBe(velha);
  });

  it("tentativa sem confirmação dentro da janela: fica \"aguardando\", com os destinos do pedido guardado", async () => {
    await ligar();
    await fechar();
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarFechamentos(db, org, caiu, DIA1);
    await db.update(proprietarios).set({ email: "novo@example.com" }).where(eq(proprietarios.id, dona));
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-01", new Date(DIA1.getTime() + 60_000))).filter((x) => x.proprietarioId === dona);
    expect(p).toMatchObject({ situacao: "aguardando", destinos: ["dona@example.com"] });
  });

  it("mês sem nada a repassar e não enviado continua fechado depois do repasse de um mês seguinte", async () => {
    await ligar();
    const [{ id: c }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "303", nome: "Três" }).returning();
    const [{ id: terceira }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Terceira Exemplo", email: "" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: terceira, imovelId: c });
    await criarContrato(db, org, c, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await criarReserva(db, org, reserva(c, "2026-11-05", "2026-11-10"), null);
    // Outubro: saldo zero, sem e-mail cadastrado (não sai). Novembro é pago.
    expect(await fecharMes(db, org, terceira, "2026-11", "2026-12-01", null)).toMatchObject({ ok: true });
    await db.update(proprietarios).set({ email: "terceira@example.com" }).where(eq(proprietarios.id, terceira));
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-12-02")).filter((x) => x.proprietarioId === terceira);
    expect(p.situacao).toBe("pronto");
  });

  it("\"enviar de novo\": a chave nova só é publicada já com a marca dela (outro clique no meio usa a mesma)", async () => {
    await ligar();
    await fechar();
    await enviarFechamentos(db, org, new CorreioMemoria(), DIA1);
    const base = chaveDoEnvio(org, dona, MES);
    const depois = new Date(DIA1.getTime() + 3_600_000);
    const primeira = await chaveDoReenvio(db, base, depois);
    expect(primeira.tentativa).toEqual(expect.any(String));
    const [marca] = await db.select().from(appSettings).where(eq(appSettings.key, primeira.chave));
    expect(marca?.value).toMatchObject({ estado: "enviando", tentativa: primeira.tentativa });
    // Um segundo pedido logo em seguida (antes do envio do primeiro) fica com a mesma chave, sem reserva.
    expect(await chaveDoReenvio(db, base, new Date(depois.getTime() + 1))).toEqual({ chave: primeira.chave, tentativa: null });
  });

  it("\"enviar de novo\" sem confirmação: a tela e a retomada usam os destinos do pedido guardado", async () => {
    await ligar();
    await fechar();
    await enviarFechamentos(db, org, new CorreioMemoria(), DIA1);
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    const t1 = new Date(DIA1.getTime() + 3_600_000);
    await fechamentoManual(db, org, caiu, t1, { mes: MES, proprietarioId: dona, reenviar: true }, null);
    // O cadastro perde o e-mail: o reenvio em aberto continua visível, com os destinos guardados.
    await db.update(proprietarios).set({ email: "" }).where(eq(proprietarios.id, dona));
    const t2 = new Date(t1.getTime() + 20 * 60_000);
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-02", t2)).filter((x) => x.proprietarioId === dona);
    expect(p).toMatchObject({ situacao: "enviado", destinos: ["dona@example.com"], reenvioPendente: { estado: "enviando", destinos: ["dona@example.com"] } });
    const correio = new CorreioMemoria();
    expect(await fechamentoManual(db, org, correio, t2, { mes: MES, proprietarioId: dona, reenviar: true }, null)).toMatchObject({ enviados: 1 });
    expect(correio.enviadas[0].para).toBe("dona@example.com");
  });

  it("envio incerto e mês reaberto e fechado de novo: o pedido antigo (PDF de antes) não é retomado", async () => {
    await ligar();
    await fechar();
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarFechamentos(db, org, caiu, DIA1);
    const [rep] = await listarRepasses(db, org, dona);
    expect((await estornarRepasse(db, org, rep.id, "refazer", "2026-11-01", null)).ok).toBe(true);
    await fecharMes(db, org, dona, MES, "2026-11-01", null);
    const t = new Date(DIA1.getTime() + 30 * 60_000);
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-01", t)).filter((x) => x.proprietarioId === dona);
    expect(p.situacao).toBe("incerto");
    // O automático não repete o pedido velho; o "enviar de novo" gera o relatório de agora, com outra chave.
    const correio = new CorreioMemoria();
    expect(await enviarFechamentos(db, org, correio, t)).toMatchObject({ enviados: 0, incertos: ["Dona Exemplo"] });
    expect(await fechamentoManual(db, org, correio, t, { mes: MES, proprietarioId: dona, reenviar: true }, null)).toMatchObject({ enviados: 1 });
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0].chave).not.toBe(chaveDoEnvio(org, dona, MES));
  });

  it("reenvio concluído não apaga o ponteiro de um reenvio mais novo", async () => {
    await ligar();
    await fechar();
    await enviarFechamentos(db, org, new CorreioMemoria(), DIA1);
    const base = chaveDoEnvio(org, dona, MES);
    const outra = `${base}:reenvio:outro`;
    // Enquanto o reenvio A está no provedor, outro pedido (B) troca o ponteiro.
    const troca: Correio = {
      nome: "troca",
      enviar: async () => {
        await db.insert(appSettings).values({ key: outra, value: { estado: "enviando", em: DIA1.toISOString() } });
        const [b] = await db.select().from(appSettings).where(eq(appSettings.key, base));
        await db.update(appSettings).set({ value: { ...(b.value as object), reenvio: outra } }).where(eq(appSettings.key, base));
      },
    };
    await fechamentoManual(db, org, troca, new Date(DIA1.getTime() + 3_600_000), { mes: MES, proprietarioId: dona, reenviar: true }, null);
    const [b] = await db.select().from(appSettings).where(eq(appSettings.key, base));
    expect(b.value).toMatchObject({ reenvio: outra });
  });

  it("sem confirmação há mais de um dia: a tela mostra para onde a tentativa foi, separado do cadastro de hoje", async () => {
    await ligar();
    await fechar();
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarFechamentos(db, org, caiu, DIA1);
    await db.update(proprietarios).set({ email: "novo@example.com" }).where(eq(proprietarios.id, dona));
    const depois = new Date(DIA1.getTime() + 25 * 3_600_000);
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-02", depois)).filter((x) => x.proprietarioId === dona);
    expect(p).toMatchObject({ situacao: "incerto", destinos: ["novo@example.com"], destinosTentados: ["dona@example.com"] });
  });

  it("botão de um proprietário que não enviou nada fica como falha no histórico", async () => {
    await ligar();
    expect(await fechamentoManual(db, org, new CorreioMemoria(), DIA1, { mes: MES, proprietarioId: dona }, null)).toMatchObject({ enviados: 0, pendentes: ["Dona Exemplo"] });
    const [a] = await db.select().from(auditoria).where(eq(auditoria.acao, "fechamento.email_manual"));
    expect(JSON.stringify(a.mudancas)).toContain("falhou");
  });

  it("queda antes de chamar o provedor (reservado, sem envio): no dia seguinte envia, não vira \"incerto\"", async () => {
    await ligar();
    await fechar();
    // Como o reservar grava: tentativa em andamento, ainda sem hora de envio ao provedor.
    await db.insert(appSettings).values({ key: chaveDoEnvio(org, dona, MES), value: { estado: "enviando", em: DIA1.toISOString(), tentativa: "t-caiu" } });
    const correio = new CorreioMemoria();
    const r = await enviarFechamentos(db, org, correio, new Date(DIA1.getTime() + 24 * 3_600_000));
    expect(r).toMatchObject({ incertos: [] });
    expect(correio.enviadas.filter((m) => m.para === "dona@example.com")).toHaveLength(1);
  });

  it("proprietário sem imóvel nem lançamento no mês, mas com saldo: avisa \"sem relatório\" e não vira falha diária", async () => {
    await ligar();
    const [{ id: antiga }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Antiga Exemplo", email: "antiga@example.com" }).returning();
    // Dívida de setembro direto no proprietário (sem imóvel); em outubro não há nada dela.
    await db.insert(lancamentos).values({ organizacaoId: org, proprietarioId: antiga, tipo: "ajuste", descricao: "Acerto fictício", valor: 0, efeitoSaldo: -10000, competencia: "2026-09-05", estado: "realizado" });
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-01")).filter((x) => x.proprietarioId === antiga);
    expect(p?.situacao).toBe("sem_relatorio");
    const correio = new CorreioMemoria();
    const r = await enviarFechamentos(db, org, correio, DIA1);
    expect(r.falhas).toEqual([]);
    expect(r.semRelatorio).toEqual(["Antiga Exemplo"]);
    expect(correio.enviadas.filter((m) => m.para === "antiga@example.com")).toHaveLength(0);
  });

  it("pedido guardado que nunca chegou ao provedor (sem \"primeira\"): a retomada monta de novo, com o cadastro de hoje", async () => {
    await ligar();
    await fechar();
    const velha = { destinos: ["antigo@example.com"], assunto: "velho", texto: "velho", arquivo: "velho.pdf", pdf: Buffer.from("x").toString("base64") };
    await db.insert(appSettings).values({ key: chaveDoEnvio(org, dona, MES), value: { estado: "enviando", em: DIA1.toISOString(), tentativa: "t-caiu", carga: velha } });
    const correio = new CorreioMemoria();
    await enviarFechamentos(db, org, correio, new Date(DIA1.getTime() + 30 * 60_000));
    const dela = correio.enviadas.filter((m) => m.chave === chaveDoEnvio(org, dona, MES));
    expect(dela).toHaveLength(1);
    expect(dela[0]).toMatchObject({ para: "dona@example.com" });
    expect(dela[0].assunto).not.toBe("velho");
  });

  it("mês sem repasse corrigido depois de uma tentativa incerta: o pedido antigo não é retomado", async () => {
    await ligar();
    const c = await criarCategoria(db, org, "Manutenção", null);
    if (!c.ok) throw new Error("categoria");
    const despesa = (valor: number, dia: string) =>
      registrarDespesa(
        db,
        org,
        { responsavel: "proprietario", pagoPor: "empresa", categoriaId: c.categoria.id, descricao: "Reparo", valor, data: dia, imovelId: a, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: dia },
        null,
      );
    await despesa(500000, "2026-10-05");
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarFechamentos(db, org, caiu, DIA1, { proprietarioId: dona });
    // Correção no mês (outra despesa): o PDF guardado ficou velho.
    await despesa(10000, "2026-10-06");
    const t = new Date(DIA1.getTime() + 30 * 60_000);
    const [p] = (await situacaoDosFechamentos(db, org, MES, "2026-11-01", t)).filter((x) => x.proprietarioId === dona);
    expect(p.situacao).toBe("incerto");
  });
});
