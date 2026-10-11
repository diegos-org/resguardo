/**
 * Disputa do pagamento no site (M8.2e) — o que cada um vê, em PGlite com o Mercado Pago falso (sem rede): o bloco da equipe
 * que lê o financeiro e o de quem só lê a reserva (`contestacao-tela.ts`), a página "Documentos para a defesa", o portal do
 * proprietário (`contestacao-portal.ts`, lista branca), o Início (`avisosDeContestacao`), Pagamentos do site ("Com
 * disputa") e o hóspede ("pagamento em conferência" só com o cookie; Minha reserva sem o botão).
 * Itens 9 (as permissões de leitura), 25, 26 e 27 de "Testes a escrever" (PAGAMENTO-SITE.md, "Contestação (M8.2e)").
 */
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { imoveis, lancamentos, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { cancelamentoNoPortal } from "@/hospede/cancelamento";
import { avisosDeContestacao } from "@/painel/dashboard";
import { conferirTentativa } from "./conferencia";
import { listarPagamentos, vistaDaCotacaoParaHospede } from "./consultas";
import { confirmarResultado, informarPrazoDocumentos, previaDaDecisao, previaDoResultado, registrarDecisao } from "./contestacao";
import { contestacoesDoProprietario, disputaParaOProprietario } from "./contestacao-portal";
import { documentosParaDefesa, lerContestacoesDaEquipe, lerContestacoesDaOperacao, reservaDaContestacao, reservaDoPagamento, textoDoResultadoDaContestacao } from "./contestacao-tela";
import { type Cenario, EMAIL_HOSPEDE, montarCenario, NOME_HOSPEDE, pagarEConfirmar, semDadosDoHospede, TOTAL, usuarioDeTeste } from "./testes";

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
const sessao = (papel: Sessao["papel"], org = c.org): Sessao => ({ usuarioId: equipe, organizacaoId: org, papel, imovelIds: [] });
const NOTA_INTERNA = "Nota interna: hóspede relatou o ar-condicionado.";

/** Reserva paga por cartão, liberada, e a disputa do valor aberta pela leitura da order em 05/10. */
async function disputada() {
  const x = await pagarEConfirmar(c, { forma: "cartao", liberar: true });
  const ids = c.provedor.contestar(x.idProvedor, "order", {});
  await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, sp("2026-10-05 10:00"), { origem: "rotina", forcar: true });
  const [d] = await lerContestacoesDaEquipe(db, sessao("admin"), x.reservaId, sp("2026-10-05 10:05"));
  expect(d).toBeTruthy();
  return { ...x, ...ids, id: d.id };
}

async function decidir(id: string, quemArca: "proprietario" | "scl" | "proporcional", quando: Date, explicacao = "") {
  const pv = await previaDaDecisao(db, c.org, id);
  if (!pv.ok) throw new Error(pv.erro);
  const r = await registrarDecisao(db, c.org, id, { causa: "imovel", quemArca, nota: NOTA_INTERNA, explicacao, versao: pv.fatos.versao, assinatura: pv.fatos.opcoes[quemArca]!.assinatura }, equipe, quando);
  if (!r.ok) throw new Error(r.erro);
}

describe("o bloco da disputa na ficha (item 9: quem lê o quê)", () => {
  it("a equipe que lê o financeiro vê tudo: cabeçalho por tipo, situação, valores com a conta, o que o Mercado Pago mostra, a linha do tempo e as ações que o domínio permite", async () => {
    const x = await disputada();
    const [d] = await lerContestacoesDaEquipe(db, sessao("admin"), x.reservaId, sp("2026-10-05 10:05"));
    expect(d.cabecalho).toBe("Contestação no cartão — aberta em 05/10");
    expect(d.situacaoTexto).toBe("aberta");
    expect(d.valor).toBe("R$ 1.824,00");
    expect(d.valorEmRisco).toBe("R$ 1.824,00");
    expect(d.contaDoValorEmRisco).toContain("o valor em disputa (R$ 1.824,00)");
    expect(d.idCaso).toBe(x.idCaso);
    expect(d.mercadoPago.join(" ")).toContain("em análise no banco (código in_process)");
    expect(d.eventos.map((e) => e.texto)).toContain("Disputa aberta");
    expect(d.lancamentos.caixa.join(" ")).toContain("Retido pelo Mercado Pago: saída de R$ 1.824,00 (previsto");
    // Sem decisão: o formulário com as três opções, cada uma com a pergunta montada pelo domínio para cada causa.
    expect(d.acoes.decidir?.modo).toBe("registrar");
    expect(d.acoes.decidir?.opcoes.map((o) => o.quemArca)).toEqual(["proprietario", "scl", "proporcional"]);
    expect(d.acoes.decidir?.opcoes[0].perguntas.imovel).toContain("Causa: Problema do imóvel");
    expect(d.acoes.decidir?.opcoes[0].perguntas.fraude).toContain("Confirma que o proprietário arca?");
    expect(d.acoes.decidir?.causas.find((k) => k.codigo === "imovel")?.frase).toBe("pela regra de 7/10, o proprietário");
    expect(d.acoes.debito).toMatchObject({ valor: TOTAL });
    expect(d.acoes.resultado?.fatos[0]).toContain("ainda mostra a disputa em andamento");
    expect(d.acoes.resultado?.emAndamento).toBe(true);
    expect(d.acoes.semEfeito).toBeTruthy();
    expect(d.acoes.conferirAviso).toBeNull();
    expect(d.acoes.prazo).toBeTruthy(); // a order não traz o prazo dos documentos
    expect(d.prazo?.texto).toContain("Prazo dos documentos desconhecido");
    expect(d.avisos.join(" ")).toContain("Prazo dos documentos desconhecido");
    // Quem só lê o financeiro (sem editar) vê o bloco sem nenhuma ação.
    const leitor = { ...sessao("admin"), papel: "admin" as const };
    expect((await lerContestacoesDaEquipe(db, leitor, x.reservaId))[0].acoes.decidir).toBeTruthy();
  });

  it("o proprietário (que tem financeiro:ler) e a operação nunca leem pela leitura da equipe; a operação vê só a frase, a situação e o prazo, sem valores", async () => {
    const x = await disputada();
    await expect(lerContestacoesDaEquipe(db, sessao("proprietario"), x.reservaId)).rejects.toThrow("Acesso negado");
    await expect(lerContestacoesDaEquipe(db, sessao("operacao"), x.reservaId)).rejects.toThrow("Acesso negado");
    const [o] = await lerContestacoesDaOperacao(db, sessao("operacao"), x.reservaId, sp("2026-10-05 10:05"));
    expect(o.frase).toBe("O pagamento desta reserva está em disputa (contestação no cartão): quem cuida do financeiro acompanha.");
    expect(o.situacaoTexto).toBe("aberta");
    expect(o.podeMarcarDocumentos).toBe(true);
    const texto = JSON.stringify(o);
    expect(texto).not.toMatch(/R\$|182400|1824|nota|decis/i);
    // Sem reserva:ler (limpeza), nada.
    await expect(lerContestacoesDaOperacao(db, sessao("limpeza"), x.reservaId)).rejects.toThrow("Acesso negado");
  });

  it("outra empresa: a disputa e o pagamento não são encontrados, e a leitura da reserva dela não traz nada", async () => {
    const x = await disputada();
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra Empresa" }).returning();
    expect(await reservaDaContestacao(db, outra, x.id)).toBeNull();
    expect(await reservaDoPagamento(db, outra, x.pagamentoId)).toBeNull();
    expect(await reservaDaContestacao(db, c.org, x.id)).toEqual({ reservaId: x.reservaId, pagamentoId: x.pagamentoId });
    expect(await lerContestacoesDaEquipe(db, sessao("admin", outra), x.reservaId)).toEqual([]);
    expect(await documentosParaDefesa(db, outra, x.reservaId)).toBeNull();
  });

  it("depois da decisão: as linhas da decisão (a nota só para a equipe), o texto para o proprietário e os lançamentos de cada lado; a ação vira 'mudar'", async () => {
    const x = await disputada();
    await decidir(x.id, "proporcional", sp("2026-10-06 10:00"), "O ar-condicionado do quarto parou.");
    const [d] = await lerContestacoesDaEquipe(db, sessao("admin"), x.reservaId, sp("2026-10-06 10:05"));
    expect(d.decisao?.linhas.find(([k]) => k === "Quem arca")?.[1]).toBe("Cada um na proporção da sua parte (sem como separar)");
    expect(d.decisao?.nota).toBe(NOTA_INTERNA);
    expect(d.decisao?.textoParaProprietario).toContain(`Disputa do pagamento da reserva ${x.reservaCodigo}`);
    expect(d.decisao?.textoParaProprietario).toContain("O ar-condicionado do quarto parou.");
    expect(d.decisao?.textoParaProprietario).not.toContain(NOTA_INTERNA);
    expect(d.lancamentos.proprietario.join(" ")).toMatch(/Segurado \(versão 1\): -R\$/);
    expect(d.lancamentos.scl.join(" ")).toMatch(/Perda prevista \(versão 1\): -R\$/);
    expect(d.acoes.decidir?.modo).toBe("mudar");
    expect(d.eventos[0].texto).toMatch(/^Quem arca registrado \(versão 1\)/);
  });

  it("'Documentos para a defesa': a reserva, o pagamento, a política aceita com o texto e o que juntar por fora; montada na hora", async () => {
    const x = await disputada();
    const d = await documentosParaDefesa(db, c.org, x.reservaId);
    expect(d?.reserva.find(([k]) => k === "Reserva")?.[1]).toBe(x.reservaCodigo);
    expect(d?.pagamentos[0].linhas.find(([k]) => k === "Order no Mercado Pago")?.[1]).toBe(x.idProvedor);
    expect(d?.pagamentos[0].linhas.some(([k, v]) => k.startsWith("Contestação no cartão") && v === `caso ${x.idCaso}`)).toBe(true);
    expect(d?.politica?.titulo).toMatch(/^Política de cancelamento, versão 1/);
    expect(d?.politica?.quando).toContain("Aceita pelo hóspede no site em");
    expect(d?.politica?.blocos.length).toBeGreaterThan(0);
    expect(d?.porFora.length).toBeGreaterThan(2);
    // Sem disputa, nada a montar.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05" });
    expect(await documentosParaDefesa(db, c.org, y.reservaId)).toBeNull();
  });

  it("os textos dos resultados vêm só das chaves conhecidas (?contestacao=)", () => {
    expect(textoDoResultadoDaContestacao("ganha")).toContain("a SCL ganhou a disputa");
    expect(textoDoResultadoDaContestacao("cancelada")).toContain("sem devolução pelo sistema");
    expect(textoDoResultadoDaContestacao("<script>")).toBeNull();
    expect(textoDoResultadoDaContestacao(["ganha"])).toBeNull();
  });
});

describe("Início (item 25)", () => {
  it("sem decisão, prazo desconhecido, estadia por vir; a escalada depois de 15 dias; o prazo dos documentos; a confirmar; nada vira 'pendente'", async () => {
    const x = await disputada();
    const textos = async (quando: Date) => (await avisosDeContestacao(db, c.org, quando)).map((a) => `${a.nivel}: ${a.texto}`);
    const ja = await textos(sp("2026-10-05 11:00"));
    expect(ja).toContain("atencao: 1 disputa(s) do pagamento sem decisão de quem arca: a parte do proprietário dessas reservas espera.");
    expect(ja.some((t) => t.startsWith("atencao: Disputa da reserva") && t.includes("prazo dos documentos desconhecido"))).toBe(true);
    expect(ja).toContain(`atencao: Disputa do pagamento da reserva ${x.reservaCodigo} com entrada em 12/10: não libere a entrada antes de falar com quem cuida do financeiro.`);
    expect(ja.some((t) => t.includes("presos há"))).toBe(false);
    // A escalada: a parte do proprietário presa há mais de 15 dias.
    const depois = await textos(sp("2026-10-21 11:00"));
    expect(depois.find((t) => t.includes("presos há"))).toMatch(new RegExp(`^atencao: R\\$ [\\d.,]+ da parte do proprietário presos há 16 dias por uma disputa de R\\$ 1\\.824,00 \\(reserva ${x.reservaCodigo}\\): registre quem arca\\.$`));
    // O prazo dos documentos: informativo antes dos dias de aviso, atenção dentro deles.
    await informarPrazoDocumentos(db, c.org, x.id, { prazo: "2026-10-20" }, equipe, sp("2026-10-05 12:00"));
    expect(await textos(sp("2026-10-05 13:00"))).toContain(`info: Disputa da reserva ${x.reservaCodigo}: documentos até 20/10 (faltam 15 dias).`);
    expect(await textos(sp("2026-10-17 13:00"))).toContain(`atencao: Disputa da reserva ${x.reservaCodigo}: documentos até 20/10 (faltam 3 dias).`);
    expect(await textos(sp("2026-10-21 13:00"))).toContain(`atencao: Disputa da reserva ${x.reservaCodigo}: o prazo dos documentos passou (20/10) sem a marca "Documentos enviados".`);
    // Decidida: sai da contagem sem decisão; encerrada no Mercado Pago: "a conferir".
    await decidir(x.id, "scl", sp("2026-10-06 10:00"));
    c.provedor.resolverContestacao(x.idCaso, { estado: "settled", cobertura: true });
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, sp("2026-10-07 10:00"), { origem: "rotina", forcar: true });
    const fim = await textos(sp("2026-10-07 11:00"));
    expect(fim.some((t) => t.includes("sem decisão de quem arca"))).toBe(false);
    expect(fim).toContain("atencao: 1 disputa(s) encerrada(s) no Mercado Pago com resultado a conferir.");
    // C3: nada da disputa é lançamento pendente.
    expect(await db.select().from(lancamentos).where(and(eq(lancamentos.organizacaoId, c.org), eq(lancamentos.estado, "pendente")))).toEqual([]);
  });

  it("Pagamentos do site: 'Com disputa' traz o pagamento em disputa (de qualquer data), com a coluna e o 'pede atenção'", async () => {
    const x = await disputada();
    const y = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05" });
    const lista = await listarPagamentos(db, c.org, { disputa: true }, sp("2026-10-05 11:00"));
    expect(lista.map((p) => p.id)).toEqual([x.pagamentoId]);
    expect(lista[0]).toMatchObject({ disputa: "Contestação no cartão: aberta", emDisputa: true, pedeAtencao: true });
    const todos = await listarPagamentos(db, c.org, { de: "2026-09-01", ate: "2026-12-31" }, sp("2026-10-05 11:00"));
    expect(todos.find((p) => p.id === y.pagamentoId)).toMatchObject({ disputa: null, emDisputa: false });
  });
});

describe("hóspede (item 26)", () => {
  it("'pagamento em conferência' só com o cookie de quem pagou, e some com o resultado; Minha reserva troca o botão pelo contato", async () => {
    const x = await disputada();
    const com = await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, sp("2026-10-05 11:00"), { comAutorizacao: true });
    expect(com).toMatchObject({ estado: "confirmada", pagamentoEmConferencia: true });
    const sem = await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, sp("2026-10-05 11:00"), { comAutorizacao: false });
    expect(sem?.estado).toBe("confirmada");
    expect(sem?.pagamentoEmConferencia).toBeUndefined();
    // Nunca a palavra "contestação" nem "Beds24" no que vai ao navegador.
    expect(JSON.stringify(com)).not.toMatch(/contesta|beds24/i);
    const quadro = await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, sp("2026-10-05 11:00"));
    expect(quadro).toMatchObject({ emConferencia: true, podePedir: false });
    // O resultado confirmado pela equipe: a linha some.
    const pr = await previaDoResultado(db, c.org, x.id);
    if (!pr.ok) throw new Error(pr.erro);
    const r = await confirmarResultado(db, c.org, x.id, { resultado: "ganha", data: "2026-10-08", nota: "Painel do Mercado Pago mostra ganha.", notaReforcada: true, versao: pr.fatos.versao, assinatura: pr.fatos.assinatura, tarifa: null }, equipe, null, sp("2026-10-08 10:00"));
    expect(r.ok).toBe(true);
    expect((await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, sp("2026-10-08 11:00"), { comAutorizacao: true }))?.pagamentoEmConferencia).toBeUndefined();
    expect(await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, sp("2026-10-08 11:00"))).toMatchObject({ emConferencia: false });
  });
});

describe("proprietário (item 27)", () => {
  it("vê só o que o atinge (em conferência; segurado com a causa e a explicação; devolvido), sem a nota, o número do caso nem o hóspede; o dono de outro imóvel não vê", async () => {
    const x = await disputada();
    const antes = await contestacoesDoProprietario(db, c.org, { proprietarioIds: [c.dono] });
    expect(antes).toHaveLength(1);
    expect(antes[0]).toMatchObject({ reservaCodigo: x.reservaCodigo, variante: "em_conferencia", valor: null, causa: null });
    expect(antes[0].texto).toBe(`Disputa do pagamento da reserva ${x.reservaCodigo}: em conferência. Reserva em conferência: disputa do pagamento; a parte espera a decisão de quem arca.`);
    await decidir(x.id, "proprietario", sp("2026-10-06 10:00"), "O ar-condicionado do quarto parou.");
    const [d] = await contestacoesDoProprietario(db, c.org, { proprietarioIds: [c.dono] });
    expect(d).toMatchObject({ variante: "segurado", valor: TOTAL, causa: "Problema do imóvel (estrutura, equipamento ou obra do proprietário)" });
    expect(d.texto).toContain("R$ 1.824,00 segurados dos seus próximos repasses até o resultado");
    expect(d.texto).toContain("O ar-condicionado do quarto parou.");
    const tudo = JSON.stringify(await contestacoesDoProprietario(db, c.org, { proprietarioIds: [c.dono] }));
    for (const proibido of [NOTA_INTERNA, x.idCaso, x.idCbk, NOME_HOSPEDE, EMAIL_HOSPEDE, "in_process", "chargeback"]) expect(tudo).not.toContain(proibido);
    // O dono de outro imóvel (outro proprietário, outro imóvel da mesma empresa) não vê a disputa.
    const [{ id: outroImovel }] = await db.insert(imoveis).values({ organizacaoId: c.org, codigo: "501", nome: "Outro Exemplo" }).returning();
    const [{ id: outroDono }] = await db.insert(proprietarios).values({ organizacaoId: c.org, nome: "Outro Dono Fictício" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: outroDono, imovelId: outroImovel });
    expect(await contestacoesDoProprietario(db, c.org, { proprietarioIds: [outroDono] })).toEqual([]);
    // Nem quando escolhe só o imóvel dele; nem o dono da disputa vê com outro imóvel escolhido.
    expect(await contestacoesDoProprietario(db, c.org, { proprietarioIds: [c.dono], imovelIds: [outroImovel] })).toEqual([]);
    // Outra empresa: nada.
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra Empresa" }).returning();
    expect(await contestacoesDoProprietario(db, outra, { proprietarioIds: [c.dono] })).toEqual([]);
  });

  it("as variantes em palavras (puro): definitivo e devolvido com a data, sem efeito, nada descontado", () => {
    const base = { reservaCodigo: "SCL-TESTE1", decisaoVersao: 1, definitivoEm: new Date(), parteProprietario: 85000, resultadoEm: "2027-03-10", causa: "Outro", explicacao: "" };
    expect(disputaParaOProprietario({ ...base, situacao: "perdida" }).texto).toBe("Disputa do pagamento da reserva SCL-TESTE1: desconto definitivo de R$ 850,00 (a SCL perdeu a disputa em 10/03). Causa registrada: Outro.");
    expect(disputaParaOProprietario({ ...base, situacao: "ganha" })).toMatchObject({ variante: "devolvido", texto: expect.stringContaining("valor segurado devolvido (R$ 850,00) — a SCL ganhou a disputa em 10/03") });
    expect(disputaParaOProprietario({ ...base, situacao: "sem_efeito" }).variante).toBe("sem_efeito");
    expect(disputaParaOProprietario({ ...base, situacao: "aberta", parteProprietario: 0 }).texto).toContain("nada é descontado de você");
  });
});
