import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { arquivos, imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { extratosDoRelatorio, guardarExtrato, listarExtratos, removerExtrato } from "./extratos";

let db: Db, close: () => Promise<void>, org: string, outraOrg: string, a: string, b: string, deOutra: string;

async function pdfCom(paginas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) doc.addPage([200, 200]);
  return doc.save();
}
const arquivo = async (paginas = 2, nome = "ganhos-outubro.pdf") => ({ nome, tipo: "application/pdf", conteudo: await pdfCom(paginas) });
const guardar = (imovelId: string, canal: string, paginas = "", mes = "2026-10", arq?: Awaited<ReturnType<typeof arquivo>>) => guardarExtrato(db, org, { imovelId, mes, canal, paginas, arquivo: arq ?? { nome: "extrato.pdf", tipo: "application/pdf", conteudo: new Uint8Array() } }, null);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: a }, { id: b }, { id: deOutra }] = await db
    .insert(imoveis)
    .values([{ organizacaoId: org, codigo: "403", nome: "Quatro" }, { organizacaoId: org, codigo: "102", nome: "Um" }, { organizacaoId: outraOrg, codigo: "900", nome: "De outra" }])
    .returning();
});
afterEach(() => close());

describe("extratos oficiais dos canais guardados por imóvel e mês (M5.7)", () => {
  it("guarda um PDF por imóvel, mês e canal; subir de novo substitui (e apaga o arquivo antigo); o histórico registra", async () => {
    const r = await guardar(a, "airbnb", "2", "2026-10", await arquivo(2));
    expect(r).toMatchObject({ ok: true, substituiu: false, paginasTotal: 2 });
    const lista = await listarExtratos(db, org, "2026-10");
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ imovelCodigo: "403", imovelNome: "Quatro", canal: "airbnb", canalNome: "Airbnb", paginas: "2", arquivoNome: "ganhos-outubro.pdf", mes: "2026-10" });
    const primeiroArquivo = lista[0].arquivoId;
    // Mesmo imóvel, mês e canal: substitui; o arquivo antigo sai do banco.
    const r2 = await guardar(a, "airbnb", "", "2026-10", await arquivo(3, "ganhos-v2.pdf"));
    expect(r2).toMatchObject({ ok: true, substituiu: true, paginasTotal: 3 });
    const depois = await listarExtratos(db, org, "2026-10");
    expect(depois).toHaveLength(1);
    expect(depois[0]).toMatchObject({ arquivoNome: "ganhos-v2.pdf", paginas: "" });
    expect(await db.select({ id: arquivos.id }).from(arquivos)).toEqual([{ id: depois[0].arquivoId }]);
    expect(depois[0].arquivoId).not.toBe(primeiroArquivo);
    // Outro canal do mesmo imóvel e outro imóvel convivem; a lista sai por código do imóvel e canal.
    expect(await guardar(a, "booking", "", "2026-10", await arquivo(1))).toMatchObject({ ok: true });
    expect(await guardar(b, "airbnb", "", "2026-10", await arquivo(1))).toMatchObject({ ok: true });
    expect((await listarExtratos(db, org, "2026-10")).map((l) => `${l.imovelCodigo}/${l.canal}`)).toEqual(["102/airbnb", "403/airbnb", "403/booking"]);
    expect(await listarExtratos(db, org, "2026-09")).toEqual([]);
    const historico = (await historicoDe(db, org, "imovel", a)).filter((h) => h.acao === "extrato_canal.guardar");
    expect(historico).toHaveLength(3);
    expect(historico.map((h) => h.mudancas.extrato)).toEqual(expect.arrayContaining([[null, "Airbnb · 2026-10 · 2 página(s) (usar 2)"], ["substituído", "Airbnb · 2026-10 · 3 página(s)"]]));
  });

  it("recusa mês, canal, arquivo e páginas inválidos, e imóvel de outra organização; nada é gravado", async () => {
    const bom = await arquivo(2);
    expect(await guardar(a, "airbnb", "", "2026-13", bom)).toEqual({ ok: false, erro: "Mês inválido." });
    expect(await guardar(a, "site", "", "2026-10", bom)).toMatchObject({ ok: false, erro: expect.stringContaining("Escolha o canal") });
    expect(await guardar(a, "airbnb", "", "2026-10")).toMatchObject({ ok: false, erro: "Escolha o arquivo PDF do extrato." });
    expect(await guardar(a, "airbnb", "", "2026-10", { nome: "x.pdf", tipo: "application/pdf", conteudo: new TextEncoder().encode("%PDF-1.4 quebrado") })).toMatchObject({ ok: false, erro: expect.stringContaining("Não foi possível ler o PDF") });
    expect(await guardar(a, "airbnb", "", "2026-10", { nome: "x.png", tipo: "image/png", conteudo: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]) })).toMatchObject({ ok: false, erro: expect.stringContaining("precisa ser um PDF") });
    // Protegido por senha (trailer com /Encrypt): recusado no upload, como o relatório recusaria na hora de anexar.
    const classico = Buffer.from(await (await (async () => { const d = await PDFDocument.create(); d.addPage([200, 200]); return d; })()).save({ useObjectStreams: false })).toString("latin1");
    const protegido = Buffer.from(classico.replace(/trailer\s*<<(\s*)/, "trailer\n<< /Encrypt 1 0 R$1"), "latin1");
    expect(protegido.includes("/Encrypt")).toBe(true);
    expect(await guardar(a, "airbnb", "", "2026-10", { nome: "senha.pdf", tipo: "application/pdf", conteudo: new Uint8Array(protegido) })).toMatchObject({ ok: false, erro: expect.stringContaining("protegido por senha") });
    expect(await guardar(a, "airbnb", "", "2026-10", { nome: "grande.pdf", tipo: "application/pdf", conteudo: new Uint8Array(2 * 1024 * 1024 + 1) })).toMatchObject({ ok: false, erro: expect.stringContaining("passa de 2 MB") });
    expect(await guardar(a, "airbnb", "3", "2026-10", bom)).toMatchObject({ ok: false, erro: expect.stringContaining("tem 2 página(s), não dá para usar a 3") });
    expect(await guardar(a, "airbnb", "x", "2026-10", bom)).toMatchObject({ ok: false, erro: expect.stringContaining("não é um número nem um intervalo") });
    expect(await guardar(deOutra, "airbnb", "", "2026-10", bom)).toEqual({ ok: false, erro: "Imóvel não encontrado." });
    expect(await listarExtratos(db, org, "2026-10")).toEqual([]);
    expect(await db.select({ id: arquivos.id }).from(arquivos)).toEqual([]);
  });

  it("os anexos do relatório: só os imóveis pedidos e o mês; com mais de um imóvel o selo traz o código; outra organização não vê; remover apaga o arquivo", async () => {
    await guardar(a, "airbnb", "1", "2026-10", await arquivo(2, "airbnb-403.pdf"));
    await guardar(a, "booking", "", "2026-10", await arquivo(1, "booking-403.pdf"));
    await guardar(b, "airbnb", "", "2026-10", await arquivo(1, "airbnb-102.pdf"));
    await guardar(a, "airbnb", "", "2026-09", await arquivo(1, "airbnb-set.pdf"));
    const soA = await extratosDoRelatorio(db, org, [a], "2026-10");
    expect(soA.map((x) => [x.canal, x.nome, x.paginas, x.bytes.length > 100])).toEqual([["Airbnb", "airbnb-403.pdf", "1", true], ["Booking.com", "booking-403.pdf", "", true]]);
    const ambos = await extratosDoRelatorio(db, org, [a, b], "2026-10");
    expect(ambos.map((x) => x.canal)).toEqual(["Airbnb · 102", "Airbnb · 403", "Booking.com · 403"]);
    expect(await extratosDoRelatorio(db, org, [], "2026-10")).toEqual([]);
    expect(await extratosDoRelatorio(db, org, [a], "2026-11")).toEqual([]);
    expect(await extratosDoRelatorio(db, outraOrg, [a], "2026-10")).toEqual([]);
    expect(await listarExtratos(db, outraOrg, "2026-10")).toEqual([]);
    // Remover: só da própria organização; o arquivo vai junto.
    const [booking] = (await listarExtratos(db, org, "2026-10")).filter((l) => l.canal === "booking");
    expect(await removerExtrato(db, outraOrg, booking.id, null)).toEqual({ ok: false, erro: "Extrato não encontrado." });
    expect(await removerExtrato(db, org, "nao-e-uuid", null)).toEqual({ ok: false, erro: "Extrato não encontrado." });
    expect(await removerExtrato(db, org, booking.id, null)).toEqual({ ok: true });
    expect((await listarExtratos(db, org, "2026-10")).map((l) => l.arquivoNome)).toEqual(["airbnb-102.pdf", "airbnb-403.pdf"]);
    expect((await db.select({ id: arquivos.id }).from(arquivos)).map((x) => x.id)).not.toContain(booking.arquivoId);
    expect((await historicoDe(db, org, "imovel", a)).some((h) => h.acao === "extrato_canal.remover")).toBe(true);
  });
});
