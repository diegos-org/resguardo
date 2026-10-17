/**
 * Reserva paga do site no Beds24 (M8.3c) — as regras puras da escrita (desenho 3.3 a 3.8, 6.5 e 9): o `detalhe` de forma
 * fechada, a adoção só com a marca do info item e a origem (desenho 3.5 e 4.3), a resposta da fila à régua (3.3), as saídas
 * da incerteza da criação e do `atualizar`/`cancelar` (3.8), a regra da nova tentativa, as janelas e os atrasos da rotina (9)
 * e os casos do e-mail à equipe (6.5). Sem banco e sem rede.
 */
import { describe, expect, it } from "vitest";
import {
  assinaturaEsperado,
  atrasoDaFalha,
  ATRASOS_FALHA_MINUTOS,
  casoDeEmailBeds24,
  type DecisaoAdocao,
  type DecisaoBeds24,
  dentroDeJanela,
  detalheOperacaoBeds24,
  escoposLidosBeds24,
  type EsperadoBeds24,
  JANELAS_SEM_OPERACAO_NOVA_UTC,
  jaHouveNovaTentativa,
  type LidoBeds24,
  MOTIVOS_ACOMPANHAMENTO_BEDS24,
  MOTIVOS_DE_EMAIL_BEDS24,
  type OperacaoAnteriorBeds24,
  operacaoEmCurso,
  origemPodeSerDoScl,
  passoDaFila,
  regraDeAdocao,
  RESPOSTAS_DE_RECUSA_BEDS24,
  RESPOSTAS_SEM_RESPOSTA_BEDS24,
  saidaDaIncertezaDaCriacao,
  saidaDaIncertezaPorId,
  SITUACOES_ACOMPANHAMENTO_BEDS24,
  SITUACOES_OPERACAO_BEDS24,
} from "./reservas-site-regras";
import { RESPOSTAS_BEDS24, type ReservaBeds24, type RespostaBeds24 } from "./tipos";

const CODIGO = "SCL-7K2QXM";
const ESPERADO_ADOCAO = { quarto: "20", chegada: "2026-12-20", saida: "2026-12-27" };
/** Um registro do Beds24 já normalizado: a reserva criada pelo SCL (marca do info item, origem pela API). Dados fictícios. */
const registro = (o: Partial<ReservaBeds24> = {}): ReservaBeds24 => ({
  idExterno: "98765", propertyId: "10", roomId: "20", estado: "confirmada", checkin: "2026-12-20", checkout: "2026-12-27", hospedes: 4,
  nome: "", email: "", telefone: "", valorBruto: null, comissaoCanal: null, canal: "outro", codigoCanal: "", modificadoEm: null,
  referenciaScl: CODIGO, marcaFonte: "info", marcaAmbigua: false, ensaio: false, ensaioOperacaoId: null, origemApi: "API", ...o,
});
const esperado = (o: Partial<EsperadoBeds24> = {}): EsperadoBeds24 => ({ quarto: "20", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, situacao: "confirmada", ...o });
const lido = (o: Partial<LidoBeds24> = {}): LidoBeds24 => ({ quarto: "20", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, situacao: "confirmada", ...o });
const ENVIADO = new Date("2026-10-17T12:00:00Z");
const depoisDe = (min: number) => new Date(ENVIADO.getTime() + min * 60_000);

describe("detalhe da operação: forma fechada (sem dado pessoal nem valor)", () => {
  it("guarda só os campos conhecidos, com ids, datas e nomes validados; o resto some", () => {
    const d = detalheOperacaoBeds24({
      candidato: "98765", duplicadas: ["2", "1", "1", "x y"], bloqueio: { inicio: "2026-12-20", fim: "2026-12-22" }, encerradaPelaEquipe: true, marcaNaoLida: true, porBotao: "vincular",
      observado: { chaveDoId: "id", chavesEmNew: ["id", "a b"], cabecalhosDeCredito: ["x-five-min-limit-remaining", "Com Espaço"], canal: "direta", origemApi: "API", horaDaReservaLegivel: true },
      nome: "Hóspede Fictício", email: "hospede@example.com", valor: 150000,
    });
    expect(d).toEqual({
      candidato: "98765", duplicadas: ["1", "2"], bloqueio: { inicio: "2026-12-20", fim: "2026-12-22" }, encerradaPelaEquipe: true, marcaNaoLida: true, porBotao: "vincular",
      observado: { chaveDoId: "id", chavesEmNew: ["id"], cabecalhosDeCredito: ["x-five-min-limit-remaining"], canal: "direta", origemApi: "API", horaDaReservaLegivel: true },
    });
    expect(JSON.stringify(d)).not.toMatch(/Hóspede|example\.com|150000/);
  });

  it("valor torto vira o detalhe vazio, e cada campo torto some sozinho", () => {
    for (const v of [null, undefined, "x", 1, [], true]) expect(detalheOperacaoBeds24(v)).toEqual({});
    expect(detalheOperacaoBeds24({ candidato: "Hóspede Fictício", bloqueio: { inicio: "2026-12-22", fim: "2026-12-20" }, encerradaPelaEquipe: "sim", porBotao: "apagar" })).toEqual({});
    expect(detalheOperacaoBeds24({ observado: { chaveDoId: "a b", canal: "expedia", origemApi: "<script>", horaDaReservaLegivel: "sim" } })).toEqual({
      observado: { chaveDoId: null, chavesEmNew: [], cabecalhosDeCredito: [], canal: null, origemApi: null, horaDaReservaLegivel: null },
    });
  });
});

describe("adoção só com a marca do info item e a origem do SCL (desenho 3.5 e 4.3)", () => {
  it("a origem: o canal direto ou a origem pela API; nunca um canal nomeado; o 'outro' sem a origem pela API nunca basta", () => {
    expect(origemPodeSerDoScl({ canal: "direta", origemApi: null })).toBe(true);
    expect(origemPodeSerDoScl({ canal: "outro", origemApi: "API" })).toBe(true);
    expect(origemPodeSerDoScl({ canal: "outro", origemApi: null })).toBe(false);
    for (const canal of ["airbnb", "booking"] as const) {
      expect(origemPodeSerDoScl({ canal, origemApi: null })).toBe(false);
      expect(origemPodeSerDoScl({ canal, origemApi: "API" })).toBe(false);
    }
    // A origem pela API que nomeia a OTA (o `channel` vazio dá "outro") também não prova a origem do SCL.
    for (const origemApi of ["Booking.com", "Airbnb", "airbnb api"]) expect(origemPodeSerDoScl({ canal: "outro", origemApi })).toBe(false);
    expect(origemPodeSerDoScl({ canal: "direta", origemApi: "Booking.com" })).toBe(false);
  });

  it("adota a reserva criada pelo SCL; com o código só no nome ou nas notas, ou num registro de canal, é marca em registro inesperado", () => {
    expect(regraDeAdocao([registro()], ESPERADO_ADOCAO)).toEqual({ adotar: true, registro: registro() });
    expect(regraDeAdocao([registro({ canal: "direta", origemApi: null })], ESPERADO_ADOCAO)).toMatchObject({ adotar: true });
    // Uma reserva de OTA em que alguém anotou o código SCL nas notas nunca é adotada (e depois cancelada pelo sistema).
    expect(regraDeAdocao([registro({ marcaFonte: "texto" })], ESPERADO_ADOCAO)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "98765" });
    expect(regraDeAdocao([registro({ canal: "airbnb", codigoCanal: "HMFICT" })], ESPERADO_ADOCAO)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "98765" });
    expect(regraDeAdocao([registro({ canal: "booking" })], ESPERADO_ADOCAO)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "98765" });
    expect(regraDeAdocao([registro({ canal: "outro", origemApi: null })], ESPERADO_ADOCAO)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "98765" });
  });

  it("a duplicada conta só as nossas (o info item e a origem do SCL), em qualquer situação; o código só no texto ou num registro de OTA nunca entra nos ids", () => {
    expect(regraDeAdocao([], ESPERADO_ADOCAO)).toEqual({ adotar: false, motivo: "nenhum" });
    expect(regraDeAdocao([registro({ idExterno: "2" }), registro({ idExterno: "1", estado: "cancelada" })], ESPERADO_ADOCAO)).toEqual({ adotar: false, motivo: "duplicada", ids: ["1", "2"] });
    // A nossa (info item, criada pela API) mais uma reserva do Airbnb com o código nas notas: marca em registro inesperado na
    // da OTA, nunca duplicada (os ids da duplicada vão para "cancele no Beds24", e cancelar lá a da OTA daria venda dupla).
    const daOta = registro({ idExterno: "555", marcaFonte: "texto", canal: "airbnb", codigoCanal: "HMFICT", origemApi: null });
    expect(regraDeAdocao([registro(), daOta], ESPERADO_ADOCAO)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "555" });
    expect(regraDeAdocao([registro({ idExterno: "2" }), registro({ idExterno: "1", marcaFonte: "texto" })], ESPERADO_ADOCAO)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "1" });
    // Duas nossas e a da OTA: a duplicada lista só as nossas.
    expect(regraDeAdocao([registro({ idExterno: "2" }), daOta, registro({ idExterno: "1" })], ESPERADO_ADOCAO)).toEqual({ adotar: false, motivo: "duplicada", ids: ["1", "2"] });
  });

  it("as regras de antes continuam: a situação, o quarto e as datas precisam bater; a mesma cópia lida duas vezes conta uma", () => {
    expect(regraDeAdocao([registro(), registro()], ESPERADO_ADOCAO)).toEqual({ adotar: true, registro: registro() });
    for (const o of [{ estado: "bloqueio" as const }, { estado: "cancelada" as const }, { roomId: "21" }, { checkout: "2026-12-28" }]) {
      expect(regraDeAdocao([registro(o)], ESPERADO_ADOCAO)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "98765" });
    }
    expect(regraDeAdocao([registro()], null)).toMatchObject({ adotar: false, motivo: "marca_em_registro_inesperado" });
  });
});

describe("a fila diante da régua (desenho 3.3)", () => {
  const enviar = (acao: "criar" | "atualizar" | "cancelar", e = esperado()): DecisaoBeds24 => ({ decisao: "enviar", acao, esperado: e, assinatura: assinaturaEsperado(e) });
  const fora = (motivo: Extract<DecisaoBeds24, { decisao: "fora" }>["motivo"]): DecisaoBeds24 => ({ decisao: "fora", motivo });
  const em = (situacao: "pendente" | "em_envio" | "aguardando_equipe" | "conferida" | "manual", motivo: "sem_vinculo" | "falhas" | null = null) => ({ situacao, motivo });
  const naFila = (tipo: "criar" | "atualizar" | "cancelar") => ({ tipo, enviadoEm: null });

  it("sem operação: enviar abre a operação; sem mudança, nada", () => {
    expect(passoDaFila(enviar("criar"), null, null, false)).toEqual({ passo: "abrir", acao: "criar", esperado: esperado(), assinatura: assinaturaEsperado(esperado()), superar: false });
    expect(passoDaFila(fora("sem_mudanca"), null, em("conferida"), false)).toEqual({ passo: "parar", superar: false, acompanhamento: null });
  });

  it("operação na fila sem POST: a régua sem mudança segue; a mesma ação com o SCL mudado atualiza no lugar; outra ação supera a antiga antes da nova", () => {
    expect(passoDaFila(fora("sem_mudanca"), naFila("criar"), em("em_envio"), false)).toEqual({ passo: "seguir" });
    const mudado = esperado({ saida: "2026-12-28" });
    expect(passoDaFila(enviar("criar", mudado), naFila("criar"), em("em_envio"), false)).toEqual({ passo: "atualizar_no_lugar", esperado: mudado, assinatura: assinaturaEsperado(mudado) });
    expect(passoDaFila(enviar("cancelar", esperado({ situacao: "cancelada" })), naFila("atualizar"), em("em_envio"), false)).toMatchObject({ passo: "abrir", acao: "cancelar", superar: true });
  });

  it("a cancelada antes de ser criada: a criar da fila vira superada e segue a leitura da 6.3 (só com acompanhamento)", () => {
    expect(passoDaFila(fora("cancelada_sem_beds24"), naFila("criar"), em("em_envio"), false)).toEqual({ passo: "parar", superar: true, acompanhamento: "cancelar_antes_de_criar" });
    // Depois de uma duplicada (nada ativo), o cancelamento no SCL também chega lá.
    expect(passoDaFila(fora("cancelada_sem_beds24"), null, em("aguardando_equipe"), false)).toEqual({ passo: "parar", superar: false, acompanhamento: "cancelar_antes_de_criar" });
    // Sem acompanhamento, o M8.3 nunca tocou a reserva: nada.
    expect(passoDaFila(fora("cancelada_sem_beds24"), null, null, false)).toEqual({ passo: "parar", superar: false, acompanhamento: null });
  });

  it("sem vínculo: pendente/sem_vinculo, superando a da fila; confirmada antes de ligar: manual/anterior_a_ligar", () => {
    expect(passoDaFila({ decisao: "parada", motivo: "sem_vinculo" }, naFila("criar"), em("em_envio"), false)).toEqual({ passo: "parar", superar: true, acompanhamento: "sem_vinculo" });
    expect(passoDaFila({ decisao: "parada", motivo: "sem_vinculo" }, null, null, false)).toEqual({ passo: "parar", superar: false, acompanhamento: "sem_vinculo" });
    expect(passoDaFila({ decisao: "manual", motivo: "anterior_a_ligar" }, null, null, false)).toEqual({ passo: "parar", superar: false, acompanhamento: "manual_anterior_a_ligar" });
  });

  it("qualquer outro 'fora' supera a da fila e nunca a envia (o imóvel desligado depois da falha, D6); o acompanhamento sai de em_envio", () => {
    const motivos = ["imovel_desligado", "manual", "encerrada", "estadia_terminou", "ja_no_beds24", "aguardando_equipe", "divergente", "outra_fonte", "sem_pagamento", "marketplace", "sem_contrato", "sem_hospedes", "nao_confirmada", "cancelada_sem_decisao"] as const;
    for (const m of motivos) expect(passoDaFila(fora(m), naFila("criar"), em("em_envio"), false)).toEqual({ passo: "parar", superar: true, acompanhamento: "pendente" });
    // A equipe ainda decide (aguardando, manual): o acompanhamento não muda; o motivo que a régua já não dá (sem_vinculo) sai.
    expect(passoDaFila(fora("aguardando_equipe"), null, em("aguardando_equipe", "falhas"), false)).toEqual({ passo: "parar", superar: false, acompanhamento: null });
    expect(passoDaFila(fora("manual"), naFila("criar"), em("manual"), false)).toEqual({ passo: "parar", superar: true, acompanhamento: null });
    expect(passoDaFila(fora("imovel_desligado"), null, em("pendente", "sem_vinculo"), false)).toEqual({ passo: "parar", superar: false, acompanhamento: "pendente" });
    expect(passoDaFila(fora("imovel_desligado"), null, em("pendente"), false)).toEqual({ passo: "parar", superar: false, acompanhamento: null });
  });

  it("com uma operação da reserva em curso (enviando, incerta, feita, ou pendente com POST), nenhuma intenção nova: esperar", () => {
    // A `criar` feita (adotada pela importação) e a régua pedindo `atualizar`: nada abre até ela terminar.
    expect(passoDaFila(enviar("atualizar"), null, em("em_envio"), true)).toEqual({ passo: "esperar" });
    // A `criar` incerta e a reserva cancelada no SCL: a leitura da 6.3 espera a saída da incerteza.
    expect(passoDaFila(fora("cancelada_sem_beds24"), null, em("em_envio"), true)).toEqual({ passo: "esperar" });
    expect(passoDaFila({ decisao: "parada", motivo: "sem_vinculo" }, null, em("aguardando_equipe"), true)).toEqual({ passo: "esperar" });
    for (const situacao of ["enviando", "incerta", "feita"] as const) {
      expect(operacaoEmCurso({ situacao, enviadoEm: null })).toBe(true);
      expect(operacaoEmCurso({ situacao, enviadoEm: ENVIADO })).toBe(true);
    }
    expect(operacaoEmCurso({ situacao: "pendente", enviadoEm: ENVIADO })).toBe(true);
    // A da fila (pendente sem POST) e as terminais não estão em curso.
    expect(operacaoEmCurso({ situacao: "pendente", enviadoEm: null })).toBe(false);
    for (const situacao of ["conferida", "superada", "divergente", "recusada", "conflito", "falhou", "simulada"] as const) expect(operacaoEmCurso({ situacao, enviadoEm: ENVIADO })).toBe(false);
  });
});

describe("a nova tentativa automática: no máximo uma por intenção (desenho 3.8, item 3)", () => {
  const pedido = { ...esperado(), referencia: CODIGO };
  const op = (o: Partial<OperacaoAnteriorBeds24> = {}): OperacaoAnteriorBeds24 => ({ tipo: "criar", situacao: "falhou", enviadoEm: ENVIADO, resposta: "tempo", pedido, detalhe: {}, ...o });
  const assinatura = assinaturaEsperado(esperado());

  it("conta a criar que falhou depois de um POST sem resposta, qualquer que seja (tempo, rede, 5xx, formato)", () => {
    for (const resposta of RESPOSTAS_SEM_RESPOSTA_BEDS24) expect(jaHouveNovaTentativa([op({ resposta })], "criar", assinatura)).toBe(true);
    expect(jaHouveNovaTentativa([], "criar", assinatura)).toBe(false);
  });

  it("não contam: o limite e o não enviado (não processados), outra assinatura, outro tipo, sem POST, outra situação, a encerrada pela equipe", () => {
    for (const resposta of ["limite", "nao_enviado", "recusada", "sem_id"] as const) expect(jaHouveNovaTentativa([op({ resposta })], "criar", assinatura)).toBe(false);
    expect(jaHouveNovaTentativa([op({ pedido: { ...pedido, saida: "2026-12-28" } })], "criar", assinatura)).toBe(false);
    expect(jaHouveNovaTentativa([op({ tipo: "atualizar" })], "criar", assinatura)).toBe(false);
    expect(jaHouveNovaTentativa([op({ enviadoEm: null })], "criar", assinatura)).toBe(false);
    expect(jaHouveNovaTentativa([op({ situacao: "incerta" })], "criar", assinatura)).toBe(false);
    expect(jaHouveNovaTentativa([op({ detalhe: { encerradaPelaEquipe: true } })], "criar", assinatura)).toBe(false);
    expect(jaHouveNovaTentativa([op({ tipo: "atualizar" })], "atualizar", assinatura)).toBe(true);
  });

  it("os grupos de resposta são da lista fechada e não se misturam", () => {
    for (const r of [...RESPOSTAS_DE_RECUSA_BEDS24, ...RESPOSTAS_SEM_RESPOSTA_BEDS24]) expect(RESPOSTAS_BEDS24).toContain(r);
    expect(RESPOSTAS_DE_RECUSA_BEDS24.some((r) => (RESPOSTAS_SEM_RESPOSTA_BEDS24 as readonly string[]).includes(r))).toBe(false);
  });
});

describe("a saída da incerteza da criação (desenho 3.8)", () => {
  const nenhum: DecisaoAdocao = { adotar: false, motivo: "nenhum" };
  const leu = (o: { adocao?: DecisaoAdocao; ocupanteExato?: string | null; credencialLeMarca?: boolean } = {}) => ({ funcionou: true as const, adocao: o.adocao ?? nenhum, ocupanteExato: o.ocupanteExato ?? null, credencialLeMarca: o.credencialLeMarca ?? true });
  const saida = (o: { resposta?: RespostaBeds24 | null; agora?: Date; leitura?: ReturnType<typeof leu> | { funcionou: false }; ja?: boolean; buscas?: number } = {}) =>
    saidaDaIncertezaDaCriacao({ resposta: o.resposta === undefined ? "tempo" : o.resposta, enviadoEm: ENVIADO, agora: o.agora ?? depoisDe(6), leitura: o.leitura ?? leu(), jaHouveNovaTentativa: o.ja ?? false, buscasSemConclusao: o.buscas ?? 0 });

  it("antes de 5 min desde o POST nada conclui, nem a adoção; aos 5 min, conclui", () => {
    expect(saida({ agora: depoisDe(4.99), leitura: leu({ adocao: { adotar: true, registro: registro() } }) })).toEqual({ saida: "aguardar" });
    expect(saida({ agora: depoisDe(5), leitura: leu({ adocao: { adotar: true, registro: registro() } }) })).toEqual({ saida: "adotar", registro: registro() });
  });

  it("achou pela adoção, duplicada ou marca em registro inesperado: vêm antes de tudo (a operação vira divergente nos dois últimos)", () => {
    expect(saida({ leitura: leu({ adocao: { adotar: false, motivo: "duplicada", ids: ["1", "2"] }, ocupanteExato: "3" }) })).toEqual({ saida: "divergente", motivo: "duplicada", ids: ["1", "2"] });
    expect(saida({ leitura: leu({ adocao: { adotar: false, motivo: "marca_em_registro_inesperado", id: "7" } }) })).toEqual({ saida: "divergente", motivo: "marca_em_registro_inesperado", ids: ["7"] });
  });

  it("o ocupante exato sem marca é conferido antes de qualquer 'não achou', mesmo com a credencial que não lê a marca: o id sugerido, nunca venda dupla", () => {
    expect(saida({ leitura: leu({ ocupanteExato: "98765" }) })).toEqual({ saida: "candidato", id: "98765" });
    expect(saida({ leitura: leu({ ocupanteExato: "98765", credencialLeMarca: false }), resposta: "recusada" })).toEqual({ saida: "candidato", id: "98765" });
  });

  it("não achou, com a busca que funcionou: a recusa vira recusada com o motivo (nunca repete); sem resposta, uma nova tentativa só", () => {
    expect(saida({ resposta: "recusada_disponibilidade" })).toEqual({ saida: "recusada", motivo: "sem_disponibilidade" });
    expect(saida({ resposta: "recusada" })).toEqual({ saida: "recusada", motivo: "recusada_pelo_beds24" });
    expect(saida({ resposta: "http_4xx" })).toEqual({ saida: "recusada", motivo: "recusada_pelo_beds24" });
    for (const resposta of RESPOSTAS_SEM_RESPOSTA_BEDS24) {
      expect(saida({ resposta })).toEqual({ saida: "nova_tentativa" });
      expect(saida({ resposta, ja: true })).toEqual({ saida: "equipe" });
    }
  });

  it("o sem_id nunca repete sozinho (o Beds24 disse que gravou), e uma resposta que não devia estar aqui vai à equipe", () => {
    expect(saida({ resposta: "sem_id" })).toEqual({ saida: "equipe" });
    for (const resposta of ["criada", "limite", "nao_enviado", null] as const) expect(saida({ resposta })).toEqual({ saida: "equipe" });
  });

  it("a busca que não funcionou, ou a credencial que não lê a marca, não conclui: conta, e na terceira vai à equipe", () => {
    expect(saida({ leitura: { funcionou: false } })).toEqual({ saida: "sem_conclusao", buscas: 1, equipe: false });
    expect(saida({ leitura: leu({ credencialLeMarca: false }), buscas: 1 })).toEqual({ saida: "sem_conclusao", buscas: 2, equipe: false });
    expect(saida({ leitura: { funcionou: false }, buscas: 2 })).toEqual({ saida: "sem_conclusao", buscas: 3, equipe: true });
  });
});

describe("a saída da incerteza do atualizar e do cancelar, só pela releitura por id (desenho 3.8)", () => {
  const novo = esperado({ saida: "2026-12-28" });
  const antes = lido();
  const saida = (registro: LidoBeds24 | null, o: { resposta?: RespostaBeds24; agora?: Date; ja?: boolean; podeConcluirApagada?: boolean; pedido?: EsperadoBeds24; buscas?: number; antes?: LidoBeds24 | null } = {}) =>
    saidaDaIncertezaPorId({ pedido: o.pedido ?? novo, antes: o.antes === undefined ? antes : o.antes, resposta: o.resposta ?? "tempo", enviadoEm: ENVIADO, agora: o.agora ?? depoisDe(6), releitura: { funcionou: true, registro, podeConcluirApagada: o.podeConcluirApagada ?? true }, jaHouveNovaTentativa: o.ja ?? false, buscasSemConclusao: o.buscas ?? 0 });

  it("igual ao pedido: conferir, na hora (nunca a busca nem a adoção)", () => {
    expect(saida(lido({ saida: "2026-12-28" }), { agora: depoisDe(1) })).toEqual({ saida: "conferir" });
    // O cancelamento conferido: cancelado no mesmo quarto e datas (as pessoas não contam no cancelado).
    expect(saida(lido({ situacao: "cancelada", hospedes: 2 }), { pedido: esperado({ situacao: "cancelada" }) })).toEqual({ saida: "conferir" });
  });

  it("igual ao antes: só depois de 5 min; sem resposta, uma nova tentativa só; depois de uma recusa, recusada (nunca sem fim)", () => {
    expect(saida(antes, { agora: depoisDe(4) })).toEqual({ saida: "aguardar" });
    expect(saida(antes)).toEqual({ saida: "nova_tentativa" });
    expect(saida(antes, { ja: true })).toEqual({ saida: "equipe", motivo: "incerta" });
    expect(saida(antes, { resposta: "recusada" })).toEqual({ saida: "recusada", motivo: "recusada_pelo_beds24" });
    expect(saida(antes, { resposta: "sem_id" })).toEqual({ saida: "equipe", motivo: "incerta" });
  });

  it("não voltou: apagada só com a credencial guardada igual à de agora e o quarto acessível; senão, sem permissão (as marcas ficam)", () => {
    expect(saida(null)).toEqual({ saida: "divergente", motivo: "apagada_no_beds24" });
    expect(saida(null, { podeConcluirApagada: false })).toEqual({ saida: "equipe", motivo: "sem_permissao" });
  });

  it("sem o antes gravado: nunca divergente na hora nem nova tentativa; só depois de 5 min, e então a equipe", () => {
    for (const registro of [antes, lido({ chegada: "2026-12-21", saida: "2026-12-29" }), lido({ situacao: "cancelada" })]) {
      expect(saida(registro, { antes: null, agora: depoisDe(4) })).toEqual({ saida: "aguardar" });
      expect(saida(registro, { antes: null })).toEqual({ saida: "equipe", motivo: "incerta" });
    }
    // O que não depende do antes continua: igual ao pedido confere; não voltou, apagada.
    expect(saida(lido({ saida: "2026-12-28" }), { antes: null, agora: depoisDe(1) })).toEqual({ saida: "conferir" });
    expect(saida(null, { antes: null })).toEqual({ saida: "divergente", motivo: "apagada_no_beds24" });
  });

  it("outra coisa no Beds24: divergente com o motivo; a releitura que falhou não conclui", () => {
    expect(saida(lido({ chegada: "2026-12-21", saida: "2026-12-29" }))).toEqual({ saida: "divergente", motivo: "mudada_no_beds24" });
    expect(saida(lido({ saida: "2026-12-28", situacao: "cancelada" }))).toEqual({ saida: "divergente", motivo: "cancelada_no_beds24" });
    expect(saidaDaIncertezaPorId({ pedido: novo, antes, resposta: "tempo", enviadoEm: ENVIADO, agora: depoisDe(6), releitura: { funcionou: false }, jaHouveNovaTentativa: false, buscasSemConclusao: 2 })).toEqual({ saida: "sem_conclusao", buscas: 3, equipe: true });
  });
});

describe("as janelas sem operação nova e os atrasos das falhas (desenho 9)", () => {
  const as = (hhmmss: string) => new Date(`2026-10-17T${hhmmss}Z`);

  it("janelas em UTC, [início, fim): a da importação (9:15) e a do envio diário (10:00)", () => {
    expect(JANELAS_SEM_OPERACAO_NOVA_UTC.map((j) => [j.de, j.inicio, j.fim])).toEqual([["importacao", "09:05", "09:30"], ["envio", "09:50", "10:15"]]);
    expect(dentroDeJanela(as("09:04:59"))).toBeNull();
    expect(dentroDeJanela(as("09:05:00"))).toBe("importacao");
    expect(dentroDeJanela(as("09:15:00"))).toBe("importacao");
    expect(dentroDeJanela(as("09:29:59"))).toBe("importacao");
    expect(dentroDeJanela(as("09:30:00"))).toBeNull();
    expect(dentroDeJanela(as("09:49:00"))).toBeNull();
    expect(dentroDeJanela(as("09:50:00"))).toBe("envio");
    expect(dentroDeJanela(as("10:00:00"))).toBe("envio");
    expect(dentroDeJanela(as("10:14:00"))).toBe("envio");
    expect(dentroDeJanela(as("10:15:00"))).toBeNull();
    // A hora de São Paulo não conta: 9:15 em São Paulo é 12:15 UTC.
    expect(dentroDeJanela(new Date("2026-10-17T09:15:00-03:00"))).toBeNull();
  });

  it("atrasos de 10, 20, 40, 80 e 160 min; na 5ª falha (e nas seguintes), a equipe", () => {
    expect(ATRASOS_FALHA_MINUTOS).toEqual([10, 20, 40, 80, 160]);
    expect([1, 2, 3, 4, 5, 6].map(atrasoDaFalha)).toEqual([
      { minutos: 10, equipe: false }, { minutos: 20, equipe: false }, { minutos: 40, equipe: false }, { minutos: 80, equipe: false }, { minutos: 160, equipe: true }, { minutos: 160, equipe: true },
    ]);
    expect(atrasoDaFalha(0)).toEqual({ minutos: 10, equipe: false });
    expect(atrasoDaFalha(Number.NaN)).toEqual({ minutos: 10, equipe: false });
  });
});

describe("os casos do e-mail à equipe (desenho 6.5)", () => {
  it("conflito, overbooking, divergência, marca ilegível, recusa do POST e 5ª falha; o resto, sem e-mail", () => {
    expect(casoDeEmailBeds24("conflito", "noites_ocupadas", "conflito")).toBe("conflito");
    expect(casoDeEmailBeds24("conferida", "noites_ocupadas", "conferida")).toBe("overbooking");
    for (const m of ["mudada_no_beds24", "cancelada_no_beds24", "apagada_no_beds24"] as const) expect(casoDeEmailBeds24("divergente", m, null)).toBe("divergencia");
    expect(casoDeEmailBeds24("divergente", "marca_ilegivel", null)).toBe("marca_ilegivel");
    for (const m of ["sem_disponibilidade", "recusada_pelo_beds24", "sem_permissao"] as const) expect(casoDeEmailBeds24("aguardando_equipe", m, "recusada")).toBe("recusada");
    expect(casoDeEmailBeds24("aguardando_equipe", "falhas", null)).toBe("falhas");
    // A falta de disponibilidade lida antes do POST (nada enviado), o bloqueio e a incerteza: só a linha do Início.
    expect(casoDeEmailBeds24("aguardando_equipe", "sem_disponibilidade", "conflito")).toBeNull();
    expect(casoDeEmailBeds24("aguardando_equipe", "sem_permissao", null)).toBeNull();
    for (const m of ["bloqueio_manual", "bloqueio_do_scl", "incerta", "duplicada"] as const) expect(casoDeEmailBeds24("aguardando_equipe", m, "conflito")).toBeNull();
    expect(casoDeEmailBeds24("conferida", null, "conferida")).toBeNull();
  });

  it("a lista dos motivos de e-mail e a função não se separam: só os motivos da lista mandam, e cada um manda em algum caso", () => {
    const comEmail = new Set<string>();
    for (const situacao of SITUACOES_ACOMPANHAMENTO_BEDS24) {
      for (const motivo of [...MOTIVOS_ACOMPANHAMENTO_BEDS24, null]) {
        for (const operacao of [...SITUACOES_OPERACAO_BEDS24, null]) if (casoDeEmailBeds24(situacao, motivo, operacao) !== null) comEmail.add(String(motivo));
      }
    }
    expect([...comEmail].sort()).toEqual([...MOTIVOS_DE_EMAIL_BEDS24].sort());
  });
});

describe("a leitura dos escopos guardada", () => {
  it("volta como foi gravada; torta, sem leitura (o lado seguro)", () => {
    const l = { situacao: "incompleto", excessivos: [], faltando: ["write:bookings"], ilegiveis: [] };
    expect(escoposLidosBeds24(l)).toEqual(l);
    for (const v of [null, {}, { ...l, situacao: "ok" }, { ...l, faltando: "write:bookings" }, { ...l, ilegiveis: [1] }]) expect(escoposLidosBeds24(v)).toBeNull();
  });
});
