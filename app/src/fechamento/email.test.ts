import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { appSettings, execucoesAutomacao, imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { registrarDespesa } from "@/despesas/despesas";
import { type Correio, CorreioMemoria, ErroEnvioIncerto, type Mensagem } from "@/email/correio";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { fecharMes } from "@/repasses/repasses";
import { fechamentoDeTodas, fechamentoManual } from "./cron";
import { chaveDoEnvio, enviarFechamentos, lerConfigFechamentoEmail, salvarConfigFechamentoEmail, situacaoDosFechamentos } from "./email";

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
    expect(marca.value).toEqual({ estado: "enviado", em: DIA1.toISOString() });
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
});
