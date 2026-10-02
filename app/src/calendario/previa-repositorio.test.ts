import { expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { auditoria, beds24Calendario, bloqueios, idsExternos, imoveis, imoveisDetalhes, organizacoes, reservas } from "@/db/schema";
import { carregarPrevia } from "./previa-repositorio";

it("lê somente imóvel/empresa/intervalo selecionados, sem contatos ou gravações", async () => {
  const { db, close } = await createTestDb();
  try {
    const [org, outra] = await db.insert(organizacoes).values([{ nome: "Empresa teste" }, { nome: "Outra" }]).returning();
    const [a, b] = await db.insert(imoveis).values([{ organizacaoId: org.id, codigo: "T1", nome: "Teste" }, { organizacaoId: outra.id, codigo: "T1", nome: "Outra" }]).returning();
    await db.insert(imoveisDetalhes).values({ organizacaoId: org.id, imovelId: a.id, precoBase: 45000, estadiaMinima: 2 });
    await db.insert(idsExternos).values({ organizacaoId: org.id, imovelId: a.id, canal: "beds24", idExterno: "100", detalhe: "200" });
    const observadoEm = new Date("2026-10-02T12:00:00Z");
    await db.insert(beds24Calendario).values([
      { organizacaoId: org.id, imovelId: a.id, data: "2026-10-02", preco: 40000, minimoNoites: 1, livres: 1, observadoEm },
      { organizacaoId: org.id, imovelId: a.id, data: "2026-10-04", preco: 99000, livres: 0, observadoEm },
      { organizacaoId: outra.id, imovelId: b.id, data: "2026-10-02", preco: 99000, livres: 0, observadoEm },
    ]);
    await db.insert(reservas).values({ organizacaoId: org.id, imovelId: a.id, codigo: "FICTICIO", origem: "direta", checkin: "2026-10-01", checkout: "2026-10-03", estado: "confirmada", hospedeNome: "Nome privado fictício", hospedeEmail: "privado@example.invalid" });
    await db.insert(bloqueios).values({ organizacaoId: org.id, imovelId: a.id, inicio: "2026-10-03", fim: "2026-10-04", motivo: "Motivo privado" });
    const p = await carregarPrevia(db, org.id, a.id, "2026-10-02", "2026-10-03", observadoEm);
    expect(p?.linhas).toHaveLength(2);
    expect(p?.linhas[0]).toMatchObject({ reservas: 1, bloqueios: 0, comparacaoPreco: "diferente", observacao: { preco: 40000 } });
    expect(p?.linhas[1]).toMatchObject({ reservas: 0, bloqueios: 1, observacao: null });
    expect(p?.vinculos).toEqual([{ propertyId: "100", roomId: "200" }]);
    expect(JSON.stringify(p)).not.toContain("privado");
    expect(await carregarPrevia(db, org.id, b.id, "2026-10-02", "2026-10-03")).toBeNull();
    expect(await carregarPrevia(db, org.id, "invalido", "2026-10-02", "2026-10-03")).toBeNull();
    expect(await db.select().from(auditoria)).toHaveLength(0);
    expect(await db.select().from(beds24Calendario)).toHaveLength(3);
  } finally { await close(); }
}, 30000);
