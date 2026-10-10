import { eq } from "drizzle-orm";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { criarContrato } from "@/contratos/repositorio";
import { auditoria, bloqueios, imoveis, lancamentos, organizacoes, proprietarioImoveis, proprietarios, proprietarioUsuarios, representantes, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { criarCategoria } from "@/despesas/categorias";
import { registrarDespesa } from "@/despesas/despesas";
import { lancar } from "@/financeiro/ledger";
import type { Db } from "@/db/types";
import { resumoDoProprietario } from "@/portal/resumo";
import type { Rodape } from "@/portal/rodape";
import type { DadosReserva } from "@/reservas/regras";
import { criarBloqueio } from "@/reservas/bloqueios";
import { criarReserva } from "@/reservas/repositorio";
import { guardarFoto, listarFotos, usarComoCapa } from "@/imoveis/fotos";
import { donosDosEscolhidos, relatorioDoFechamento, relatorioDoPainel, relatorioDoPortal } from "./gerar";
import type { ParteDoRelatorio } from "./dinheiro";
import { type DadosDoMes, diariaMedia } from "./metricas";
import { conferirAnexos, ErroRelatorio, extratosDe, gerarPdfRelatorio, lerPaginas } from "./pdf";
import { comPaginas, type DadosRelatorio, dadosDoRelatorio, imoveisDoProprietario, marcaDe, PAGINAS_PADRAO, textoDoSaldo, textosDoRelatorio } from "./relatorio";
import { receberTudo } from "@/repasses/testes";
import { gerarAntecipado, marcarRepassePago } from "@/repasses/repasses";
import { repassesDoRelatorio } from "./dados";

// PNG 1×1 (fictício, só para o teste).
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

async function pdfCom(paginas: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) d.addPage([300, 400]);
  return d.save();
}
const paginasDe = async (b: Uint8Array) => (await PDFDocument.load(b)).getPageCount();
/** O conteúdo (operadores) de cada página, para conferir o que foi desenhado — as fontes padrão escrevem o texto em hexadecimal WinAnsi. */
async function conteudoDasPaginas(b: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(b);
  return doc.getPages().map((pg) => {
    const c = pg.node.Contents();
    const itens = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
    return itens
      .map((x) => {
        const s = doc.context.lookup(x);
        return s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") : "";
      })
      .join("\n")
      .toLowerCase();
  });
}
const hexWinAnsi = (texto: string) => Buffer.from(texto, "latin1").toString("hex").toLowerCase();

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

const parte = (over: Partial<ParteDoRelatorio> = {}): ParteDoRelatorio => ({
  reservaId: "r1", codigo: "R1", codigoCanal: "", hospede: "Hóspede Fictício da Silva", canal: "booking", checkin: "2026-10-10", checkout: "2026-10-13", mes: "2026-10", noitesNoMes: 3, noitesTotal: 3,
  bruto: 100000, taxa: 15000, comissao: 12750, suaParte: 72250, quemRecebe: "empresa", situacao: "disponivel", motivo: "Disponível para o próximo repasse.", pagamento: { data: "2026-10-12", fonte: "recebimento" }, repasse: null, ...over,
});
const mesDados = (over: Partial<DadosDoMes> = {}): DadosDoMes => ({ mes: "2026-10", resultado: 72250, bruto: 100000, noitesOcupadas: 3, reservas: 1, noitesDoPeriodo: 31, imoveis: 1, diasImovel: 31, noitesBloqueadas: 0, ...over });
/** Série de 12 meses só com o resultado (os outros números do mês ficam os do fixture). */
const mesesDe = (serie: [string, number | null][]): [string, DadosDoMes | null][] => serie.map(([m, r]) => [m, r === null ? null : mesDados({ mes: m, resultado: r })]);

const base: DadosRelatorio = {
  hoje: "2026-11-02",
  empresa: "Sua Casa Leblon",
  diaFechamento: 2,
  contato: ["https://example.com"],
  proprietarios: ["Dona Fictícia"],
  representantes: [],
  imoveis: [{ id: "i1", codigo: "403", nome: "Studio Mezanino" }],
  ano: 2026,
  mes: 10,
  situacao: "fechado",
  ate: null,
  resumo: { reservas: 1, receitaBruta: 100000, taxasCanais: 15000, comissao: 12750, suaParte: 72250, despesas: 0, acerto: 72250, acertoPendente: 0, emConferencia: false, retidoDeCanceladas: { n: 0, bruto: 0 }, devolvidoDeCanceladas: { n: 0, bruto: 0 } },
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
      confirmada: true,
      cancelada: false,
      etiqueta: null,
    },
  ],
  rodape: [],
  partes: [parte()],
  metricas: { atual: mesDados(), anterior: null, anoAnterior: null, meses: [["2026-10", mesDados()]], parcialAte: null },
  repasses: [],
  fechamentos: [],
  despesas: [],
  contratos: [{ imovelId: "i1", tipo: "gestao_completa", tipoNome: "Gestão completa", comissao: "15%" }],
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

describe("textos do relatório (modelo oficial, M5.7)", () => {
  it("capa: olho com o mês por extenso, emissão, período, marca em duas partes, destinatários e identidade do contrato", () => {
    const t = textosDoRelatorio({ ...base, representantes: ["Representante Fictício"], imoveis: [{ ...base.imoveis[0], bairro: "Leblon", cidade: "Rio de Janeiro" }] });
    expect(t.olho).toBe("Relatório mensal · Outubro de 2026");
    expect(t.emissao).toBe("fechamento do mês"); // a data de emissão entra só no PDF: os textos não dependem do relógio
    expect(t.periodo).toBe("1 a 31 de outubro de 2026");
    expect(t.marca).toEqual({ inicio: "Sua Casa", destaque: "Leblon" });
    expect(marcaDe("SCL")).toEqual({ inicio: "SCL", destaque: "" });
    expect(t.imovelTitulo).toBe("Studio Mezanino");
    expect(t.cabecalhoCurto).toBe("Studio Mezanino · Outubro de 2026");
    expect(t.para).toBe("Para Dona Fictícia · com cópia a Representante Fictício, representante autorizado");
    expect(t.identidade).toBe("Leblon, Rio de Janeiro · contrato de gestão completa · comissão de 15% sobre o líquido dos canais");
    expect(t.marketplace).toBe(false);
    expect(t.aviso).toBeNull();
    expect(t.contato).toBe("https://example.com");
    expect(t.rodapeCapa.semAnexos).toContain("ficam com a equipe");
    expect(t.rodapeCapa.comAnexos).toContain("no fim, como emitidos");
  });

  it("mês atual: parcial até o dia, sem comparação; mês futuro: previsto; marketplace na identidade", () => {
    const p = textosDoRelatorio({ ...base, situacao: "parcial", ate: "2026-10-20", metricas: { ...base.metricas, parcialAte: 20, anterior: mesDados({ mes: "2026-09" }) } });
    expect(p.emissao).toBe("parcial até 20/10");
    expect(p.periodo).toBe("1 a 20/10/2026 (parcial: posição de 20/10/2026)");
    expect(p.aviso).toContain("inclusive as que ainda não aconteceram");
    expect(p.quadros[4]).toMatchObject({ valor: "mês em andamento", semDado: true });
    expect(textosDoRelatorio({ ...base, situacao: "futuro" }).periodo).toContain("previsto");
    const m = textosDoRelatorio({ ...base, contratos: [{ imovelId: "i1", tipo: "marketplace", tipoNome: "Marketplace", comissao: null }] });
    expect(m.marketplace).toBe(true);
    expect(m.identidade).toBe("contrato de marketplace");
  });

  it("destaque é o resultado (sua parte menos despesas), com a base nomeada; do bruto ao resultado linha a linha", () => {
    const t = textosDoRelatorio(base);
    expect(t.destaque).toEqual({ rotulo: "Seu resultado em outubro de 2026", valor: "R$ 722,50", base: "Sua parte na 1 reserva com noites em outubro de 2026, em todos os canais (sem despesas do imóvel no mês). Resultado por noite: não é o total que um canal pagou no mês nem o valor de um Pix só." });
    expect(t.brutoAoResultado.map((l) => [l.texto, l.valor, l.tipo])).toEqual([
      ["Bruto das reservas (1 reserva, 3 noites em outubro de 2026)", "R$ 1.000,00", "normal"],
      ["− Taxas dos canais (Booking.com)", "− R$ 150,00", "sub"],
      ["Líquido depois dos canais", "R$ 850,00", "normal"],
      ["− Comissão da gestão (15% do líquido)", "− R$ 127,50", "sub"],
      ["Sua parte nas reservas", "R$ 722,50", "normal"],
      ["Seu resultado em outubro de 2026", "R$ 722,50", "total"],
    ]);
    const com = textosDoRelatorio({ ...base, resumo: { ...base.resumo, despesas: 5000 }, despesas: [{ data: "2026-10-12", descricao: "Troca do chuveiro", valor: 5000 }] });
    expect(com.destaque.valor).toBe("R$ 672,50");
    expect(com.destaque.base).toContain("já descontadas as despesas do imóvel (R$ 50,00)");
    expect(com.brutoAoResultado.at(-2)).toEqual({ texto: "− Despesas do imóvel (1 lançamento — detalhe na página 3)", valor: "− R$ 50,00", tipo: "sub" });
    expect(com.despesas).toEqual([
      { texto: "12/10 — Troca do chuveiro", valor: "R$ 50,00", tipo: "normal" },
      { texto: "Total descontado no fechamento", valor: "R$ 50,00", tipo: "total" },
    ]);
  });

  it("M8.2c: o bruto diz o que vem de canceladas pela política; o desconto vira linha própria na tabela, sem noites", () => {
    const t = textosDoRelatorio({
      ...base,
      resumo: { ...base.resumo, retidoDeCanceladas: { n: 1, bruto: 50000 }, devolvidoDeCanceladas: { n: 2, bruto: -80000 } },
      partes: [
        parte(),
        parte({ reservaId: "r9", codigo: "SCL-9", checkin: "2026-09-10", checkout: "2026-09-12", noitesNoMes: 0, noitesTotal: 2, bruto: -50000, taxa: -500, comissao: -7425, suaParte: -42075, cancelamento: "desconto", pagamento: null }),
        parte({ reservaId: "r8", codigo: "SCL-8", checkin: "2026-09-20", checkout: "2026-09-22", noitesNoMes: 0, noitesTotal: 2, bruto: -30000, taxa: 0, comissao: -4500, suaParte: -25500, cancelamento: "desconto", situacao: "repassado", pagamento: null, repasse: { id: "x", tipo: "antecipado", data: "2026-10-20", situacao: "pago", dataPagamento: "2026-10-21", valor: -25500 } }),
      ],
    });
    expect(t.brutoAoResultado[0]).toMatchObject({
      texto: "Bruto das reservas (1 reserva, 3 noites em outubro de 2026)",
      etiqueta: "inclui R$ 500,00 retido de 1 reserva cancelada sem devolução (política de cancelamento); inclui −R$ 800,00 de 2 reservas canceladas com devolução depois do repasse",
    });
    expect(t.reservas.map((l) => [l.codigo, l.situacao, l.noites, l.atravessa])).toEqual([
      ["R1", "a transferir no fechamento", "3", false],
      ["SCL-9", "cancelada com devolução ao hóspede (estadia de 10/9): desconto no próximo repasse", "—", false],
      ["SCL-8", "cancelada com devolução ao hóspede (estadia de 20/9): descontada no repasse de 21/10", "—", false],
    ]);
    // Sem canceladas, nenhuma nota no bruto.
    expect(textosDoRelatorio(base).brutoAoResultado[0].etiqueta).toBeUndefined();
  });

  it("como chega até você e avisos: o fechamento pelo rodapé, a parte a liberar vira aviso; em conferência também", () => {
    const t = textosDoRelatorio({ ...base, rodape: [rodape({ nome: "Dona Fictícia", situacao: "empresa_deve", valor: 72250, saldo: 72250, aFavor: "proprietario", chavePix: "segredo@example.com" })] });
    expect(t.comoChega.linhas).toEqual([{ texto: "A transferir no fechamento, previsto para 01/11/2026", valor: "R$ 722,50", tipo: "normal" }]);
    expect(t.comoChega.quemPagaQuem).toBe("A Sua Casa Leblon transfere R$ 722,50 para Dona Fictícia em 01/11/2026, pela chave Pix cadastrada no portal.");
    expect(JSON.stringify(t)).not.toContain("segredo@example.com");
    expect(t.avisos).toEqual([]);
    expect(t.acerto).toEqual([
      { texto: "Saldo do acerto em 31/10 (a Sua Casa Leblon deve a você)", valor: "R$ 722,50", tipo: "normal" },
      { texto: "A transferir no fechamento", valor: "R$ 722,50", tipo: "total" },
    ]);
    const aLiberar = textosDoRelatorio({ ...base, partes: [parte({ situacao: "a_liberar", motivo: "A empresa ainda não registrou o recebimento desta reserva.", pagamento: null })], resumo: { ...base.resumo, emConferencia: true, acertoPendente: -5000 } });
    expect(aLiberar.comoChega.linhas[0]).toMatchObject({ tipo: "aviso", texto: expect.stringContaining("A liberar — Hóspede (10/10 → 13/10), Booking.com") });
    expect(aLiberar.avisos).toEqual([
      expect.stringContaining("(R$ 722,50). Entra no próximo repasse assim que o canal pagar; você não precisa fazer nada."),
      expect.stringContaining("Em conferência: há itens deste mês ainda não definidos (R$ 50,00 a favor da Sua Casa Leblon)"),
    ]);
    expect(aLiberar.emConferencia).toContain("R$ 50,00 a favor da Sua Casa Leblon");
    // Quem transfere é o proprietário: o aviso pede a transferência, nunca "entra no próximo repasse; você não precisa fazer nada".
    const deve = textosDoRelatorio({ ...base, rodape: [rodape({ nome: "Dona Fictícia", situacao: "proprietario_deve", valor: 5000, saldo: -5000, aFavor: "empresa" })] });
    expect(deve.avisos).toEqual(["Você transfere à Sua Casa Leblon no fechamento (R$ 50,00). As despesas do mês passaram da sua parte; a chave Pix da Sua Casa Leblon está no portal."]);
    expect(JSON.stringify(deve.avisos)).not.toContain("próximo repasse");
    const conferencia = textosDoRelatorio({ ...base, rodape: [rodape({ nome: "Dona Fictícia", situacao: "em_conferencia", valor: 72250, saldo: 72250, aFavor: null })] });
    expect(conferencia.avisos).toEqual(["Em conferência: o valor do fechamento sai depois que a Sua Casa Leblon resolver (R$ 722,50). Esse valor é provisório e pode mudar; você não precisa fazer nada até a conferência terminar."]);
    expect(aLiberar.reservas[0]).toMatchObject({ situacao: "a liberar: pagamento do canal não registrado", situacaoTipo: "aviso" });
  });

  it("reservas: do hóspede só o primeiro nome, canal e código do canal, situação da parte, noites do mês; total; imóvel só com mais de um", () => {
    const t = textosDoRelatorio(base);
    expect(t.reservasTitulo).toBe("Reservas do mês · 1 reserva · 3 noites em outubro de 2026");
    expect(t.reservas).toEqual([
      { imovel: "Studio Mezanino", hospede: "Hóspede", canal: "Booking.com", codigo: "R1", situacao: "a transferir no fechamento", situacaoTipo: "info", datas: "10/10 → 13/10", noites: "3", bruto: "R$ 1.000,00", taxa: "R$ 150,00", gestao: "R$ 127,50", suaParte: "R$ 722,50", atravessa: false },
    ]);
    expect(t.totalReservas).toMatchObject({ hospede: "Total de outubro de 2026", noites: "3", bruto: "R$ 1.000,00", taxa: "R$ 150,00", gestao: "R$ 127,50", suaParte: "R$ 722,50" });
    expect(t.notaReservas).not.toContain("*");
    expect(t.mostrarImovel).toBe(false);
    // Estadia que atravessa o mês: noites "2 de 3", asterisco e a nota; código do canal quando existe; repassada e paga pelo canal.
    const varias = textosDoRelatorio(
      {
        ...base,
        partes: [
          parte({ reservaId: "r2", codigoCanal: "4471-905", hospede: "Elisa Fictícia", checkin: "2026-10-30", checkout: "2026-11-02", noitesNoMes: 2, noitesTotal: 3, situacao: "repassado", repasse: { id: "x", tipo: "antecipado", data: "2026-10-31", situacao: "pago", dataPagamento: "2026-10-31", valor: 72250 } }),
          parte({ reservaId: "r3", hospede: "Zé", canal: "airbnb", quemRecebe: "split", situacao: "informacao", pagamento: { data: "2026-10-11", fonte: "canal", prazo: 1 } }),
          parte({ reservaId: "r4", hospede: "Ana", quemRecebe: "a_confirmar", situacao: "a_liberar", pagamento: null }),
        ],
        reservas: [...["r2", "r3", "r4"].map((id) => ({ ...base.reservas[0], id })), { ...base.reservas[0], id: "r9", codigo: "R9", hospede: "Sem Cálculo", situacao: "sem_calculo", bruto: 0, suaParte: 0 }],
        imoveis: [...base.imoveis, { id: "i2", codigo: "102", nome: "Studio Inteligente" }],
      },
    );
    expect(varias.reservas.map((l) => [l.hospede, l.codigo, l.datas, l.noites, l.situacao, l.situacaoTipo])).toEqual([
      ["Elisa", "4471-905", "30/10 → 2/11 *", "2 de 3", "repassada em 31/10", "ok"],
      ["Zé", "R1", "10/10 → 13/10", "3", "paga pelo canal em 11/10", "ok"],
      ["Ana", "R1", "10/10 → 13/10", "3", "a liberar: quem recebe a confirmar", "aviso"],
      ["Sem", "R9", "10/10 → 13/10", "—", "sem cálculo ainda", "aviso"],
    ]);
    expect(varias.notaReservas).toContain("* Estadia que atravessa o mês");
    expect(varias.mostrarImovel).toBe(true);
    expect(textosDoRelatorio({ ...base, partes: [], reservas: [{ ...base.reservas[0], hospede: "" }] }).reservas[0].hospede).toBe("não informado");
  });

  it("números do mês e gráficos: seis quadros, série de 12 meses do resultado e da ocupação (com a diária média), acumulado desde o primeiro mês com dado", () => {
    const atual = mesDados({ resultado: 1503780, bruto: 1945000, noitesOcupadas: 18, reservas: 7, noitesBloqueadas: 2 });
    const anterior = mesDados({ mes: "2026-09", resultado: 1304000, bruto: 1600000, noitesOcupadas: 16, noitesDoPeriodo: 30, diasImovel: 30 });
    const meses: [string, DadosDoMes | null][] = [...mesesDe([["2026-05", 980000], ["2026-06", 1120000], ["2026-07", 1390000], ["2026-08", 1210000]]), ["2026-09", anterior], ["2026-10", atual]];
    const t = textosDoRelatorio({ ...base, metricas: { atual, anterior, anoAnterior: null, meses, parcialAte: null } });
    expect(t.quadros.map((q) => q.valor)).toEqual(["18 noites ocupadas", "R$ 1.080,56", "R$ 670,69", "7 reservas", "+15%", "sem dado no sistema"]);
    expect(t.grafico.serie).toHaveLength(12);
    expect(t.grafico.serie[0]).toEqual({ mes: "2025-11", resultado: null, atual: false });
    expect(t.grafico.serie.at(-1)).toEqual({ mes: "2026-10", resultado: 1503780, atual: true });
    expect(t.grafico.acumulado).toBe("Acumulado desde maio de 2026 (primeiro mês com dado): R$ 75.077,80");
    expect(t.grafico.legendaAtual).toBe("outubro de 2026");
    // Gráfico de ocupação (M5.8): mesma janela de 12 meses; sem dado → nulls; diária média por mês.
    expect(t.graficoOcupacao.titulo).toBe("Ocupação por mês, últimos 12 meses (%)");
    expect(t.graficoOcupacao.serie).toHaveLength(12);
    expect(t.graficoOcupacao.serie[0]).toEqual({ mes: "2025-11", ocupacao: null, diaria: null, atual: false, semOcupacao: "sem_dado" });
    expect(t.graficoOcupacao.serie.at(-2)).toEqual({ mes: "2026-09", ocupacao: 53, diaria: 100000, atual: false, semOcupacao: null });
    expect(t.graficoOcupacao.serie.at(-1)).toEqual({ mes: "2026-10", ocupacao: 62, diaria: 108056, atual: true, semOcupacao: null });
    expect(textosDoRelatorio({ ...base, metricas: { ...base.metricas, meses: mesesDe([["2026-01", 100], ["2026-10", 72250]]) } }).grafico.acumulado).toBe("Acumulado de 2026: R$ 723,50");
  });

  it("conciliação por data de pagamento com a ponte fechando; repasses do mês com etiqueta; posição com data e hora de Brasília", () => {
    const t = textosDoRelatorio(
      {
        ...base,
        partes: [parte(), parte({ reservaId: "r2", hospede: "Zé", canal: "airbnb", checkin: "2026-09-29", checkout: "2026-10-02", noitesNoMes: 1, noitesTotal: 3, bruto: 30000, taxa: 900, comissao: 4365, suaParte: 24735, quemRecebe: "split", situacao: "informacao", pagamento: { data: "2026-09-30", fonte: "canal", prazo: 1 } })],
        repasses: [{ id: "rep1", tipo: "antecipado", data: "2026-10-16", situacao: "pago", dataPagamento: "2026-10-16", valor: 72250, reservas: ["Hóspede"] }],
        rodape: [rodape({ nome: "Dona Fictícia", situacao: "pago", valor: 0, dataPagamento: "2026-11-01" })],
      },
    );
    expect(t.conciliacao.map((l) => [l.rotulo, l.reservas, l.suaParte, l.tipo])).toEqual([
      ["Booking.com", "1", "R$ 722,50", "canal"],
      ["Pago pelos canais em outubro de 2026", "1", "R$ 722,50", "subtotal"],
      ["+ 1 noite de outubro de 2026 paga em setembro de 2026 (Zé (29/9 → 2/10), Airbnb, paga em 30/9)", "1", "R$ 247,35", "ponte"],
      ["Resultado por noite de outubro de 2026", "2", "R$ 969,85", "total"],
    ]);
    expect(t.conciliacaoFecha).toBe(true);
    expect(t.conciliacaoIntro).toContain("pela data do pagamento");
    expect(t.repasses[0]).toEqual({ texto: "16/10 — repasse antecipado (Hóspede)", valor: "R$ 722,50", tipo: "normal", etiqueta: "pago em 16/10 · comprovante no portal" });
    // Antecipado programado para 31/10 e pago em 1/11: a linha leva a data do Pix e diz a programada.
    const virada = textosDoRelatorio({ ...base, repasses: [{ id: "rep2", tipo: "antecipado", data: "2026-10-31", situacao: "pago", dataPagamento: "2026-11-01", valor: 1000, reservas: ["Zé"] }] });
    expect(virada.repasses[0]).toEqual({ texto: "1/11 — repasse antecipado (Zé)", valor: "R$ 10,00", tipo: "normal", etiqueta: "pago em 1/11 (programado para 31/10) · comprovante no portal" });
    // Relatório parcial antes da data do canal: a parte paga pelo canal ainda é prevista, não "paga".
    const antes = textosDoRelatorio({ ...base, hoje: "2026-10-05", situacao: "parcial", ate: "2026-10-05", partes: [parte({ quemRecebe: "split", situacao: "informacao", canal: "airbnb", pagamento: { data: "2026-10-11", fonte: "canal", prazo: 1 } })] });
    expect(antes.reservas[0]).toMatchObject({ situacao: "prevista para 11/10 pelo canal", situacaoTipo: "info" });
    // Sem prazo do canal cadastrado: nem "paga" na tabela, nem na capa; aviso com o que falta.
    const semPrazo = textosDoRelatorio({ ...base, partes: [parte({ quemRecebe: "split", situacao: "informacao", canal: "airbnb", pagamento: null })] });
    expect(semPrazo.reservas[0]).toMatchObject({ situacao: "pelo canal, sem data: prazo do canal não cadastrado", situacaoTipo: "aviso" });
    expect(semPrazo.avisos).toContain("O Airbnb paga a você direto, mas sem data: o prazo do canal não está cadastrado (reserva de Hóspede (10/10 → 13/10)) (R$ 722,50). A data aparece aqui quando a Sua Casa Leblon cadastrar o prazo do canal; confira o pagamento na sua conta do canal.");
    expect(antes.comoChega.linhas.map((l) => l.texto)).toContain("Previsto para 11/10: o Airbnb paga a você direto (3 noites de outubro de 2026 da reserva de Hóspede (10/10 → 13/10))");
    expect(t.repasses[1]).toMatchObject({ texto: "Transferido no fechamento, em 01/11/2026" });
    expect(t.posicao).toBe('Nenhum valor é estimado: o que o sistema ainda não tem aparece como "a receber" ou "a liberar". Um repasse "enviado" não confirma o crédito na sua conta: confira o comprovante no portal.');
    // Mesmos dados, horas diferentes: textos idênticos (o e-mail do fechamento versiona o conteúdo por eles).
    expect(JSON.stringify(textosDoRelatorio(base))).toBe(JSON.stringify(textosDoRelatorio({ ...base })));
  });

  it("M8.2c — saldo com desconto de reserva cancelada que passa da parte: sai do próximo repasse; o Pix só para o resto", () => {
    const e = "SCL";
    expect(textoDoSaldo(rodape({ situacao: "proprietario_deve", valor: 30000, chavePix: "pix-da-empresa", descontoCancelamento: 30000 }), e)).toEqual([
      "Credor: SCL. Você deve R$ 300,00 à SCL, mas não precisa transferir: o desconto de reserva cancelada com devolução ao hóspede (R$ 300,00), maior que a sua parte deste mês, não se transfere: sai do próximo repasse.",
    ]);
    expect(textoDoSaldo(rodape({ situacao: "proprietario_deve", valor: 30000, chavePix: "pix-da-empresa", descontoCancelamento: 20000 }), e)).toEqual([
      "Credor: SCL. Você deve R$ 300,00 à SCL. Desse valor, o desconto de reserva cancelada com devolução ao hóspede (R$ 200,00), maior que a sua parte deste mês, não se transfere: sai do próximo repasse; transfira R$ 100,00.",
      "Pix da SCL: pix-da-empresa",
    ]);
    const so = textosDoRelatorio({ ...base, rodape: [rodape({ nome: "Dona Fictícia", situacao: "proprietario_deve", valor: 5000, saldo: -5000, aFavor: "empresa", descontoCancelamento: 5000 })] });
    expect(so.acerto.at(-1)).toEqual({ texto: "Desconto de reserva cancelada com devolução ao hóspede: sai do próximo repasse", valor: "R$ 50,00", tipo: "total" });
    expect(JSON.stringify(so)).not.toContain("Você transfere");
    expect(so.avisos.join(" ")).not.toContain("As despesas do mês passaram da sua parte");
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

  it("anexos: foto JPG/PNG e extratos PDF (um ou vários), com limite de tamanho", () => {
    expect(() => conferirAnexos({ foto: PNG })).not.toThrow();
    expect(() => conferirAnexos({ foto: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) })).toThrow("JPG ou PNG");
    expect(() => conferirAnexos({ foto: new Uint8Array(2 * 1024 * 1024 + 1).fill(0xff) })).toThrow("2 MB");
    expect(() => conferirAnexos({ extrato: { bytes: PNG } })).toThrow("PDF oficial");
    expect(() => conferirAnexos({ extratos: [{ canal: "Booking.com", bytes: PNG }] })).toThrow("(Booking.com) precisa ser o PDF oficial");
    expect(extratosDe({ extrato: { bytes: PNG, canal: "Airbnb" }, extratos: [{ canal: "Booking.com", bytes: PNG }] }).map((e) => e.canal)).toEqual(["Booking.com", "Airbnb"]);
  });

  it("três páginas sem anexos; com extratos, a página de anexos e as cópias no fim (todas ou só as escolhidas)", async () => {
    const t = textosDoRelatorio(base);
    expect(await paginasDe(await gerarPdfRelatorio(t))).toBe(3);
    const extrato = await pdfCom(3);
    // Lista de repasses longa: a coluna da esquerda abre outra página e despesas e acerto seguem embaixo, na largura toda
    // (sem voltar ao topo da página anterior); o PDF continua inteiro.
    const muitos = textosDoRelatorio({ ...base, repasses: Array.from({ length: 70 }, (_, i) => ({ id: `rep${i}`, tipo: "antecipado" as const, data: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, situacao: "pago" as const, dataPagamento: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, valor: 1000 + i, reservas: ["SCL-1"] })) });
    expect(muitos.repasses.length).toBeGreaterThan(60);
    const comTransbordo = await paginasDe(await gerarPdfRelatorio(muitos));
    expect(comTransbordo).toBeGreaterThanOrEqual(4);
    expect(comTransbordo).toBeLessThanOrEqual(6);
    const comExtrato = await gerarPdfRelatorio(t, { foto: PNG, extrato: { bytes: extrato } });
    expect(await paginasDe(comExtrato)).toBe(4 + 3);
    // A numeração conta o PDF inteiro, inclusive as páginas copiadas do extrato (cada uma com o seu "Página N de 7").
    const conteudos = await conteudoDasPaginas(comExtrato);
    for (const [i, c] of conteudos.entries()) expect(c, `página ${i + 1}`).toContain(hexWinAnsi(`Página ${i + 1} de 7`));
    expect(conteudos[3]).not.toContain(hexWinAnsi("Página 4 de 4"));
    const so = await PDFDocument.load(await gerarPdfRelatorio(t, { extratos: [{ canal: "Airbnb", bytes: extrato, paginas: "2-3" }, { canal: "Booking.com", bytes: await pdfCom(1) }] }));
    expect(so.getPageCount()).toBe(4 + 2 + 1);
    // Páginas do extrato mantêm o tamanho original (não são redesenhadas); as nossas são A4.
    expect(so.getPage(4).getSize()).toEqual({ width: 300, height: 400 });
    expect(so.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
    expect(so.getTitle()).toBe("Relatório mensal · Outubro de 2026 — Studio Mezanino");
  });

  it("gráfico com mês negativo (despesas acima da sua parte) e com todos os meses negativos: o PDF sai inteiro", async () => {
    const com = (serie: [string, number | null][]) => gerarPdfRelatorio(textosDoRelatorio({ ...base, metricas: { ...base.metricas, meses: mesesDe(serie) } }));
    expect(await paginasDe(await com([["2026-07", -350000], ["2026-08", 1200000], ["2026-09", null], ["2026-10", 72250]]))).toBe(3);
    expect(await paginasDe(await com([["2026-09", -1500000], ["2026-10", -20000]]))).toBe(3);
  });

  it("extrato que não abre: erro claro, nada gerado", async () => {
    const quebrado = new TextEncoder().encode("%PDF-1.7 isto não é um pdf");
    await expect(gerarPdfRelatorio(textosDoRelatorio(base), { extrato: { bytes: quebrado } })).rejects.toThrow("Não foi possível ler o PDF do extrato (Canal).");
  });

  it("nomes com caracteres fora da fonte (emoji, outros alfabetos) não quebram o PDF", async () => {
    const t = textosDoRelatorio({ ...base, proprietarios: ["Dona 😀 李"], partes: [parte({ hospede: "Žofia 🌴" })], reservas: [{ ...base.reservas[0], hospede: "Žofia 🌴" }] });
    expect(await paginasDe(await gerarPdfRelatorio(t))).toBe(3);
  });

  it("muitas linhas em 'como chega até você' e muitos avisos: o que não cabe na capa continua nas páginas seguintes, nada abaixo do rodapé", async () => {
    const partes = Array.from({ length: 60 }, (_, i) => parte({ reservaId: `r${i}`, codigo: `R${i}`, situacao: "a_liberar", motivo: "A empresa ainda não registrou o recebimento desta reserva.", pagamento: null }));
    const t = textosDoRelatorio({ ...base, partes });
    expect(t.comoChega.linhas.length).toBeGreaterThan(50);
    const conteudos = await conteudoDasPaginas(await gerarPdfRelatorio(t));
    const ys = conteudos.flatMap((c) => [...c.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) tm/g)].map((m) => Number(m[2])));
    expect(ys.length).toBeGreaterThan(100);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20);
    const tudo = conteudos.join("\n");
    expect(tudo).toContain(hexWinAnsi("Como chega até você (continuação)"));
    expect(tudo).toContain(hexWinAnsi("Avisos (continuação)"));
    // Poucas linhas: tudo na caixa da capa, sem continuação.
    expect((await conteudoDasPaginas(await gerarPdfRelatorio(textosDoRelatorio(base)))).join("\n")).not.toContain(hexWinAnsi("(continuação)"));
  });

  it("muitas reservas: a tabela continua nas páginas seguintes, antes da conciliação e dos anexos", async () => {
    const partes = Array.from({ length: 70 }, (_, i) => parte({ reservaId: `r${i}`, codigo: `R${i}` }));
    const n = await paginasDe(await gerarPdfRelatorio(textosDoRelatorio({ ...base, partes }), { extrato: { bytes: await pdfCom(1) } }));
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it("referências de página: reservas que transbordam a página 2 levam a capa, a linha das despesas e a nota dos anexos para onde a conciliação começou", async () => {
    const comDespesa: DadosRelatorio = { ...base, resumo: { ...base.resumo, despesas: 5000 }, despesas: [{ data: "2026-10-12", descricao: "Troca do chuveiro", valor: 5000 }] };
    const secoes = (cs: string[]) => ({ numeros: cs.findIndex((c) => c.includes(hexWinAnsi("Números e reservas do mês"))) + 1, conciliacao: cs.findIndex((c) => c.includes(hexWinAnsi("Conciliação e repasses"))) + 1 });
    const extrato = { extrato: { bytes: await pdfCom(1) } };
    // Poucas reservas: as seções nas páginas 2 e 3, como os textos já dizem; nada muda.
    const t = textosDoRelatorio(comDespesa);
    expect(comPaginas(t, PAGINAS_PADRAO)).toBe(t);
    const poucas = await conteudoDasPaginas(await gerarPdfRelatorio(t, extrato));
    expect(secoes(poucas)).toEqual({ numeros: 2, conciliacao: 3 });
    expect(poucas[0]).toContain(hexWinAnsi("conciliação e repasses na 3"));
    // Oito reservas: a tabela continua na folha seguinte e a conciliação começa depois dela.
    const partes = Array.from({ length: 8 }, (_, i) => parte({ reservaId: `r${i}`, codigo: `R${i}` }));
    const muitas = await conteudoDasPaginas(await gerarPdfRelatorio(textosDoRelatorio({ ...comDespesa, partes }), extrato));
    const s = secoes(muitas);
    expect(s.numeros).toBe(2);
    expect(s.conciliacao).toBeGreaterThan(3);
    expect(muitas[0]).toContain(hexWinAnsi(`conciliação e repasses na ${s.conciliacao}`));
    expect(muitas[0]).toContain(hexWinAnsi(`detalhe na página ${s.conciliacao})`));
    expect(muitas[0]).not.toContain(hexWinAnsi("página 3"));
    expect(muitas.join("\n")).toContain(hexWinAnsi(`(página ${s.conciliacao})`));
    expect(muitas.join("\n")).not.toContain(hexWinAnsi("(página 3)"));
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


  /** Cria a reserva e registra o recebimento integral (M4.10: só o dinheiro já com a empresa entra no repasse). */
  async function criarRecebida(dados: Parameters<typeof criarReserva>[2]) {
    const r = await criarReserva(db, org, dados, null);
    if (!r.ok) throw new Error(JSON.stringify(r.erros));
    await receberTudo(db, org, r.reserva.id, dados.checkin);
    return r.reserva;
  }

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
    await criarRecebida(reserva(a));
    await criarRecebida(reserva(b, { hospedeNome: "Outra Pessoa" }));
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

  it("sem início do sistema definido, o mês do ano anterior conta como 'com dado' quando há lançamento nele (comparação ano a ano)", async () => {
    const pedir = () => dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" });
    expect((await pedir()).metricas.anoAnterior).toBeNull();
    await lancar(db, org, [{ tipo: "ajuste", descricao: "crédito antigo", valor: 10000, efeitoSaldo: 10000, competencia: "2025-10-15", estado: "realizado", dataCaixa: "2025-10-15", imovelId: a, proprietarioId: dona }], null);
    const d = await pedir();
    expect(d.metricas.anoAnterior).toMatchObject({ mes: "2025-10" });
    // O mês de 11 meses atrás (sem lançamento) continua sem dado; a série não ganha valor por isso.
    expect(d.metricas.meses.find(([m]) => m === "2025-11")?.[1]).toBeNull();
  });

  it("noites para vender contam só desde o vínculo do imóvel; o vínculo depois do mês não dá noite nenhuma", async () => {
    const pedir = () => dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" });
    const d1 = await pedir();
    expect(d1.metricas.atual).toMatchObject({ imoveis: 1, noitesDoPeriodo: 31 });
    // Vínculo criado no dia 11/10 (dia em São Paulo): outubro tem 21 noites de imóvel para vender, não 31.
    await db.update(proprietarioImoveis).set({ criadoEm: new Date("2026-10-11T12:00:00-03:00") }).where(eq(proprietarioImoveis.imovelId, a));
    const d2 = await pedir();
    // A estadia de 10 a 13/10 conta só as noites dentro da posse (11 e 12), e o bruto da diária acompanha (dois terços).
    expect(d2.metricas.atual).toMatchObject({ diasImovel: 21, noitesOcupadas: 2, bruto: 66667 });
    expect(d1.metricas.atual).toMatchObject({ noitesOcupadas: 3, bruto: 100000 });
    expect(d1.metricas.atual.diasImovel).toBeGreaterThan(21);
    // Vínculo depois do mês: nenhuma noite para vender nem ocupada em outubro (a estadia fica fora da posse; ocupação e
    // diária "não se aplicam"); o dinheiro continua na capa, pelo livro.
    await db.update(proprietarioImoveis).set({ criadoEm: new Date("2026-11-05T12:00:00-03:00") }).where(eq(proprietarioImoveis.imovelId, a));
    const d3 = await pedir();
    expect(d3.metricas.atual).toMatchObject({ diasImovel: 0, noitesOcupadas: 0, bruto: 0 });
    expect(d3.resumo.receitaBruta).toBe(100000);
    // Troca de dono em 11/10 (o vínculo da Dona é apagado; o do Outro nasce em 11/10): o relatório da Dona, que entra pelo
    // livro, conta só até 10/10 (10 noites); o do Outro, de 11/10 em diante (21). O bloqueio de uso próprio que a Dona
    // fez antes da troca continua no relatório dela (3 noites bloqueadas, 7 disponíveis) e não no do Outro.
    expect((await criarBloqueio(db, org, { imovelId: a, inicio: "2026-10-05", fim: "2026-10-08", motivo: "Uso próprio" }, null, { fonte: "proprietario", semReserva: true, proprietarioId: dona })).ok).toBe(true);
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a, criadoEm: new Date("2026-10-11T12:00:00-03:00") });
    // A estadia de 10 a 13/10 atravessa a troca: a Dona conta só a noite de 10/10 (1 de 10 para vender, não 3) e um
    // terço do bruto na diária; o Outro conta as duas noites depois da troca (11 e 12) e dois terços do bruto, embora o
    // dinheiro dessa reserva esteja no livro da Dona (a estadia é fato do imóvel; o dinheiro segue o livro).
    expect((await pedir()).metricas.atual).toMatchObject({ diasImovel: 10, noitesBloqueadas: 3, noitesOcupadas: 1, bruto: 33333 });
    const pedirOutro = () => dadosDoRelatorio(db, org, { donos: [{ id: outro, nome: "Outro Fictício" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: false, ano: 2026, mes: 10, hoje: "2026-11-02" });
    const doOutro = await pedirOutro();
    expect(doOutro.metricas.atual).toMatchObject({ diasImovel: 21, noitesBloqueadas: 0, noitesOcupadas: 2, bruto: 66667 });
    expect(doOutro.resumo.receitaBruta).toBe(0);
    // Com o histórico do painel ("proprietario.imoveis"), o imóvel que volta à Dona em 1/12 não apaga a posse antiga:
    // outubro da Dona continua com 10 noites (perdeu em 11/10), e o do Outro com 21 (ganhou em 11/10, perdeu em 1/12).
    const h = (entidadeId: string, antes: string[], depois: string[], quando: string) => ({ organizacaoId: org, usuarioId: null, acao: "proprietario.imoveis", entidade: "proprietario", entidadeId, mudancas: { imoveis: [antes, depois] }, criadoEm: new Date(quando) });
    await db.insert(auditoria).values([h(dona, [a], [], "2026-10-11T12:00:00-03:00"), h(outro, [], [a], "2026-10-11T12:00:00-03:00"), h(outro, [a], [], "2026-12-01T12:00:00-03:00"), h(dona, [], [a], "2026-12-01T12:00:00-03:00")]);
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: a, criadoEm: new Date("2026-12-01T12:00:00-03:00") });
    expect((await pedir()).metricas.atual).toMatchObject({ diasImovel: 10, noitesBloqueadas: 3, noitesOcupadas: 1, bruto: 33333 });
    expect((await pedirOutro()).metricas.atual).toMatchObject({ diasImovel: 21, noitesBloqueadas: 0, noitesOcupadas: 2, bruto: 66667 });
  });

  it("antecipado de outubro que pagou uma reserva de julho: a capa mostra o Pix inteiro (como a tabela de repasses), com as noites de julho discriminadas", async () => {
    // Reserva de julho recebida e ainda fora de repasse; o antecipado de 6/10 a leva (a de outubro ainda não entrou).
    await criarRecebida(reserva(a, { checkin: "2026-07-10", checkout: "2026-07-13", hospedeNome: "Júlia Fictícia" }));
    const g = await gerarAntecipado(db, org, dona, "2026-10-06", null);
    if (!g.ok) throw new Error(g.erro);
    const d = await dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" });
    expect(d.repasses.map((r) => r.id)).toEqual([g.id]);
    expect(d.partes.some((p) => p.mes === "2026-07" && p.repasse?.id === g.id)).toBe(true);
    const textos = textosDoRelatorio(d).comoChega.linhas.map((l) => l.texto);
    expect(textos).toContain("Repasse antecipado de 6/10 a pagar (Júlia)");
    expect(textos).toContain("Desse valor, 3 noites de julho de 2026 da reserva de Júlia (10/7 → 13/7), pagas junto: entram no resultado de julho de 2026");
  });

  it("relatório de parte dos imóveis do dono: só os repasses com reserva desses imóveis; sem filtro, todos", async () => {
    // A Dona ganha um segundo imóvel (c) com uma reserva de 5 a 7/10, recebida. O antecipado de 6/10 paga só a de c (a de
    // a ainda não entrou); o de 14/10 paga a de a.
    const [{ id: c }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "205", nome: "Studio Jardim" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: c });
    await criarContrato(db, org, c, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await criarRecebida(reserva(c, { checkin: "2026-10-05", checkout: "2026-10-07", hospedeNome: "Gabi Fictícia" }));
    const so_c = await gerarAntecipado(db, org, dona, "2026-10-06", null);
    const so_a = await gerarAntecipado(db, org, dona, "2026-10-14", null);
    if (!so_c.ok || !so_a.ok) throw new Error("antecipados");
    const donos = [{ id: dona, nome: "Dona Fictícia" }];
    expect((await repassesDoRelatorio(db, org, donos, "2026-10", [a])).repasses.map((r) => r.id)).toEqual([so_a.id]);
    expect((await repassesDoRelatorio(db, org, donos, "2026-10", [c])).repasses.map((r) => r.id)).toEqual([so_c.id]);
    expect((await repassesDoRelatorio(db, org, donos, "2026-10")).repasses.map((r) => r.id)).toEqual([so_c.id, so_a.id]);
    // O relatório só do imóvel a não lista o Pix da Gabi; o de todos os imóveis lista os dois.
    const soA = await dadosDoRelatorio(db, org, { donos, imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: false, ano: 2026, mes: 10, hoje: "2026-11-02" });
    expect(soA.repasses.map((r) => r.reservas)).toEqual([["Hóspede"]]);
  });

  it("repasses do mês pela data do Pix: antecipado programado para 31/10 e pago em 1/11 é de novembro, na tabela e na capa", async () => {
    const g = await gerarAntecipado(db, org, dona, "2026-10-31", null);
    if (!g.ok) throw new Error(g.erro);
    const pago = await marcarRepassePago(db, org, g.id, "2026-11-01", "2026-11-02", null, { texto: "", arquivo: { nome: "pix.png", tipo: "image/png", conteudo: Buffer.from(PNG) } });
    if (!pago.ok) throw new Error(pago.erro);
    const donos = [{ id: dona, nome: "Dona Fictícia" }];
    expect((await repassesDoRelatorio(db, org, donos, "2026-10")).repasses).toEqual([]);
    expect((await repassesDoRelatorio(db, org, donos, "2026-11")).repasses).toMatchObject([{ id: g.id, data: "2026-10-31", dataPagamento: "2026-11-01", situacao: "pago", valor: 72250 }]);
    // No relatório de outubro, a parte aparece como repassada em 1/11 (informação); o Pix inteiro fica no de novembro.
    const out = textosDoRelatorio(await dadosDoRelatorio(db, org, { donos, imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" }));
    expect(out.comoChega.linhas.map((l) => l.texto)).toEqual(["Já repassado em 1/11 (repasse antecipado de novembro de 2026): 3 noites de outubro de 2026 da reserva de Hóspede (10/10 → 13/10)"]);
    expect(out.repasses.map((l) => l.texto)).toEqual([]);
  });

  it("diária pelo bruto do livro: a reserva que mudou de valor depois de movimentar dinheiro (divergente) usa o valor protegido", async () => {
    const pedir = () => dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" });
    // O livro guarda R$ 1.000,00; a reserva passa a dizer R$ 2.000,00 e fica divergente (o motor não refaz o livro).
    await db.update(reservas).set({ valorBruto: 200000, divergenciaEm: new Date("2026-10-20T12:00:00-03:00") }).where(eq(reservas.imovelId, a));
    const d = await pedir();
    expect(d.metricas.atual).toMatchObject({ noitesOcupadas: 3, bruto: 100000 });
    expect(diariaMedia(d.metricas.atual.bruto, d.metricas.atual.noitesOcupadas)).toBe(33333);
  });

  it("sem início do sistema definido, mês com estadia confirmada fora do livro entra no gráfico de ocupação; o resultado dele continua sem dado", async () => {
    // Estadia de 10 a 14/8 (R$ 800,00) gravada sem passar pelo livro (importada, sem lançamento); o imóvel é da Dona desde 2025.
    await db.update(proprietarioImoveis).set({ criadoEm: new Date("2025-01-01T12:00:00-03:00") }).where(eq(proprietarioImoveis.imovelId, a));
    const [r1] = await db.select({ codigo: reservas.codigo }).from(reservas).where(eq(reservas.imovelId, a));
    await db.insert(reservas).values({ organizacaoId: org, imovelId: a, codigo: `${r1.codigo}-AGO`, origem: "airbnb", estado: "confirmada", checkin: "2026-08-10", checkout: "2026-08-14", hospedeNome: "Hóspede de Agosto Fictício", valorBruto: 80000 });
    const d = await dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" });
    const agosto = new Map(d.metricas.meses).get("2026-08");
    expect(agosto).toMatchObject({ noitesOcupadas: 4, bruto: 80000, resultado: null });
    const t = textosDoRelatorio(d);
    expect(t.graficoOcupacao.serie.find((p) => p.mes === "2026-08")).toMatchObject({ semOcupacao: null, diaria: 20000 });
    expect(t.grafico.serie.find((p) => p.mes === "2026-08")).toMatchObject({ resultado: null });
    // Julho, sem estadia nem livro, continua sem dado nos dois.
    expect(t.graficoOcupacao.serie.find((p) => p.mes === "2026-07")).toMatchObject({ semOcupacao: "sem_dado" });
  });

  it("sem início do sistema definido, mês todo bloqueado para uso próprio (sem estadia nem livro) aparece como bloqueado, não como sem dado", async () => {
    await db.update(proprietarioImoveis).set({ criadoEm: new Date("2025-01-01T12:00:00-03:00") }).where(eq(proprietarioImoveis.imovelId, a));
    // Julho inteiro bloqueado pela Dona; um bloqueio da equipe em junho não é dela e não põe junho no gráfico.
    await db.insert(bloqueios).values([
      { organizacaoId: org, imovelId: a, inicio: "2026-07-01", fim: "2026-08-01", motivo: "Uso próprio", fonte: "proprietario", proprietarioId: dona },
      { organizacaoId: org, imovelId: a, inicio: "2026-06-10", fim: "2026-06-12", motivo: "Manutenção", fonte: "manual" },
    ]);
    const d = await dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" });
    expect(new Map(d.metricas.meses).get("2026-07")).toMatchObject({ noitesBloqueadas: 31, noitesOcupadas: 0, resultado: null });
    const t = textosDoRelatorio(d);
    expect(t.graficoOcupacao.serie.find((p) => p.mes === "2026-07")).toMatchObject({ ocupacao: null, semOcupacao: "bloqueado" });
    expect(t.grafico.serie.find((p) => p.mes === "2026-07")).toMatchObject({ resultado: null });
    expect(t.graficoOcupacao.serie.find((p) => p.mes === "2026-06")).toMatchObject({ semOcupacao: "sem_dado" });
  });

  it("mês em que o imóvel ainda não era do dono aparece como fora da posse, não como bloqueado", async () => {
    // A Dona tem o imóvel desde 15/9; a estadia de agosto foi do dono anterior.
    await db.update(proprietarioImoveis).set({ criadoEm: new Date("2026-09-15T12:00:00-03:00") }).where(eq(proprietarioImoveis.imovelId, a));
    const [r1] = await db.select({ codigo: reservas.codigo }).from(reservas).where(eq(reservas.imovelId, a));
    await db.insert(reservas).values({ organizacaoId: org, imovelId: a, codigo: `${r1.codigo}-AGO`, origem: "airbnb", estado: "confirmada", checkin: "2026-08-10", checkout: "2026-08-14", hospedeNome: "Hóspede de Agosto Fictício", valorBruto: 80000 });
    const d = await dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" });
    expect(new Map(d.metricas.meses).get("2026-08")).toMatchObject({ diasImovel: 0, noitesOcupadas: 0 });
    const t = textosDoRelatorio(d);
    expect(t.graficoOcupacao.serie.find((p) => p.mes === "2026-08")).toMatchObject({ ocupacao: null, semOcupacao: "fora_da_posse" });
  });

  it("duas reservas sobrepostas no mesmo imóvel (overbooking importado): a noite disputada conta uma vez nas noites e no bruto", async () => {
    // A de 10 a 13/10 (R$ 1.000,00, no livro) e outra de 12 a 14/10 (R$ 600,00, fora do livro): a noite de 12 fica com a
    // primeira; a segunda conta só a de 13 (R$ 300,00). 4 noites e R$ 1.300,00, não 5 noites com R$ 1.600,00.
    const [r1] = await db.select({ id: reservas.id, codigo: reservas.codigo }).from(reservas).where(eq(reservas.imovelId, a));
    await db.insert(reservas).values({ organizacaoId: org, imovelId: a, codigo: `${r1.codigo}-B`, origem: "booking", estado: "confirmada", checkin: "2026-10-12", checkout: "2026-10-14", hospedeNome: "Outro Hóspede Fictício", valorBruto: 60000 });
    const d = await dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" });
    expect(d.metricas.atual).toMatchObject({ noitesOcupadas: 4, bruto: 100000 + 30000 });
  });

  it("noite bloqueada para uso próprio dentro de uma estadia confirmada sai das noites ocupadas e do bruto da diária", async () => {
    // Estadia de 10 a 13/10 (R$ 1.000,00) com a noite de 12/10 bloqueada pela Dona (bloqueio e estadia importados juntos: o
    // portal não deixa bloquear por cima de hóspede, mas a importação pode trazer os dois): 2 noites contadas e dois terços do bruto.
    expect((await criarBloqueio(db, org, { imovelId: a, inicio: "2026-10-12", fim: "2026-10-13", motivo: "Uso próprio" }, null, { fonte: "proprietario", proprietarioId: dona })).ok).toBe(true);
    const d = await dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02" });
    expect(d.metricas.atual).toMatchObject({ noitesOcupadas: 2, noitesBloqueadas: 1, bruto: 66667 });
    expect(diariaMedia(d.metricas.atual.bruto, d.metricas.atual.noitesOcupadas)).toBe(33334);
  });

  it("mês parcial: a diária média usa o bruto das noites já passadas (proporcional por noite), não o bruto do mês inteiro", async () => {
    const pedir = (hoje: string) => dadosDoRelatorio(db, org, { donos: [{ id: dona, nome: "Dona Fictícia" }], imoveis: [{ id: a, codigo: "403", nome: "Studio Mezanino" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje });
    // Reserva de 10 a 13/10: 3 noites, bruto R$ 1.000,00. Mês fechado: tudo conta.
    const fechado = (await pedir("2026-11-02")).metricas.atual;
    expect(fechado).toMatchObject({ bruto: 100000, noitesOcupadas: 3, resultado: 72250 });
    expect(diariaMedia(fechado.bruto, fechado.noitesOcupadas)).toBe(33333);
    // Posição de 11/10: duas noites passadas (10 e 11) e dois terços do bruto — a diária fica a mesma, não R$ 500,00.
    // O resultado do mês parcial segue a mesma conta (dois terços da sua parte), para a barra e o acumulado não
    // contarem noites futuras; o da capa (o mês inteiro, "parcial até o fim do mês") não muda.
    const parcialTodo = await pedir("2026-10-11");
    const parcial = parcialTodo.metricas.atual;
    expect(parcial).toMatchObject({ bruto: 66667, noitesOcupadas: 2, resultado: 48167 });
    expect(parcialTodo.resumo.suaParte).toBe(72250);
    expect(diariaMedia(parcial.bruto, parcial.noitesOcupadas)).toBe(33334);
    // Antes do check-in: nenhuma noite e nenhum bruto; a diária não aparece; o resultado até o dia é zero.
    expect((await pedir("2026-10-05")).metricas.atual).toMatchObject({ bruto: 0, noitesOcupadas: 0, resultado: 0 });
    // Uma despesa do imóvel datada de 20/10 entra no resultado parcial de 25/10, não no de 11/10; no mês inteiro, sempre.
    const c = await criarCategoria(db, org, "Manutenção", null);
    if (!c.ok) throw new Error("categoria");
    await registrarDespesa(db, org, { responsavel: "proprietario", pagoPor: "empresa", categoriaId: c.categoria.id, descricao: "Reparo", valor: 1000, data: "2026-10-20", imovelId: a, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-20" }, null);
    expect((await pedir("2026-10-11")).metricas.atual.resultado).toBe(48167);
    expect((await pedir("2026-10-25")).metricas.atual.resultado).toBe(72250 - 1000);
    expect((await pedir("2026-11-02")).metricas.atual.resultado).toBe(72250 - 1000);
  });

  it("portal: só o proprietário, só o mês, só dentro da janela; imóvel de outro é ignorado", async () => {
    expect(await relatorioDoPortal(db, admin(), { ano: "2026", mes: "10" }, AGORA)).toMatchObject({ ok: false, status: 403 });
    expect(await relatorioDoPortal(db, null, { ano: "2026", mes: "10" }, AGORA)).toMatchObject({ ok: false, status: 403 });
    expect(await relatorioDoPortal(db, donaUsuario, { ano: "2026", mes: "todos" }, AGORA)).toMatchObject({ ok: false, status: 400 });
    expect(await relatorioDoPortal(db, donaUsuario, { ano: "2020", mes: "1" }, AGORA)).toMatchObject({ ok: false, status: 400 });
    const r = await relatorioDoPortal(db, donaUsuario, { ano: "2026", mes: "10", imovel: ["102"] }, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect(r.arquivo).toBe("relatorio-2026-10-403.pdf");
    expect(await paginasDe(r.pdf)).toBe(3);
  });

  it("portal: quem representa dois proprietários recebe no PDF só o dono do imóvel escolhido", async () => {
    await db.insert(proprietarioUsuarios).values({ proprietarioId: outro, usuarioId: donaUsuario.usuarioId });
    const donos = [
      { id: dona, nome: "Dona Fictícia" },
      { id: outro, nome: "Outro Fictício" },
    ];
    // Só o 403: só a dona, e é tudo dela (entram os lançamentos sem imóvel dela).
    expect(await donosDosEscolhidos(db, donos, [{ id: a }])).toEqual({ donos: [donos[0]], imoveis: [{ id: a }], todosOsImoveis: true });
    // Os dois imóveis: os dois donos.
    expect(await donosDosEscolhidos(db, donos, [{ id: a }, { id: b }])).toEqual({ donos, imoveis: [{ id: a }, { id: b }], todosOsImoveis: true });
    // E o PDF sai normalmente.
    const r = await relatorioDoPortal(db, { ...donaUsuario, imovelIds: [a, b] }, { ano: "2026", mes: "10", imovel: ["403"] }, AGORA);
    expect(r).toMatchObject({ ok: true, arquivo: "relatorio-2026-10-403.pdf" });
  });

  it("portal: mês de antes de uma troca de dono fica com o dono daquele mês (pelo livro), não com o atual", async () => {
    // O 403 passou da dona para o outro em 15/11; o mesmo usuário representa os dois.
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a, criadoEm: new Date("2026-11-15T12:00:00Z") });
    const donos = [
      { id: dona, nome: "Dona Fictícia" },
      { id: outro, nome: "Outro Fictício" },
    ];
    const outubro = { inicio: "2026-10-01", fim: "2026-11-01" };
    const dezembro = { inicio: "2026-12-01", fim: "2027-01-01" };
    expect((await donosDosEscolhidos(db, donos, [{ id: a }], outubro)).donos).toEqual([donos[0]]);
    expect((await donosDosEscolhidos(db, donos, [{ id: a }], dezembro)).donos).toEqual([donos[1]]);
  });

  it("lançamento estornado (e o estorno) não provam de quem era o imóvel", async () => {
    // Lançamento do outro no 403 em outubro, depois estornado (correção de dono).
    const [l] = await db
      .insert(lancamentos)
      .values({ organizacaoId: org, tipo: "direito_proprietario", descricao: "x", valor: 100, competencia: "2026-10-05", imovelId: a, proprietarioId: outro })
      .returning();
    await db.insert(lancamentos).values({ organizacaoId: org, tipo: "direito_proprietario", descricao: "estorno", valor: -100, competencia: "2026-10-05", imovelId: a, proprietarioId: outro, estornoDe: l.id });
    const donos = [
      { id: dona, nome: "Dona Fictícia" },
      { id: outro, nome: "Outro Fictício" },
    ];
    expect((await donosDosEscolhidos(db, donos, [{ id: a }], { inicio: "2026-10-01", fim: "2026-11-01" })).donos).toEqual([donos[0]]);
    expect((await imoveisDoProprietario(db, org, outro, { inicio: "2026-10-01", fim: "2026-11-01" })).map((i) => i.codigo)).toEqual(["102"]);
  });

  it("portal: imóvel que ainda não era dele no mês sai do relatório daquele mês", async () => {
    // O 102 passou a ser da dona só em 15/11 (antes, era do outro).
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, b));
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: b, criadoEm: new Date("2026-11-15T12:00:00Z") });
    const sessao: Sessao = { ...donaUsuario, imovelIds: [a, b] };
    const r = await relatorioDoPortal(db, sessao, { ano: "2026", mes: "10" }, AGORA);
    // Outubro: só o 403 (o 102 ainda não era dela; o lançamento de outubro do 102 é do outro).
    expect(r).toMatchObject({ ok: true, arquivo: "relatorio-2026-10-403.pdf" });
    expect(await relatorioDoPortal(db, sessao, { ano: "2026", mes: "10", imovel: ["102"] }, AGORA)).toMatchObject({ ok: false, status: 400 });
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

  it("painel: imóvel ligado depois do mês não entra no relatório daquele mês", async () => {
    // O vínculo da dona foi criado agora; num mês que acabou antes disso, sem lançamento dela, não há imóvel.
    const r = await relatorioDoPainel(db, admin(), dona, { mes: "2025-01", imoveis: [], anexos: {} }, AGORA);
    expect(r).toMatchObject({ ok: false, status: 400, erro: expect.stringContaining("neste mês") });
    expect(await relatorioDoPainel(db, admin(), dona, { mes: "2025-01", imoveis: ["403"], anexos: {} }, AGORA)).toMatchObject({ ok: false, status: 400 });
  });

  it("painel: ex-proprietário continua com o relatório dos meses em que o imóvel era dele", async () => {
    // O 403 passa para outro dono: o vínculo da dona é apagado, o livro de outubro continua dela.
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a });
    const r = await relatorioDoPainel(db, admin(), dona, { mes: "2026-10", imoveis: ["403"], anexos: {} }, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect(r.arquivo).toBe("relatorio-2026-10-403.pdf");
    // Num mês sem lançamento dela e sem vínculo: avisa em vez de gerar um relatório vazio.
    expect(await relatorioDoPainel(db, admin(), dona, { mes: "2026-12", imoveis: [], anexos: {} }, AGORA)).toMatchObject({ ok: false, status: 400 });
    // Imóvel que nunca foi dela continua recusado.
    expect(await relatorioDoPainel(db, admin(), dona, { mes: "2026-10", imoveis: ["102"], anexos: {} }, AGORA)).toMatchObject({ ok: false, status: 400 });
  });

  it("painel: gera com extrato, registra no histórico sem o conteúdo; extrato inválido não registra nada", async () => {
    const ruim = await relatorioDoPainel(db, admin(), dona, { mes: "2026-10", imoveis: [], anexos: { extrato: { bytes: new TextEncoder().encode("%PDF-xx") } } }, AGORA);
    expect(ruim).toMatchObject({ ok: false, status: 400 });
    const historico = () => db.select().from(auditoria).where(eq(auditoria.acao, "relatorio.pdf"));
    expect(await historico()).toHaveLength(0);
    const r = await relatorioDoPainel(db, admin(), dona, { mes: "2026-10", imoveis: ["403"], anexos: { foto: PNG, extrato: { bytes: await pdfCom(2), paginas: "2" } } }, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect(await paginasDe(r.pdf)).toBe(5);
    const [h] = await historico();
    expect(h).toMatchObject({ acao: "relatorio.pdf", entidade: "proprietario", entidadeId: dona });
    expect(h.mudancas).toEqual({ relatorio: [null, "2026-10 · 403"], anexos: [null, "foto e extrato"] });
  });

  it("capa (M7.3): a primeira foto da ficha do imóvel entra no portal, no painel e no fechamento; foto guardada ilegível não impede o relatório", async () => {
    const EM_BREVE = hexWinAnsi("foto do imóvel");
    const capaDe = async (pdf: Uint8Array) => (await conteudoDasPaginas(pdf))[0];
    const portal = async () => {
      const r = await relatorioDoPortal(db, donaUsuario, { ano: "2026", mes: "10" }, AGORA);
      if (!r.ok) throw new Error(r.erro);
      return r.pdf;
    };
    // Sem foto na ficha: o quadro "foto do imóvel — em breve".
    expect(await capaDe(await portal())).toContain(EM_BREVE);
    expect(await guardarFoto(db, org, { imovelId: a, arquivo: { nome: "sala.png", conteudo: PNG } }, null)).toMatchObject({ ok: true });
    expect(await capaDe(await portal())).not.toContain(EM_BREVE);
    // Painel sem foto no formulário: usa a do cadastro e o histórico diz qual foi.
    const painel = await relatorioDoPainel(db, admin(), dona, { mes: "2026-10", imoveis: [], anexos: {} }, AGORA);
    if (!painel.ok) throw new Error(painel.erro);
    expect(await capaDe(painel.pdf)).not.toContain(EM_BREVE);
    const [h] = await db.select().from(auditoria).where(eq(auditoria.acao, "relatorio.pdf"));
    expect(h.mudancas).toMatchObject({ anexos: [null, "foto do cadastro"] });
    // E-mail do fechamento: a mesma capa.
    const fechamento = await relatorioDoFechamento(db, org, dona, "2026-10", AGORA);
    if (!fechamento.ok) throw new Error(fechamento.erro);
    expect(await capaDe(fechamento.pdf)).not.toContain(EM_BREVE);
    // O 102 (de outro dono) tem foto boa; ela nunca vai para o relatório da dona, nem quando a capa do 403 falha (abaixo).
    await guardarFoto(db, org, { imovelId: b, arquivo: { nome: "outro.png", conteudo: PNG } }, null);
    // Foto que passa na conferência (começa como PNG) mas o PDF não lê: o relatório sai inteiro, com "em breve".
    const ruim = await guardarFoto(db, org, { imovelId: a, arquivo: { nome: "ruim.png", conteudo: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) } }, null);
    if (!ruim.ok) throw new Error(ruim.erro);
    await usarComoCapa(db, org, ruim.id, null);
    expect((await listarFotos(db, org, a))[0].id).toBe(ruim.id);
    expect(await capaDe(await portal())).toContain(EM_BREVE);
    const doFechamento = await relatorioDoFechamento(db, org, dona, "2026-10", AGORA);
    expect(doFechamento.ok).toBe(true);
  });
});
