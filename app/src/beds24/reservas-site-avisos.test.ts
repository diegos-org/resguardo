/**
 * Reserva paga do site no Beds24 (M8.3c) — o e-mail à equipe (desenho 6.5; plano 1.13, P22, P26 e os extras do e-mail da
 * seção 3.2): os textos de cada caso (só o código SCL, o imóvel e as datas), a chave estável, `avisada_em` que evita o
 * segundo envio, a falha que tenta de novo na volta seguinte e o `sem-email`/`sem-correio` que marcam. PGlite e
 * `CorreioMemoria`; nada vai ao Beds24 nem a um provedor de e-mail.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gravarConfig } from "@/configuracoes/armazem";
import { beds24ReservasOperacoes, beds24ReservasSite } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { type Correio, CorreioMemoria, type Mensagem } from "@/email/correio";
import { type Cenario, EMAIL_HOSPEDE, minutos, montarCenario, NOME_HOSPEDE, pagarEConfirmar, TELEFONE_HOSPEDE } from "@/pagamentos/testes";
import { avisarEquipeDasReservasNoBeds24, avisarEquipeDeReservaNoBeds24, chaveDoEmailBeds24, type DadosDoEmailBeds24, emailDeReservaNoBeds24 } from "./reservas-site-avisos";
import { assinaturaEsperado, chaveOperacaoBeds24, type EsperadoBeds24, type MotivoAcompanhamentoBeds24, type SituacaoAcompanhamentoBeds24, type SituacaoOperacaoBeds24 } from "./reservas-site-regras";

const EMAIL_EQUIPE = "equipe@example.com";
const ESPERADO: EsperadoBeds24 = { quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada" };

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  await gravarConfig(db, c.org, "empresa", { email: EMAIL_EQUIPE }, null);
});

/** O acompanhamento de uma reserva paga, gravado direto na situação do caso (e a última operação, para a recusa). */
async function comAcompanhamento(situacao: SituacaoAcompanhamentoBeds24, motivo: MotivoAcompanhamentoBeds24, o: { operacao?: SituacaoOperacaoBeds24; lido?: EsperadoBeds24; entrada?: string; saida?: string } = {}) {
  const x = await pagarEConfirmar(c, { ...(o.entrada ? { entrada: o.entrada, saida: o.saida, email: `${o.entrada}@example.com` } : {}) });
  const esperado = { ...ESPERADO, ...(o.entrada ? { chegada: o.entrada, saida: o.saida! } : {}) };
  const [a] = await db
    .insert(beds24ReservasSite)
    .values({ organizacaoId: c.org, reservaId: x.reservaId, imovelId: c.imovel, referencia: x.reservaCodigo, roomId: "20", propertyId: "10", situacao, motivo, versao: 1, esperado, assinaturaEsperada: assinaturaEsperado(esperado), lido: o.lido ?? null })
    .returning();
  if (o.operacao) {
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: c.org, reservaId: x.reservaId, acompanhamentoId: a.id, tipo: "criar", chave: chaveOperacaoBeds24("criar", x.reservaId, 1), modo: "real", situacao: o.operacao, pedido: { ...esperado, referencia: x.reservaCodigo } });
  }
  return { ...x, assinatura: a.assinaturaEsperada };
}
const acompanhamento = async (reservaId: string) => (await db.select().from(beds24ReservasSite).where(eq(beds24ReservasSite.reservaId, reservaId)))[0];

/** Um correio que falha nas primeiras `n` chamadas (o provedor fora do ar) e depois guarda como o de memória. */
class CorreioQueFalha implements Correio {
  readonly nome = "falha";
  readonly enviadas: Mensagem[] = [];
  constructor(private falhas: number) {}
  async enviar(m: Mensagem) {
    if (this.falhas-- > 0) throw new Error("provedor fora do ar (fictício)");
    this.enviadas.push(m);
  }
}

describe("os textos do e-mail (desenho 6.5)", () => {
  const base: Omit<DadosDoEmailBeds24, "caso" | "motivo"> = { codigo: "SCL-7K2QXM", imovel: "403", scl: { chegada: "2026-10-12", saida: "2026-10-15" }, beds24: null };

  it("conflito, overbooking e a divergência, nos modelos da 4.1 e da seção 5", () => {
    expect(emailDeReservaNoBeds24({ ...base, caso: "conflito", motivo: "noites_ocupadas" })).toEqual({
      assunto: "Possível venda dupla: reserva SCL-7K2QXM",
      texto: "Possível venda dupla: as noites de 12/10 a 15/10 da reserva SCL-7K2QXM (paga pelo site, imóvel 403) estão ocupadas por outra reserva no Beds24. O sistema não criou nada. Resolva com o hóspede ou com o canal. Veja a ficha da reserva no painel (Reservas).\n",
    });
    // O conflito da atualização (as noites novas vendidas no meio, desenho 4.2): a reserva já está no Beds24 e só as noites
    // novas estão ocupadas — o texto fala da mudança para as datas do SCL, nunca de todas as noites nem de "não criou nada".
    expect(emailDeReservaNoBeds24({ ...base, caso: "conflito", motivo: "noites_ocupadas", acao: "atualizar", scl: { chegada: "2026-10-12", saida: "2026-10-17" } })).toEqual({
      assunto: "Possível venda dupla: reserva SCL-7K2QXM",
      texto: "Possível venda dupla: a mudança da reserva SCL-7K2QXM (paga pelo site, imóvel 403) para de 12/10 a 17/10 encontrou noites novas ocupadas por outra reserva no Beds24. O sistema não mudou as datas da reserva no Beds24. Resolva com o hóspede ou com o canal. Veja a ficha da reserva no painel (Reservas).\n",
    });
    // O overbooking tem texto próprio: a reserva que o sistema criou está certa, e ele nunca diz "o sistema não criou nada".
    const overbooking = emailDeReservaNoBeds24({ ...base, caso: "overbooking", motivo: "noites_ocupadas" });
    expect(overbooking.texto).toContain("O Beds24 informa overbooking nas noites de 12/10 a 15/10 da reserva SCL-7K2QXM (paga pelo site, imóvel 403), que o sistema criou: resolva com o hóspede ou com o canal.");
    expect(overbooking.texto).not.toContain("não criou nada");
    expect(emailDeReservaNoBeds24({ ...base, caso: "divergencia", motivo: "cancelada_no_beds24" }).texto).toContain("foi cancelada no Beds24, mas continua confirmada no SCL: as datas podem estar abertas nas OTAs. No Beds24, volte-a para Confirmado ou cancele pelo SCL, pela política.");
    expect(emailDeReservaNoBeds24({ ...base, caso: "divergencia", motivo: "mudada_no_beds24", beds24: { chegada: "2026-10-13", saida: "2026-10-16" } }).texto).toContain("no Beds24 está de 13/10 a 16/10; no SCL, de 12/10 a 15/10");
    expect(emailDeReservaNoBeds24({ ...base, caso: "divergencia", motivo: "apagada_no_beds24" }).texto).toContain("não voltou na leitura do Beds24 (apagada?): as noites de 12/10 a 15/10 podem estar abertas nas OTAs");
  });

  it("a recusa (as três), as falhas e a marca ilegível; nenhum texto leva dado do hóspede nem valor", () => {
    const textos = [
      emailDeReservaNoBeds24({ ...base, caso: "recusada", motivo: "sem_disponibilidade" }),
      emailDeReservaNoBeds24({ ...base, caso: "recusada", motivo: "recusada_pelo_beds24" }),
      emailDeReservaNoBeds24({ ...base, caso: "recusada", motivo: "sem_permissao" }),
      emailDeReservaNoBeds24({ ...base, caso: "falhas", motivo: "falhas" }),
      emailDeReservaNoBeds24({ ...base, caso: "marca_ilegivel", motivo: "marca_ilegivel" }),
    ];
    expect(textos[0].texto).toContain("por falta de disponibilidade nas datas");
    expect(textos[2].texto).toContain("a credencial não tem permissão de escrever reservas");
    expect(textos[3].texto).toContain("falhou 5 vezes seguidas antes de sair: nada foi gravado lá");
    expect(textos[4].texto).toContain("Auto Actions");
    for (const t of textos) {
      expect(t.assunto).toContain("SCL-7K2QXM");
      expect(t.texto).toContain("imóvel 403");
      expect(t.texto).toContain("de 12/10 a 15/10");
      expect(t.texto).not.toMatch(/R\$|@/);
    }
  });
});

describe("quando o e-mail sai e quando não sai (desenho 6.5; plano 1.13)", () => {
  it("o caso ainda não avisado: um e-mail à empresa, com a chave estável, e avisada_em gravado; a segunda vez, nada", async () => {
    const x = await comAcompanhamento("conflito", "noites_ocupadas");
    const correio = new CorreioMemoria();
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(10))).toEqual({ enviados: 1, semEnvio: 0, falhas: 0 });
    expect(correio.enviadas).toMatchObject([{ para: EMAIL_EQUIPE, chave: `beds24-reserva:${x.reservaId}:noites_ocupadas:${x.assinatura}`, conteudoRestrito: true }]);
    expect(chaveDoEmailBeds24(x.reservaId, "noites_ocupadas", x.assinatura)).toBe(correio.enviadas[0].chave);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ avisadaEm: minutos(10) });
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(20))).toEqual({ enviados: 0, semEnvio: 0, falhas: 0 });
    expect(await avisarEquipeDeReservaNoBeds24(db, c.org, x.reservaId, correio, minutos(20))).toBeNull();
    expect(correio.enviadas).toHaveLength(1);
    const tudo = JSON.stringify(correio.enviadas);
    for (const v of [EMAIL_HOSPEDE, TELEFONE_HOSPEDE, NOME_HOSPEDE]) expect(tudo).not.toContain(v);
  });

  it("o overbooking (conferida com noites_ocupadas): a varredura manda o e-mail com o texto próprio e a chave do motivo", async () => {
    const x = await comAcompanhamento("conferida", "noites_ocupadas");
    const correio = new CorreioMemoria();
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(10))).toEqual({ enviados: 1, semEnvio: 0, falhas: 0 });
    expect(correio.enviadas).toMatchObject([{ para: EMAIL_EQUIPE, assunto: `Overbooking no Beds24: reserva ${x.reservaCodigo}`, chave: `beds24-reserva:${x.reservaId}:noites_ocupadas:${x.assinatura}` }]);
    expect(correio.enviadas[0].texto).not.toContain("não criou nada");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ avisadaEm: minutos(10) });
  });

  it("a falha no envio deixa avisada_em vazio: a volta seguinte tenta de novo, com a mesma chave", async () => {
    const x = await comAcompanhamento("divergente", "cancelada_no_beds24");
    const correio = new CorreioQueFalha(1);
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(10))).toEqual({ enviados: 0, semEnvio: 0, falhas: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ avisadaEm: null });
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(20))).toEqual({ enviados: 1, semEnvio: 0, falhas: 0 });
    expect(correio.enviadas.map((m) => m.chave)).toEqual([`beds24-reserva:${x.reservaId}:cancelada_no_beds24:${x.assinatura}`]);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ avisadaEm: minutos(20) });
  });

  it("sem e-mail da empresa ou sem correio: marca avisada_em (o Início continua mostrando a atenção) e não tenta mais", async () => {
    const x = await comAcompanhamento("aguardando_equipe", "falhas");
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, null, minutos(10))).toEqual({ enviados: 0, semEnvio: 1, falhas: 0 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ avisadaEm: minutos(10) });
    const y = await comAcompanhamento("divergente", "marca_ilegivel", { entrada: "2026-10-20", saida: "2026-10-23" });
    await gravarConfig(db, c.org, "empresa", { email: "" }, null);
    const correio = new CorreioMemoria();
    expect(await avisarEquipeDeReservaNoBeds24(db, c.org, y.reservaId, correio, minutos(10))).toBe("sem-email");
    expect(correio.enviadas).toEqual([]);
    expect(await acompanhamento(y.reservaId)).toMatchObject({ avisadaEm: minutos(10) });
  });

  it("só os casos de e-mail: a incerteza, a duplicada e o bloqueio feito à mão não mandam; a recusa só com a operação recusada", async () => {
    await comAcompanhamento("aguardando_equipe", "incerta", { operacao: "incerta" });
    await comAcompanhamento("aguardando_equipe", "duplicada", { entrada: "2026-10-16", saida: "2026-10-18" });
    await comAcompanhamento("aguardando_equipe", "bloqueio_manual", { entrada: "2026-10-18", saida: "2026-10-20", operacao: "conflito" });
    // A falta de disponibilidade lida ANTES do POST (a operação em conflito, nada foi enviado) não manda; a recusa do POST, sim.
    await comAcompanhamento("aguardando_equipe", "sem_disponibilidade", { entrada: "2026-10-20", saida: "2026-10-22", operacao: "conflito" });
    const recusada = await comAcompanhamento("aguardando_equipe", "sem_disponibilidade", { entrada: "2026-10-24", saida: "2026-10-26", operacao: "recusada" });
    const correio = new CorreioMemoria();
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(10))).toEqual({ enviados: 1, semEnvio: 0, falhas: 0 });
    expect(correio.enviadas.map((m) => m.chave)).toEqual([`beds24-reserva:${recusada.reservaId}:sem_disponibilidade:${recusada.assinatura}`]);
  });

  it("a estadia que já terminou não pede mais e-mail; a transição para outro caso no meio não ganha o avisada_em do anterior", async () => {
    const x = await comAcompanhamento("conflito", "noites_ocupadas");
    const correio = new CorreioMemoria();
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, new Date("2026-10-16T12:00:00Z"))).toEqual({ enviados: 0, semEnvio: 0, falhas: 0 });
    // O acompanhamento muda de caso entre a leitura e a gravação: a marca do e-mail velho não vale para o novo.
    const lento: Correio = {
      nome: "lento",
      enviar: async (m) => {
        correio.enviadas.push(m);
        await db.update(beds24ReservasSite).set({ situacao: "divergente", motivo: "mudada_no_beds24" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
      },
    };
    expect(await avisarEquipeDeReservaNoBeds24(db, c.org, x.reservaId, lento, minutos(10))).toBe("enviado");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", avisadaEm: null });
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(11))).toEqual({ enviados: 1, semEnvio: 0, falhas: 0 });
    expect(correio.enviadas.map((m) => m.chave)).toEqual([`beds24-reserva:${x.reservaId}:noites_ocupadas:${x.assinatura}`, `beds24-reserva:${x.reservaId}:mudada_no_beds24:${x.assinatura}`]);
  });
});
