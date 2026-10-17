/**
 * Rotina de hora em hora do WhatsApp (M10.1a, desenho 4.6): a limpeza dos 90 dias e a repetição do e-mail da conta, com
 * o resumo só de números. Só o e-mail que falhou no envio vira falha (`ErroDeRotina` com `email_nao_enviado`); sem o
 * e-mail da empresa ou sem o e-mail do sistema, a rotina termina bem, com a contagem no resumo. PGlite, sem rede.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerEmpresa, salvarEmpresa } from "@/configuracoes/empresa";
import { whatsappEventos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { type Correio, CorreioMemoria } from "@/email/correio";
import { GUARDAR_EVENTOS_DIAS } from "@/lib/retencao";
import { ErroDeRotina } from "@/observabilidade/erro-de-rotina";
import { AUTOMACOES, registrarExecucao, ultimasExecucoes } from "@/sistema/automacoes";
import { rotinaWhatsapp } from "./cron";
import { avisoDeConta, CANARIOS, entregarAviso, FICTICIOS, HORA_DO_AVISO, organizacaoComWhatsapp, semDadosPessoaisWhatsapp } from "./testes";

const min = (n: number) => new Date(HORA_DO_AVISO.getTime() + n * 60_000);
const AGORA = min(60);

let db: Db, close: () => Promise<void>, org: string;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  org = await organizacaoComWhatsapp(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

/** Um evento de desconexão que pede e-mail (com o telefone canário no aviso, que não pode chegar ao resumo). */
const desconectar = (em = min(0)) => entregarAviso(db, avisoDeConta({ evento: "PARTNER_REMOVED", em, wabaInfo: null, telefone: CANARIOS.waIdBr }), em);

describe("rotinaWhatsapp (M10.1a)", () => {
  it("apaga os eventos com mais de 90 dias e manda o e-mail pendente; resumo só com números", async () => {
    await salvarEmpresa(db, org, { ...(await lerEmpresa(db, org)), email: "equipe@example.com" }, null);
    await desconectar();
    await db.insert(whatsappEventos).values({ organizacaoId: org, campo: "messages", resultado: "gravado", recebidoEm: new Date(AGORA.getTime() - (GUARDAR_EVENTOS_DIAS + 1) * 86_400_000) });
    const correio = new CorreioMemoria();
    expect(await rotinaWhatsapp(db, correio, AGORA)).toBe("1 aviso(s) antigo(s) apagado(s); 1 e-mail(s) da conta enviado(s); 0 falhou(aram); 0 sem e-mail da empresa; 0 sem o e-mail do sistema");
    expect(correio.enviadas).toHaveLength(1);
    expect(await db.select().from(whatsappEventos).where(eq(whatsappEventos.campo, "messages"))).toEqual([]);
  });

  it("sem o e-mail da empresa e sem o e-mail do sistema: termina bem, com a contagem no resumo (não vira aviso de hora em hora)", async () => {
    await desconectar();
    expect(await rotinaWhatsapp(db, new CorreioMemoria(), AGORA)).toBe("0 aviso(s) antigo(s) apagado(s); 0 e-mail(s) da conta enviado(s); 0 falhou(aram); 1 sem e-mail da empresa; 0 sem o e-mail do sistema");
    expect(await rotinaWhatsapp(db, null, AGORA)).toBe("0 aviso(s) antigo(s) apagado(s); 0 e-mail(s) da conta enviado(s); 0 falhou(aram); 0 sem e-mail da empresa; 1 sem o e-mail do sistema");
  });

  it("só o envio que falhou vira falha da rotina: ErroDeRotina com email_nao_enviado e o resumo como detalhe", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await salvarEmpresa(db, org, { ...(await lerEmpresa(db, org)), email: "equipe@example.com" }, null);
    await desconectar();
    const falha: Correio = {
      nome: "falha",
      enviar: async () => {
        throw new Error("provedor fora do ar");
      },
    };
    const erro = await rotinaWhatsapp(db, falha, AGORA).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeRotina);
    expect((erro as ErroDeRotina).falhas).toEqual({ email_nao_enviado: 1 });
    expect((erro as ErroDeRotina).message).toBe("0 aviso(s) antigo(s) apagado(s); 0 e-mail(s) da conta enviado(s); 1 falhou(aram); 0 sem e-mail da empresa; 0 sem o e-mail do sistema");
    expect((erro as ErroDeRotina).resumo).toBe("1 e-mail(s) não enviado(s) (detalhe na página Sistema)");
  });

  it("o registro em Sistema (execucoes_automacao) não leva dado pessoal nem id da Meta", async () => {
    await desconectar();
    await registrarExecucao(db, "whatsapp", () => rotinaWhatsapp(db, null, AGORA));
    const e = (await ultimasExecucoes(db)).get("whatsapp");
    expect(e).toMatchObject({ ok: true, resumo: expect.stringContaining("1 sem o e-mail do sistema") });
    for (const v of Object.values(FICTICIOS)) expect(e!.resumo).not.toContain(v);
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([]);
  });
});

describe("agendamento da rotina (M10.1a)", () => {
  it("de hora em hora aos 17 minutos no vercel.json, e ativa no catálogo de Sistema com o mesmo nome do registro", () => {
    const vercel = JSON.parse(readFileSync(fileURLToPath(new URL("../../vercel.json", import.meta.url)), "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons.filter((c) => c.path === "/api/cron/whatsapp")).toEqual([{ path: "/api/cron/whatsapp", schedule: "17 * * * *" }]);
    expect(AUTOMACOES.find((a) => a.id === "whatsapp")).toEqual({
      id: "whatsapp",
      nome: "WhatsApp: limpeza dos avisos antigos (90 dias) e e-mail da conta desconectada",
      quando: "De hora em hora, aos 17 minutos, só no deploy de produção",
      situacao: "ativa",
      item: "M10.1a",
    });
  });
});
