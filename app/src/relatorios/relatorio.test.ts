import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { criarContrato } from "@/contratos/repositorio";
import { auditoria, imoveis, organizacoes, proprietarioImoveis, proprietarios, proprietarioUsuarios, representantes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { resumoDoProprietario } from "@/portal/resumo";
import type { Rodape } from "@/portal/rodape";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { relatorioDoPainel, relatorioDoPortal } from "./gerar";
import { conferirAnexos, ErroRelatorio, gerarPdfRelatorio, lerPaginas } from "./pdf";
import { type DadosRelatorio, dadosDoRelatorio, textoDoSaldo, textosDoRelatorio } from "./relatorio";

// PNG 1×1 (fictício, só para o teste).
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

async function pdfCom(paginas: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) d.addPage([300, 400]);
  return d.save();
}
const paginasDe = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount();

const reserva = (imovelId: string, over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId,
  origem: "booking",
  estado: "confirmada",
  checkin: "2026-10-10",
  checkout: "2026-10-13",
  hospedes: 2,
  hospedeNome: "Hóspede Fictício da Silva",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 100000,
  taxaCanal: 15000,
  valorLiquido: null,
  codigoCanal: "",
  observacoes: "",
  ...over,
});

const base: DadosRelatorio = {
  empresa: "Sua Casa Leblon",
  contato: ["https://example.com"],
  proprietarios: ["Dona Fictícia"],
  representantes: [],
  imoveis: [{ id: "i1", codigo: "403", nome: "Studio Mezanino" }],
  ano: 2026,
  mes: 10,
  situacao: "fechado",
  ate: null,
  resumo: { reservas: 1, receitaBruta: 100000, taxasCanais: 15000, comissao: 12750, suaParte: 72250, despesas: 0, acerto: 72250, acertoPendente: 0, emConferencia: false },
  reservas: [
    {
      id: "r1",
      codigo: "R1",
      imovelId: "i1",
      imovelCodigo: "403",
      checkin: "2026-10-10",
      checkout: "2026-10-13",
      hospede: "Hóspede Fictício da Silva",
      origemHospede: "",
      canal: "booking",
      bruto: 100000,
      suaParte: 72250,
      situacao: "definido",
    },
  ],
  rodape: [],
};

const rodape = (over: Partial<Rodape>): Rodape => ({
  proprietarioId: "p",
  nome: "Dona",
  situacao: "zerado",
  saldo: 0,
  descontado: 0,
  valor: 0,
  aFavor: null,
  chavePix: "",
  dataPagamento: null,
  diferenca: 0,
  emConferencia: false,
  repassePosterior: null,
  ...over,
});

describe("textos do relatório (primeira página)", () => {
  it("título com mês por extenso, nome comercial (sem código), destinatários e período", () => {
    const t = textosDoRelatorio({ ...base, representantes: ["Representante Fictício"] });
    expect(t.titulo).toBe("Relatório de outubro de 2026");
    expect(t.imoveis).toBe("Studio Mezanino");
    expect(t.destinatarios).toBe("Proprietário: Dona Fictícia · Representante: Representante Fictício");
    expect(t.periodo).toBe("De 1º/10/2026 a 31/10/2026");
    expect(t.aviso).toBeNull();
    expect(t.contato).toBe("https://example.com");
  });

  it("mês atual: parcial até hoje; mês futuro: previsto", () => {
    const p = textosDoRelatorio({ ...base, situacao: "parcial", ate: "2026-10-20" });
    // O mês inteiro (como no portal), dizendo de quando é a posição e que inclui o que ainda vai acontecer.
    expect(p.periodo).toBe("De 1º/10/2026 a 31/10/2026 (parcial: posição de 20/10/2026)");
    expect(p.aviso).toContain("inclusive as que ainda não aconteceram");
    expect(textosDoRelatorio({ ...base, situacao: "futuro" }).periodo).toContain("previsto");
  });

  it("destaque é a parte do proprietário, com a base nomeada (não é total do canal nem lucro)", () => {
    const t = textosDoRelatorio(base);
    const destaques = t.numeros.filter((n) => n.destaque);
    expect(destaques).toHaveLength(1);
    expect(destaques[0]).toMatchObject({ rotulo: "Sua parte das reservas", valor: "R$ 722,50" });
    expect(destaques[0].detalhe).toContain("não é o total do canal nem lucro");
    expect(t.numeros.find((n) => n.rotulo === "Taxas dos canais")?.valor).toBe("R$ 150,00");
  });

  it("do hóspede, só o primeiro nome; coluna de imóvel só com mais de um imóvel", () => {
    const t = textosDoRelatorio(base);
    expect(t.reservas[0]).toMatchObject({ hospede: "Hóspede", entrada: "10/10", canal: "Booking.com", bruto: "R$ 1.000,00", situacao: "Definido" });
    expect(t.mostrarImovel).toBe(false);
    const dois = textosDoRelatorio({ ...base, imoveis: [...base.imoveis, { id: "i2", codigo: "102", nome: "Studio Inteligente" }] });
    expect(dois.mostrarImovel).toBe(true);
    expect(dois.reservas[0].imovel).toBe("Studio Mezanino");
    expect(textosDoRelatorio({ ...base, reservas: [{ ...base.reservas[0], hospede: "" }] }).reservas[0].hospede).toBe("não informado");
  });

  it("em conferência: aviso com o valor à parte", () => {
    const t = textosDoRelatorio({ ...base, resumo: { ...base.resumo, emConferencia: true, acertoPendente: -5000 } });
    expect(t.emConferencia).toContain("R$ 50,00 a favor da Sua Casa Leblon");
  });

  it("saldo: mesma leitura do rodapé do portal; Pix do proprietário nunca impresso", () => {
    const e = "SCL";
    expect(textoDoSaldo(rodape({ situacao: "empresa_deve", valor: 72250, chavePix: "dona@example.com" }), e)[0]).toBe(
      "Credor: você. A SCL vai lhe transferir R$ 722,50 para a sua chave Pix cadastrada.",
    );
    expect(textoDoSaldo(rodape({ situacao: "empresa_deve", valor: 100 }), e)[0]).toContain("não está cadastrada");
    expect(textoDoSaldo(rodape({ situacao: "proprietario_deve", valor: 30000, chavePix: "pix-da-empresa" }), e)).toEqual([
      "Credor: SCL. Você deve R$ 300,00 à SCL.",
      "Pix da SCL: pix-da-empresa",
    ]);
    expect(textoDoSaldo(rodape({ situacao: "pago", valor: 100, dataPagamento: "2026-11-05", diferenca: -200 }), e)).toEqual([
      "Repasse de R$ 1,00 pago em 05/11/2026.",
      "Depois do fechamento, o acerto deste mês mudou R$ 2,00 (a favor da SCL): isso entra no próximo repasse.",
    ]);
    expect(textoDoSaldo(rodape({ situacao: "parcial", valor: 100, aFavor: "proprietario" }), e)[0]).toContain("a seu favor");
    expect(textoDoSaldo(rodape({ situacao: "no_repasse_posterior", repassePosterior: "2026-11" }), e)[0]).toContain("novembro");
    expect(textoDoSaldo(rodape({}), e)).toEqual(["Nada a pagar ou receber neste mês."]);
    const dois = textosDoRelatorio({ ...base, rodape: [rodape({ nome: "A" }), rodape({ nome: "B" })] });
    expect(dois.saldo).toEqual(["A: Nada a pagar ou receber neste mês.", "B: Nada a pagar ou receber neste mês."]);
  });
});

describe("PDF", () => {
  it("páginas do extrato: todas, intervalos, ordem digitada e erros claros", () => {
    expect(lerPaginas("", 3)).toEqual([0, 1, 2]);
    expect(lerPaginas(" 2-3 , 1, 2", 3)).toEqual([1, 2, 0]);
    expect(() => lerPaginas("4", 3)).toThrow("tem 3 página(s)");
    expect(() => lerPaginas("3-1", 3)).toThrow(ErroRelatorio);
    expect(() => lerPaginas("a", 3)).toThrow("não é um número");
  });

  it("anexos: foto JPG/PNG e extrato PDF, com limite de tamanho", () => {
    expect(() => conferirAnexos({ foto: PNG })).not.toThrow();
    expect(() => conferirAnexos({ foto: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) })).toThrow("JPG ou PNG");
    expect(() => conferirAnexos({ foto: new Uint8Array(2 * 1024 * 1024 + 1).fill(0xff) })).toThrow("2 MB");
    expect(() => conferirAnexos({ extrato: { bytes: PNG } })).toThrow("PDF oficial");
  });

  it("gera a página do relatório e copia o extrato como veio (todas ou só as escolhidas)", async () => {
    const t = textosDoRelatorio(base);
    expect(await paginasDe(await gerarPdfRelatorio(t))).toBe(1);
    const extrato = await pdfCom(3);
    expect(await paginasDe(await gerarPdfRelatorio(t, { foto: PNG, extrato: { bytes: extrato } }))).toBe(4);
    const so = await PDFDocument.load(await gerarPdfRelatorio(t, { extrato: { bytes: extrato, paginas: "2-3" } }));
    expect(so.getPageCount()).toBe(3);
    // Páginas do extrato mantêm o tamanho original (não são redesenhadas).
    expect(so.getPage(1).getSize()).toEqual({ width: 300, height: 400 });
    expect(so.getTitle()).toBe("Relatório de outubro de 2026 — Studio Mezanino");
  });

  it("extrato que não abre: erro claro, nada gerado", async () => {
    const quebrado = new TextEncoder().encode("%PDF-1.7 isto não é um pdf");
    await expect(gerarPdfRelatorio(textosDoRelatorio(base), { extrato: { bytes: quebrado } })).rejects.toThrow("Não foi possível ler o PDF do extrato.");
  });

  it("nomes com caracteres fora da fonte (emoji, outros alfabetos) não quebram o PDF", async () => {
    const t = textosDoRelatorio({ ...base, proprietarios: ["Dona 😀 李"], reservas: [{ ...base.reservas[0], hospede: "Žofia 🌴" }] });
    expect(await paginasDe(await gerarPdfRelatorio(t))).toBe(1);
  });

  it("muitas reservas: a tabela continua na página seguinte, antes do extrato", async () => {
    const reservas = Array.from({ length: 70 }, (_, i) => ({ ...base.reservas[0], id: `r${i}` }));
    const n = await paginasDe(await gerarPdfRelatorio(textosDoRelatorio({ ...base, reservas }), { extrato: { bytes: await pdfCom(1) } }));
    expect(n).toBeGreaterThanOrEqual(3);
  });
});

describe("dados e acesso", () => {
  let db: Db;
  let close: () => Promise<void>;
  let org: string;
  let a: string;
  let b: string;
  let dona: string;
  let outro: string;
  let donaUsuario: Sessao;
  const admin = (): Sessao => ({ usuarioId: donaUsuario.usuarioId, organizacaoId: org, papel: "admin", imovelIds: [] });
  const AGORA = new Date("2026-11-02T15:00:00Z");

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Leblon" }).returning();
    [{ id: a }, { id: b }] = await db
      .insert(imoveis)
      .values([
        { organizacaoId: org, codigo: "403", nome: "Studio Mezanino" },
        { organizacaoId: org, codigo: "102", nome: "Studio Inteligente" },
      ])
      .returning();
    [{ id: dona }, { id: outro }] = await db
      .insert(proprietarios)
      .values([
        { organizacaoId: org, nome: "Dona Fictícia", chavePix: "dona@example.com" },
        { organizacaoId: org, nome: "Outro Fictício" },
      ])
      .returning();
    await db.insert(proprietarioImoveis).values([
      { proprietarioId: dona, imovelId: a },
      { proprietarioId: outro, imovelId: b },
    ]);
    await db.insert(representantes).values([
      { proprietarioId: dona, nome: "Rep Autorizado", recebeRelatorios: true },
      { proprietarioId: dona, nome: "Rep Sem Relatório", recebeRelatorios: false },
    ]);
    await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await criarReserva(db, org, reserva(a), null);
    await criarReserva(db, org, reserva(b, { hospedeNome: "Outra Pessoa" }), null);
    const [u] = await db.insert(usuarios).values({ organizacaoId: org, email: "dona@example.com", nome: "Dona", papel: "proprietario" }).returning();
    await db.insert(proprietarioUsuarios).values({ proprietarioId: dona, usuarioId: u.id });
    donaUsuario = { usuarioId: u.id, organizacaoId: org, papel: "proprietario", imovelIds: [a] };
  });
  afterEach(() => close());

  it("números iguais aos do portal (mesma função), representante só se recebe relatórios", async () => {
    const d = await dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" });
    const portal = await resumoDoProprietario(db, org, { proprietarioIds: [dona], imovelIds: [a], semImovel: true, periodo: { inicio: "2026-10-01", fim: "2026-11-01" } });
    expect(d.resumo).toEqual(portal);
    expect(d.resumo.suaParte).toBe(72250);
    expect(d.representantes).toEqual(["Rep Autorizado"]);
    expect(d.reservas.map((r) => r.imovelId)).toEqual([a]);
    expect(d.situacao).toBe("fechado");
    expect(d.rodape[0]).toMatchObject({ situacao: "empresa_deve", valor: 72250 });
  });

  it("portal: só o proprietário, só o mês, só dentro da janela; imóvel de outro é ignorado", async () => {
    expect(await relatorioDoPortal(db, admin(), { ano: "2026", mes: "10" }, AGORA)).toMatchObject({ ok: false, status: 403 });
    expect(await relatorioDoPortal(db, null, { ano: "2026", mes: "10" }, AGORA)).toMatchObject({ ok: false, status: 403 });
    expect(await relatorioDoPortal(db, donaUsuario, { ano: "2026", mes: "todos" }, AGORA)).toMatchObject({ ok: false, status: 400 });
    expect(await relatorioDoPortal(db, donaUsuario, { ano: "2020", mes: "1" }, AGORA)).toMatchObject({ ok: false, status: 400 });
    const r = await relatorioDoPortal(db, donaUsuario, { ano: "2026", mes: "10", imovel: ["102"] }, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect(r.arquivo).toBe("relatorio-2026-10-403.pdf");
    expect(await paginasDe(r.pdf)).toBe(1);
  });

  it("painel: só quem vê proprietários e financeiro; imóvel de outro proprietário é recusado", async () => {
    const operacao: Sessao = { ...admin(), papel: "operacao" };
    expect(await relatorioDoPainel(db, operacao, dona, { mes: "2026-10", imoveis: [], anexos: {} }, AGORA)).toMatchObject({ ok: false, status: 403 });
    expect(await relatorioDoPainel(db, donaUsuario, dona, { mes: "2026-10", imoveis: [], anexos: {} }, AGORA)).toMatchObject({ ok: false, status: 403 });
    expect(await relatorioDoPainel(db, admin(), dona, { mes: "2026-10", imoveis: ["102"], anexos: {} }, AGORA)).toMatchObject({ ok: false, status: 400 });
    expect(await relatorioDoPainel(db, admin(), dona, { mes: "2026-13", imoveis: [], anexos: {} }, AGORA)).toMatchObject({ ok: false, status: 400 });
    expect(await relatorioDoPainel(db, admin(), "nao-e-uuid", { mes: "2026-10", imoveis: [], anexos: {} }, AGORA)).toMatchObject({ ok: false, status: 404 });
    // Proprietário arquivado: o relatório de meses passados continua possível (o link aparece na ficha dele).
    await db.update(proprietarios).set({ ativo: false }).where(eq(proprietarios.id, dona));
    expect(await relatorioDoPainel(db, admin(), dona, { mes: "2026-10", imoveis: [], anexos: {} }, AGORA)).toMatchObject({ ok: true });
  });

  it("painel: gera com extrato, registra no histórico sem o conteúdo; extrato inválido não registra nada", async () => {
    const ruim = await relatorioDoPainel(db, admin(), dona, { mes: "2026-10", imoveis: [], anexos: { extrato: { bytes: new TextEncoder().encode("%PDF-xx") } } }, AGORA);
    expect(ruim).toMatchObject({ ok: false, status: 400 });
    const historico = () => db.select().from(auditoria).where(eq(auditoria.acao, "relatorio.pdf"));
    expect(await historico()).toHaveLength(0);
    const r = await relatorioDoPainel(db, admin(), dona, { mes: "2026-10", imoveis: ["403"], anexos: { foto: PNG, extrato: { bytes: await pdfCom(2), paginas: "2" } } }, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect(await paginasDe(r.pdf)).toBe(2);
    const [h] = await historico();
    expect(h).toMatchObject({ acao: "relatorio.pdf", entidade: "proprietario", entidadeId: dona });
    expect(h.mudancas).toEqual({ relatorio: [null, "2026-10 · 403"], anexos: [null, "foto e extrato"] });
  });
});
