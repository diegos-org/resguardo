/**
 * Reserva paga do site no Beds24 (M8.3a) — a régua pura (desenho 2.1; seção 10, teste 4), o `esperado` com a assinatura,
 * as chaves de idempotência (3.3) e a leitura dos escopos da credencial (prontidão, seção 7). Sem banco e sem rede.
 */
import { describe, expect, it } from "vitest";
import type { ContratoParaMotor } from "@/financeiro/motor";
import { pendenciaDoCalculo } from "@/financeiro/motor";
import {
  assinaturaEsperado,
  avaliarEscoposBeds24,
  ESCOPOS_OBRIGATORIOS_BEDS24,
  chaveEnsaioBeds24,
  chaveOperacaoBeds24,
  chaveSimulacaoBeds24,
  type ContextoParaBeds24,
  type EsperadoBeds24,
  MOTIVOS_ACOMPANHAMENTO_BEDS24,
  reservaDoSiteParaBeds24,
  type ReservaParaBeds24,
  SITUACOES_OPERACAO_ATIVAS,
} from "./reservas-site-regras";

const HOJE = "2026-10-16";
const GESTAO: ContratoParaMotor = { tipo: "gestao_completa", comissaoBp: 1500, inicio: "2026-01-01", fim: null };
const LIGADO_EM = "2026-10-10T12:00:00.000Z";

const reserva = (o: Partial<ReservaParaBeds24> = {}): ReservaParaBeds24 => ({
  fonte: "site",
  estado: "confirmada",
  checkin: "2026-12-20",
  checkout: "2026-12-27",
  hospedes: 4,
  confirmadaEm: new Date("2026-10-15T15:00:00Z"),
  ...o,
});
const contexto = (o: Partial<ContextoParaBeds24> = {}): ContextoParaBeds24 => ({
  hoje: HOJE,
  pagaPeloSite: true,
  contratos: [GESTAO],
  ligacao: { ligadoEm: LIGADO_EM },
  cancelamentoDecidido: false,
  quartoDoVinculo: "123456",
  acompanhamento: null,
  beds24Id: null,
  ...o,
});
const esperado = (o: Partial<EsperadoBeds24> = {}): EsperadoBeds24 => ({ quarto: "123456", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, situacao: "confirmada", ...o });
/** Uma reserva que o M8.3 já criou no Beds24 (quarto guardado e id ligado), com a assinatura da última intenção. */
const criada = (assinatura: string | null, situacao: NonNullable<ContextoParaBeds24["acompanhamento"]>["situacao"] = "conferida"): Partial<ContextoParaBeds24> => ({
  acompanhamento: { situacao, quarto: "123456", assinaturaEsperada: assinatura },
  beds24Id: "98765",
});

describe("régua da reserva do site no Beds24 (M8.3a, desenho 2.1)", () => {
  it("reserva paga do site, confirmada depois de ligar o imóvel: criar, com o esperado do vínculo e a assinatura", () => {
    const d = reservaDoSiteParaBeds24(reserva(), contexto());
    expect(d).toEqual({ decisao: "enviar", acao: "criar", esperado: esperado(), assinatura: assinaturaEsperado(esperado()) });
  });

  it("nunca entram: hold/pedido, a reserva-pedido da alteração, outras fontes e o pedido sem pagamento (D3)", () => {
    expect(reservaDoSiteParaBeds24(reserva({ estado: "pedido" }), contexto())).toEqual({ decisao: "fora", motivo: "pedido" });
    // A reserva-pedido que segura as noites novas de uma alteração (fonte 'alteracao', estado 'pedido').
    expect(reservaDoSiteParaBeds24(reserva({ fonte: "alteracao", estado: "pedido" }), contexto())).toEqual({ decisao: "fora", motivo: "outra_fonte" });
    for (const fonte of ["beds24", "csv", "manual", "planilha"]) expect(reservaDoSiteParaBeds24(reserva({ fonte }), contexto())).toEqual({ decisao: "fora", motivo: "outra_fonte" });
    // Confirmada à mão sem pagamento do site (sem desfecho 'reserva'): fica no aviso manual, nunca no envio.
    expect(reservaDoSiteParaBeds24(reserva(), contexto({ pagaPeloSite: false }))).toEqual({ decisao: "fora", motivo: "sem_pagamento" });
    for (const estado of ["pendente", "consulta"] as const) expect(reservaDoSiteParaBeds24(reserva({ estado }), contexto())).toEqual({ decisao: "fora", motivo: "nao_confirmada" });
  });

  it("reserva criada pelo M8.3 sem mudança desde a última intenção não gera atualização; com datas ou pessoas mudadas, vira atualizar", () => {
    const atual = assinaturaEsperado(esperado());
    // Mesma assinatura da última intenção: nada a enviar. (Que a alteração segurada não mude a reserva principal, e que a
    // reserva-pedido dela nunca entre, é o teste com o banco em reservas-site-simulacao.test.ts.)
    expect(reservaDoSiteParaBeds24(reserva(), contexto(criada(atual)))).toEqual({ decisao: "fora", motivo: "sem_mudanca" });
    // As datas da reserva mudaram.
    const aplicada = reservaDoSiteParaBeds24(reserva({ checkout: "2026-12-28" }), contexto(criada(atual)));
    expect(aplicada).toEqual({ decisao: "enviar", acao: "atualizar", esperado: esperado({ saida: "2026-12-28" }), assinatura: assinaturaEsperado(esperado({ saida: "2026-12-28" })) });
    // Alteração só de pessoas também é intenção nova.
    expect(reservaDoSiteParaBeds24(reserva({ hospedes: 5 }), contexto(criada(atual)))).toMatchObject({ decisao: "enviar", acao: "atualizar", esperado: { hospedes: 5 } });
  });

  it("marketplace fica de fora até o M12.2, pela mesma régua do motor (tipo, ou contrato sem comissão); sem contrato, não supõe", () => {
    const marketplace: ContratoParaMotor = { tipo: "marketplace", comissaoBp: null, inicio: "2026-01-01", fim: null };
    expect(reservaDoSiteParaBeds24(reserva(), contexto({ contratos: [marketplace] }))).toEqual({ decisao: "fora", motivo: "marketplace" });
    expect(reservaDoSiteParaBeds24(reserva(), contexto({ contratos: [{ ...GESTAO, comissaoBp: null }] }))).toEqual({ decisao: "fora", motivo: "marketplace" });
    // A régua é a do motor: o mesmo contrato dá a mesma pendência no cálculo do pagamento.
    expect(pendenciaDoCalculo({ id: "r", codigo: "SCL-7K2QXM", imovelId: "i", estado: "confirmada", origem: "site", checkin: "2026-12-20", checkout: "2026-12-27", valorBruto: 100000, taxaCanal: 0, recebimento: "empresa" }, [marketplace], ["p"])).toBe("marketplace");
    // Vale o contrato vigente na ENTRADA: o marketplace que só começa depois da entrada não tira a reserva.
    const depois: ContratoParaMotor = { tipo: "marketplace", comissaoBp: null, inicio: "2026-12-21", fim: null };
    expect(reservaDoSiteParaBeds24(reserva(), contexto({ contratos: [{ ...GESTAO, fim: "2026-12-20" }, depois] }))).toMatchObject({ decisao: "enviar", acao: "criar" });
    expect(reservaDoSiteParaBeds24(reserva({ checkin: "2026-12-21", checkout: "2026-12-27" }), contexto({ contratos: [{ ...GESTAO, fim: "2026-12-20" }, depois] }))).toEqual({ decisao: "fora", motivo: "marketplace" });
    expect(reservaDoSiteParaBeds24(reserva(), contexto({ contratos: [] }))).toEqual({ decisao: "fora", motivo: "sem_contrato" });
    // Também no cancelamento de uma já criada (nunca entra o marketplace).
    expect(reservaDoSiteParaBeds24(reserva({ estado: "cancelada" }), contexto({ ...criada(null), cancelamentoDecidido: true, contratos: [marketplace] }))).toEqual({ decisao: "fora", motivo: "marketplace" });
  });

  it("confirmada antes de ligar o imóvel (ou sem confirmadaEm) nasce manual, motivo anterior_a_ligar; a partir da ligação, entra", () => {
    expect(reservaDoSiteParaBeds24(reserva({ confirmadaEm: new Date("2026-10-10T11:59:59Z") }), contexto())).toEqual({ decisao: "manual", motivo: "anterior_a_ligar" });
    expect(reservaDoSiteParaBeds24(reserva({ confirmadaEm: null }), contexto())).toEqual({ decisao: "manual", motivo: "anterior_a_ligar" });
    expect(reservaDoSiteParaBeds24(reserva({ confirmadaEm: new Date(LIGADO_EM) }), contexto())).toMatchObject({ decisao: "enviar", acao: "criar" });
    // A regra vale ao nascer o acompanhamento: uma linha já pendente (nasceu depois de ligar) não vira manual se o imóvel foi religado.
    expect(reservaDoSiteParaBeds24(reserva({ confirmadaEm: new Date("2026-10-11T00:00:00Z") }), contexto({ ligacao: { ligadoEm: "2026-10-14T00:00:00Z" }, acompanhamento: { situacao: "pendente", quarto: null, assinaturaEsperada: null } }))).toMatchObject({ decisao: "enviar", acao: "criar" });
  });

  it("imóvel desligado: só a criação para; atualizar e cancelar o que o M8.3 criou seguem", () => {
    expect(reservaDoSiteParaBeds24(reserva(), contexto({ ligacao: null }))).toEqual({ decisao: "fora", motivo: "imovel_desligado" });
    expect(reservaDoSiteParaBeds24(reserva({ checkout: "2026-12-28" }), contexto({ ...criada(assinaturaEsperado(esperado())), ligacao: null }))).toMatchObject({ decisao: "enviar", acao: "atualizar" });
    expect(reservaDoSiteParaBeds24(reserva({ estado: "cancelada" }), contexto({ ...criada(assinaturaEsperado(esperado())), ligacao: null, cancelamentoDecidido: true }))).toMatchObject({ decisao: "enviar", acao: "cancelar", esperado: { situacao: "cancelada", quarto: "123456" } });
  });

  it("criar: saída depois de hoje (São Paulo), sem reserva no Beds24 ligada a ela, com pessoas e vínculo; senão não sai", () => {
    expect(reservaDoSiteParaBeds24(reserva({ checkin: "2026-10-10", checkout: HOJE }), contexto())).toEqual({ decisao: "fora", motivo: "estadia_terminou" });
    expect(reservaDoSiteParaBeds24(reserva({ checkin: HOJE, checkout: "2026-10-17" }), contexto())).toMatchObject({ decisao: "enviar", acao: "criar" });
    // Ligada a um registro que o M8.3 não criou (reservas.beds24_id sem acompanhamento): nem cria nem escreve por cima.
    expect(reservaDoSiteParaBeds24(reserva(), contexto({ beds24Id: "55" }))).toEqual({ decisao: "fora", motivo: "ja_no_beds24" });
    expect(reservaDoSiteParaBeds24(reserva({ hospedes: null }), contexto())).toEqual({ decisao: "fora", motivo: "sem_hospedes" });
    expect(reservaDoSiteParaBeds24(reserva({ hospedes: 0 }), contexto())).toEqual({ decisao: "fora", motivo: "sem_hospedes" });
    expect(reservaDoSiteParaBeds24(reserva(), contexto({ quartoDoVinculo: null }))).toEqual({ decisao: "parada", motivo: "sem_vinculo" });
    // Intenção de criar já registrada com a mesma assinatura: nenhuma intenção nova (a operação dela segue).
    expect(reservaDoSiteParaBeds24(reserva(), contexto({ acompanhamento: { situacao: "pendente", quarto: "123456", assinaturaEsperada: assinaturaEsperado(esperado()) } }))).toEqual({ decisao: "fora", motivo: "sem_mudanca" });
    // Conflito, bloqueio manual ou incerteza aguardando a equipe: nada sai sozinho.
    for (const situacao of ["conflito", "aguardando_equipe"] as const) {
      expect(reservaDoSiteParaBeds24(reserva(), contexto({ acompanhamento: { situacao, quarto: "123456", assinaturaEsperada: "x" } }))).toEqual({ decisao: "fora", motivo: "aguardando_equipe" });
    }
  });

  it("atualizar: só a reserva criada pelo M8.3, saída a partir de hoje, assinatura diferente; divergente suspende; quarto guardado nunca troca", () => {
    const atual = assinaturaEsperado(esperado());
    expect(reservaDoSiteParaBeds24(reserva({ checkout: "2026-12-28" }), contexto(criada(atual, "divergente")))).toEqual({ decisao: "fora", motivo: "divergente" });
    expect(reservaDoSiteParaBeds24(reserva({ checkout: "2026-12-28" }), contexto(criada(atual, "aguardando_equipe")))).toEqual({ decisao: "fora", motivo: "aguardando_equipe" });
    expect(reservaDoSiteParaBeds24(reserva({ checkin: "2026-10-10", checkout: HOJE, hospedes: 5 }), contexto(criada(atual)))).toMatchObject({ decisao: "enviar", acao: "atualizar" });
    expect(reservaDoSiteParaBeds24(reserva({ checkin: "2026-10-10", checkout: "2026-10-15", hospedes: 5 }), contexto(criada(atual)))).toEqual({ decisao: "fora", motivo: "estadia_terminou" });
    // O vínculo do imóvel mudou depois da criação: a atualização vai ao quarto guardado.
    expect(reservaDoSiteParaBeds24(reserva({ checkout: "2026-12-28" }), contexto({ ...criada(atual), quartoDoVinculo: "999" }))).toMatchObject({ esperado: { quarto: "123456" } });
  });

  it("cancelar: só com o cancelamento decidido e a reserva criada pelo M8.3; segue com divergente; o mesmo cancelamento não repete", () => {
    const cancelada = reserva({ estado: "cancelada" });
    expect(reservaDoSiteParaBeds24(cancelada, contexto({ ...criada("x"), cancelamentoDecidido: false }))).toEqual({ decisao: "fora", motivo: "cancelada_sem_decisao" });
    expect(reservaDoSiteParaBeds24(cancelada, contexto({ cancelamentoDecidido: true }))).toEqual({ decisao: "fora", motivo: "cancelada_sem_beds24" });
    const d = reservaDoSiteParaBeds24(cancelada, contexto({ ...criada(assinaturaEsperado(esperado()), "divergente"), cancelamentoDecidido: true }));
    expect(d).toEqual({ decisao: "enviar", acao: "cancelar", esperado: esperado({ situacao: "cancelada" }), assinatura: assinaturaEsperado(esperado({ situacao: "cancelada" })) });
    expect(reservaDoSiteParaBeds24(cancelada, contexto({ ...criada(assinaturaEsperado(esperado({ situacao: "cancelada" }))), cancelamentoDecidido: true }))).toEqual({ decisao: "fora", motivo: "sem_mudanca" });
  });

  it("manual e encerrada: o M8.3 não escreve, nem para cancelar", () => {
    for (const situacao of ["manual", "encerrada"] as const) {
      expect(reservaDoSiteParaBeds24(reserva({ estado: "cancelada" }), contexto({ ...criada("x", situacao), cancelamentoDecidido: true }))).toEqual({ decisao: "fora", motivo: situacao });
      expect(reservaDoSiteParaBeds24(reserva(), contexto({ acompanhamento: { situacao, quarto: null, assinaturaEsperada: null } }))).toEqual({ decisao: "fora", motivo: situacao });
    }
  });
});

describe("assinatura e chaves (desenho 3.3)", () => {
  it("assinatura: sha256 truncado de quarto|chegada|saída|pessoas|situação; muda com qualquer um deles e com nada mais", () => {
    const a = assinaturaEsperado(esperado());
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(assinaturaEsperado({ ...esperado() })).toBe(a);
    const variacoes = [esperado({ quarto: "1" }), esperado({ chegada: "2026-12-21" }), esperado({ saida: "2026-12-28" }), esperado({ hospedes: 3 }), esperado({ situacao: "cancelada" })].map(assinaturaEsperado);
    expect(new Set([a, ...variacoes]).size).toBe(6);
  });

  it("chaves: <tipo>:<reserva>:<versão>, ensaio:<uuid> e simulacao:<reserva>:<assinatura>", () => {
    expect(chaveOperacaoBeds24("criar", "r1", 1)).toBe("criar:r1:1");
    expect(chaveOperacaoBeds24("cancelar", "r1", 2)).toBe("cancelar:r1:2");
    expect(chaveEnsaioBeds24("u1")).toBe("ensaio:u1");
    expect(chaveSimulacaoBeds24("r1", "abc")).toBe("simulacao:r1:abc");
    expect(SITUACOES_OPERACAO_ATIVAS).toEqual(["pendente", "enviando", "incerta"]);
  });

  it("motivos: a lista fechada do desenho, sem repetição", () => {
    expect(new Set(MOTIVOS_ACOMPANHAMENTO_BEDS24).size).toBe(MOTIVOS_ACOMPANHAMENTO_BEDS24.length);
    expect(MOTIVOS_ACOMPANHAMENTO_BEDS24).toHaveLength(20);
  });
});

describe("escopos da credencial (prontidão, desenho 7)", () => {
  const em = (escopos: string[] | null, ilegiveis: string[] = []) => avaliarEscoposBeds24({ escopos, ilegiveis });

  const CONVITE = ["write:bookings", "read:bookings-personal", "read:bookings-financial", "read:properties", "write:inventory"];

  it("em ordem só com todos os escopos do convite e nada além deles", () => {
    expect(ESCOPOS_OBRIGATORIOS_BEDS24).toEqual(CONVITE);
    expect(em(CONVITE)).toEqual({ situacao: "em_ordem", excessivos: [], faltando: [] });
    // A leitura das áreas que já têm escrita não é a mais (a escrita já dá essa leitura).
    expect(em([...CONVITE, "read:bookings", "read:inventory"])).toEqual({ situacao: "em_ordem", excessivos: [], faltando: [] });
  });

  it("all, apagar ou escrita de dados pessoais: escopo_excessivo (vence até a leitura torta)", () => {
    expect(em([...CONVITE, "all:bookings"])).toEqual({ situacao: "escopo_excessivo", excessivos: ["all:bookings"], faltando: [] });
    expect(em([...CONVITE, "write:bookings-personal"])).toEqual({ situacao: "escopo_excessivo", excessivos: ["write:bookings-personal"], faltando: [] });
    expect(em(["write:bookings", "delete:bookings", "all:inventory"], ["???"])).toMatchObject({ situacao: "escopo_excessivo", excessivos: ["delete:bookings", "all:inventory"] });
  });

  it("qualquer escopo fora da lista do convite também é a mais, escrita ou leitura de outra área", () => {
    expect(em([...CONVITE, "write:properties"])).toEqual({ situacao: "escopo_excessivo", excessivos: ["write:properties"], faltando: [] });
    expect(em([...CONVITE, "write:accounts", "read:channels"])).toMatchObject({ situacao: "escopo_excessivo", excessivos: ["write:accounts", "read:channels"] });
    // A mais vence a falta: a credencial é trocada de qualquer jeito.
    expect(em(["write:bookings", "write:properties"])).toMatchObject({ situacao: "escopo_excessivo", excessivos: ["write:properties"] });
  });

  it("formato desconhecido nunca conta como em ordem: não deu para ler", () => {
    expect(em(null)).toEqual({ situacao: "ilegivel", excessivos: [], faltando: [] });
    expect(em(CONVITE, ["bookings.write"])).toMatchObject({ situacao: "ilegivel" });
  });

  it("falta um obrigatório (a escrita de reservas ou qualquer outro): incompleto, com o que falta", () => {
    for (const e of CONVITE) expect(em(CONVITE.filter((x) => x !== e))).toEqual({ situacao: "incompleto", excessivos: [], faltando: [e] });
    expect(em(["write:bookings"])).toEqual({ situacao: "incompleto", excessivos: [], faltando: CONVITE.slice(1) });
    expect(em(["read:bookings", "write:inventory"])).toMatchObject({ situacao: "incompleto", faltando: ["write:bookings", "read:bookings-personal", "read:bookings-financial", "read:properties"] });
    expect(em([])).toEqual({ situacao: "incompleto", excessivos: [], faltando: CONVITE });
  });
});
