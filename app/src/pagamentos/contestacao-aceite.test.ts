/**
 * Disputa do pagamento no site (M8.2e) — aceite final depois da revisão (11/10/2026): o que um corretor deixou para a área
 * de outro. Em PGlite com o Mercado Pago falso (sem rede):
 * - a linha do tempo na ordem de gravação (os eventos de uma ação têm o mesmo instante);
 * - a nota do débito e a origem da disputa (lida: pode ser uma reclamação) no quadro da equipe;
 * - "Mudar quem arca" guarda o "por que mudar" sem apagar a nota da decisão;
 * - o aviso `contestado` do pagamento pelo tipo da disputa;
 * - o portal na perdida sem nada a dividir.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { contestacoesPagamento, eventosContestacao } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { conferirTentativa } from "./conferencia";
import { pagamentosDaReserva } from "./consultas";
import { confirmarDebito, mudarDecisao, previaDaDecisao, registrarContestacaoDaEquipe, registrarDecisao } from "./contestacao";
import { disputaParaOProprietario } from "./contestacao-portal";
import { lerContestacoesDaEquipe, lerContestacoesDaOperacao } from "./contestacao-tela";
import { AVISOS_PAGAMENTO, TEXTOS_AVISO_CONTESTADO } from "./situacoes";
import { type Cenario, montarCenario, pagarEConfirmar, semDadosDoHospede, TOTAL, usuarioDeTeste } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});
afterEach(async () => {
  expect(await semDadosDoHospede(db)).toEqual([]);
});

const sp = (dataHora: string) => new Date(`${dataHora.replace(" ", "T")}:00-03:00`);
const sessao = (papel: Sessao["papel"]): Sessao => ({ usuarioId: equipe, organizacaoId: c.org, papel, imovelIds: [] });
const NOTA_DA_DECISAO = "Nota interna: o ar-condicionado parou na estadia.";

/** Reserva paga por cartão, liberada, e a disputa do valor aberta pela leitura da order em 05/10. */
async function disputada() {
  const x = await pagarEConfirmar(c, { forma: "cartao", liberar: true });
  c.provedor.contestar(x.idProvedor, "order", {});
  await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, sp("2026-10-05 10:00"), { origem: "rotina", forcar: true });
  const [d] = await lerContestacoesDaEquipe(db, sessao("admin"), x.reservaId, sp("2026-10-05 10:05"));
  expect(d).toBeTruthy();
  return { ...x, id: d.id };
}

describe("aceite do M8.2e: o quadro da equipe", () => {
  it("a linha do tempo segue a ordem de gravação quando os eventos têm o mesmo instante (o mais novo primeiro)", async () => {
    const x = await disputada();
    const em = sp("2026-10-05 12:00");
    for (const valor of [100, 200, 300, 400, 500, 600]) await db.insert(eventosContestacao).values({ contestacaoId: x.id, fonte: "sistema", tipo: "valor", antes: null, depois: { valor }, em });
    const [d] = await lerContestacoesDaEquipe(db, sessao("admin"), x.reservaId, sp("2026-10-05 13:00"));
    const doMesmoInstante = d.eventos.filter((e) => e.em.getTime() === em.getTime()).map((e) => e.texto);
    expect(doMesmoInstante).toEqual(["R$ 6,00", "R$ 5,00", "R$ 4,00", "R$ 3,00", "R$ 2,00", "R$ 1,00"].map((v) => `Valor em disputa: — → ${v}`));
  });

  it("a nota do débito e a origem da disputa aparecem para a equipe que lê o financeiro, nunca para a operação", async () => {
    const x = await disputada();
    const [antes] = await lerContestacoesDaEquipe(db, sessao("admin"), x.reservaId, sp("2026-10-05 10:05"));
    expect(antes.origemTexto).toBe("Lida no Mercado Pago como contestação: pode ser uma reclamação no Mercado Pago (mediação); o sistema não tem como separar, confira no painel dele.");
    expect(antes.notaDebito).toBe("");
    const nota = "O painel do Mercado Pago mostra o débito menor.";
    const r = await confirmarDebito(db, c.org, x.id, { data: "2026-10-06", valor: TOTAL - 1000, nota }, equipe, sp("2026-10-06 10:00"));
    expect(r).toMatchObject({ ok: true });
    const [d] = await lerContestacoesDaEquipe(db, sessao("admin"), x.reservaId, sp("2026-10-06 10:05"));
    expect(d.notaDebito).toBe(nota);
    expect(JSON.stringify(await lerContestacoesDaOperacao(db, sessao("operacao"), x.reservaId, sp("2026-10-06 10:05")))).not.toContain(nota);
    // Registrada à mão pela equipe: o texto da origem é o dela.
    const y = await pagarEConfirmar(c, { forma: "pix", liberar: true, entrada: "2026-11-02", saida: "2026-11-05" });
    const reg = await registrarContestacaoDaEquipe(db, c.org, y.pagamentoId, { tipo: "med", abertaEm: "2026-10-05", valor: TOTAL, prazo: null, idCaso: null, nota: "MED visto no painel do Mercado Pago." }, equipe, null, sp("2026-10-05 10:00"));
    expect(reg).toMatchObject({ ok: true });
    const [m] = await lerContestacoesDaEquipe(db, sessao("admin"), y.reservaId, sp("2026-10-05 10:05"));
    expect(m.origemTexto).toBe("Registrada à mão: o sistema confere pela leitura quando puder.");
  });

  it("'Mudar quem arca': o 'por que mudar' fica ao lado da nota da decisão, que não é apagada", async () => {
    const x = await disputada();
    const pv = await previaDaDecisao(db, c.org, x.id);
    if (!pv.ok) throw new Error(pv.erro);
    const r1 = await registrarDecisao(db, c.org, x.id, { causa: "imovel", quemArca: "proporcional", nota: NOTA_DA_DECISAO, explicacao: "", versao: pv.fatos.versao, assinatura: pv.fatos.opcoes.proporcional!.assinatura }, equipe, sp("2026-10-06 10:00"));
    expect(r1).toMatchObject({ ok: true });
    const pm = await previaDaDecisao(db, c.org, x.id);
    if (!pm.ok) throw new Error(pm.erro);
    const porQue = "A falha foi da cobrança, não do imóvel.";
    const r2 = await mudarDecisao(db, c.org, x.id, { causa: "cobranca", quemArca: "scl", nota: porQue, explicacao: "", versao: pm.fatos.versao, assinatura: pm.fatos.opcoes.scl!.assinatura }, equipe, sp("2026-10-07 10:00"));
    expect(r2).toMatchObject({ ok: true });
    const [l] = await db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.id, x.id));
    expect({ nota: l.decisaoNota, mudanca: l.decisaoMudancaNota, versao: l.decisaoVersao }).toEqual({ nota: NOTA_DA_DECISAO, mudanca: porQue, versao: 2 });
    const [d] = await lerContestacoesDaEquipe(db, sessao("admin"), x.reservaId, sp("2026-10-07 10:05"));
    expect(d.decisao).toMatchObject({ nota: NOTA_DA_DECISAO, notaMudanca: porQue });
    expect(d.decisao?.textoParaProprietario).not.toContain(porQue);
  });
});

describe("aceite do M8.2e: o aviso do pagamento e o portal", () => {
  it("o aviso 'contestado' do quadro do pagamento diz o tipo da disputa em curso (cartão; MED do Pix)", async () => {
    const x = await disputada();
    const [p] = await pagamentosDaReserva(db, c.org, x.reservaId, sp("2026-10-05 10:05"));
    expect(p.avisos).toContain(TEXTOS_AVISO_CONTESTADO.chargeback);
    expect(p.avisosSemValores).toContain(TEXTOS_AVISO_CONTESTADO.chargeback);
    expect(p.avisos).not.toContain(AVISOS_PAGAMENTO.contestado);
    const y = await pagarEConfirmar(c, { forma: "pix", liberar: true, entrada: "2026-11-02", saida: "2026-11-05" });
    const reg = await registrarContestacaoDaEquipe(db, c.org, y.pagamentoId, { tipo: "med", abertaEm: "2026-10-05", valor: TOTAL, prazo: null, idCaso: null, nota: "MED visto no painel do Mercado Pago." }, equipe, null, sp("2026-10-05 10:00"));
    expect(reg).toMatchObject({ ok: true });
    const [q] = await pagamentosDaReserva(db, c.org, y.reservaId, sp("2026-10-05 10:05"));
    expect(q.avisos).toContain(TEXTOS_AVISO_CONTESTADO.med);
    expect(q.avisos).not.toContain(AVISOS_PAGAMENTO.contestado);
  });

  it("portal: a perdida sem decisão e sem nada a dividir (definitiva) diz 'nada descontado de você', nunca 'em conferência'", () => {
    const base = { reservaCodigo: "SCL-0001", situacao: "perdida" as const, decisaoVersao: 0, parteProprietario: null, resultadoEm: "2026-10-08", causa: null, explicacao: "" };
    expect(disputaParaOProprietario({ ...base, definitivoEm: new Date("2026-10-08T13:00:00Z") })).toEqual({
      variante: "definitivo",
      texto: "Disputa do pagamento da reserva SCL-0001: nada descontado de você (a SCL perdeu a disputa em 08/10).",
    });
    // Ainda esperando a decisão (perda a dividir): continua em conferência.
    expect(disputaParaOProprietario({ ...base, definitivoEm: null }).variante).toBe("em_conferencia");
  });
});
