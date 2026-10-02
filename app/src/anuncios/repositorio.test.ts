import { afterEach, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { anuncios, auditoria, idsExternos, imoveis, imoveisDetalhes, organizacoes } from "@/db/schema";
import { listarAnuncios, salvarAnuncio } from "./repositorio";
let db: Db, close: () => Promise<void>, org: string, outra: string, imovel: string, outro: string;
const entrada = { canal: "airbnb", situacao: "publicado", titulo: "Anúncio fictício", precoBase: "250", versao: "0", conferido: "on" };
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const os = await db.insert(organizacoes).values([{ nome: "Teste A" }, { nome: "Teste B" }]).returning();
  [org, outra] = os.map(o => o.id);
  const ims = await db.insert(imoveis).values([{ organizacaoId: org, codigo: "T1", nome: "Teste" }, { organizacaoId: outra, codigo: "T1", nome: "Outra empresa" }]).returning();
  [imovel, outro] = ims.map(i => i.id);
});
afterEach(async () => { await close(); });
it("aplica migração, salva e atualiza a mesma referência com auditoria", async () => {
  expect(await salvarAnuncio(db, org, imovel, entrada, null)).toEqual({ ok: true });
  const primeira = (await listarAnuncios(db, org))[0].anuncios[0];
  expect(primeira).toMatchObject({ precoBase: 25000, versao: 1 });
  expect(primeira.conferidoEm).toBeInstanceOf(Date);
  expect(await salvarAnuncio(db, org, imovel, { ...entrada, titulo: "Revisado", versao: "1", conferido: "" }, null)).toEqual({ ok: true });
  const linhas = await db.select().from(anuncios);
  expect(linhas).toHaveLength(1);
  expect(linhas[0]).toMatchObject({ titulo: "Revisado", versao: 2, conferidoEm: null });
  expect(await db.select().from(auditoria)).toHaveLength(2);
});
it("isola empresas na leitura e escrita; IDs inválidos não alcançam o banco", async () => {
  expect((await salvarAnuncio(db, org, outro, entrada, null)).ok).toBe(false);
  expect((await salvarAnuncio(db, org, "invalido", entrada, null)).ok).toBe(false);
  await salvarAnuncio(db, outra, outro, entrada, null);
  const lista = await listarAnuncios(db, org);
  expect(lista.map(i => i.id)).toEqual([imovel]);
  expect(lista[0].anuncios).toEqual([]);
});
it("preserva vínculos, dados do site e arquivados, sem inferir anúncio dos IDs", async () => {
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: imovel, canal: "airbnb", idExterno: "FAKE" });
  await db.insert(imoveisDetalhes).values({ organizacaoId: org, imovelId: imovel, precoBase: 34500 });
  await db.update(imoveis).set({ ativo: false, descricao: "Do cadastro" }).where(eq(imoveis.id, imovel));
  let i = (await listarAnuncios(db, org))[0];
  expect(i).toMatchObject({ ativo: false, precoBase: 34500, descricao: "Do cadastro", anuncios: [], vinculos: [{ idExterno: "FAKE" }] });
  await salvarAnuncio(db, org, imovel, entrada, null);
  i = (await listarAnuncios(db, org))[0];
  expect(i.precoBase).toBe(34500);
  expect(i.vinculos[0].idExterno).toBe("FAKE");
});
it("recusa formulário desatualizado e não perde a alteração anterior", async () => {
  await salvarAnuncio(db, org, imovel, entrada, null);
  expect(await salvarAnuncio(db, org, imovel, { ...entrada, titulo: "Sobrescrever" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("outra tela") });
  expect((await listarAnuncios(db, org))[0].anuncios[0].titulo).toBe(entrada.titulo);
  expect(await db.select().from(auditoria)).toHaveLength(1);
});
it("auditoria e referência são atômicas; falha não deixa gravação parcial", async () => {
  await expect(salvarAnuncio(db, org, imovel, entrada, "00000000-0000-4000-8000-000000000001")).rejects.toThrow();
  expect(await db.select().from(anuncios)).toHaveLength(0);
});
