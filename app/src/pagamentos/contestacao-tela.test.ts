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
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { cancelamentosReserva, contestacoesPagamento, imoveis, lancamentos, organizacoes, pagamentos, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { cancelamentoNoPortal, NAO_DA, pedirCancelamentoPeloHospede } from "@/hospede/cancelamento";
import { formatBRL } from "@/lib/money";
import { avisosDeContestacao } from "@/painel/dashboard";
import { paraOHospede, textoDoCancelamento } from "@/site/pagamento-vista";
import { cancelarReservaContestada, previaDoCancelamentoContestado } from "./cancelamento";
import { conferirTentativa } from "./conferencia";
import { listarPagamentos, vistaDaCotacaoParaHospede } from "./consultas";
import { confirmarResultado, informarPrazoDocumentos, previaDaDecisao, previaDoResultado, registrarContestacaoDaEquipe, registrarDecisao } from "./contestacao";
import { contestacoesDoProprietario, disputaParaOProprietario } from "./contestacao-portal";
import { documentosParaDefesa, lerContestacoesDaEquipe, lerContestacoesDaOperacao, reservaDaContestacao, reservaDoPagamento, textoDoResultadoDaContestacao, textoParaOProprietario } from "./contestacao-tela";
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
    // O débito pode vir antes de o sistema ver a disputa (sem a abertura no Mercado Pago, desde a aprovação); a defesa, não.
    expect(d.acoes.debito).toEqual({ valor: TOTAL, desde: "2026-10-01" });
    expect(d.desde).toBe("2026-10-05");
    expect(d.acoes.resultado?.fatos[0]).toContain("ainda mostra a disputa em andamento");
    expect(d.acoes.resultado?.emAndamento).toBe(true);
    expect(d.acoes.semEfeito).toBeTruthy();
    expect(d.acoes.conferirAviso).toBeNull();
    expect(d.acoes.prazo).toEqual({ desde: "2026-10-05" }); // a order não traz o prazo dos documentos
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
    expect(o.desde).toBe("2026-10-05"); // o envio dos documentos: a partir da abertura da disputa, não da aprovação (01/10)
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
    expect(await documentosParaDefesa(db, outra, x.reservaId, { verValores: true })).toBeNull();
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
    const d = await documentosParaDefesa(db, c.org, x.reservaId, { verValores: true });
    expect(d?.reserva.find(([k]) => k === "Reserva")?.[1]).toBe(x.reservaCodigo);
    expect(d?.pagamentos[0].linhas.find(([k]) => k === "Order no Mercado Pago")?.[1]).toBe(x.idProvedor);
    expect(d?.pagamentos[0].linhas.some(([k, v]) => k.startsWith("Contestação no cartão") && v === `caso ${x.idCaso}`)).toBe(true);
    expect(d?.politica?.titulo).toMatch(/^Política de cancelamento, versão 1/);
    expect(d?.politica?.quando).toContain("Aceita pelo hóspede no site em");
    expect(d?.politica?.blocos.length).toBeGreaterThan(0);
    expect(d?.porFora.length).toBeGreaterThan(2);
    // Sem disputa, nada a montar.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05" });
    expect(await documentosParaDefesa(db, c.org, y.reservaId, { verValores: true })).toBeNull();
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

// ---------------------------------------------------------------- revisão das telas (11/10/2026)

describe("revisão das telas (11/10/2026)", () => {
  const sessaoAdmin = () => sessao("admin");

  it("'Mudar quem arca': o formulário traz a explicação ao proprietário em vigor (o campo não vem vazio); 'Registrar' começa vazio", async () => {
    const x = await disputada();
    const [antes] = await lerContestacoesDaEquipe(db, sessaoAdmin(), x.reservaId, sp("2026-10-05 10:05"));
    expect(antes.acoes.decidir?.explicacao).toBe("");
    await decidir(x.id, "proporcional", sp("2026-10-06 10:00"), "O ar-condicionado do quarto parou.");
    const [d] = await lerContestacoesDaEquipe(db, sessaoAdmin(), x.reservaId, sp("2026-10-06 10:05"));
    expect(d.acoes.decidir?.modo).toBe("mudar");
    expect(d.acoes.decidir?.explicacao).toBe("O ar-condicionado do quarto parou.");
  });

  it("prévia da decisão: cada opção mostra o que o proprietário e a SCL ficam da reserva, com o resultado perdido e com o ganho, também na pergunta", async () => {
    const x = await disputada();
    const pv = await previaDaDecisao(db, c.org, x.id);
    if (!pv.ok) throw new Error(pv.erro);
    const { parteProprietario: D, comissao: C } = pv.fatos.partes;
    const [d] = await lerContestacoesDaEquipe(db, sessaoAdmin(), x.reservaId, sp("2026-10-05 10:05"));
    for (const q of ["proprietario", "scl", "proporcional"] as const) {
      const o = pv.fatos.opcoes[q]!;
      const tela = d.acoes.decidir!.opcoes.find((y) => y.quemArca === q)!;
      expect(tela.fica).toEqual({ perdida: { proprietario: formatBRL(D - o.proprietario), scl: formatBRL(C - o.scl) }, ganha: { proprietario: formatBRL(D), scl: formatBRL(C) } });
      expect(tela.perguntas.imovel).toContain(`Com a disputa perdida, ficam da reserva: proprietário ${formatBRL(D - o.proprietario)}; SCL ${formatBRL(C - o.scl)}.`);
      expect(tela.perguntas.imovel).toContain(`Ganha: proprietário ${formatBRL(D)}; SCL ${formatBRL(C)}.`);
    }
  });

  it("'Texto para o proprietário': sem 'titular do cartão' num MED do Pix; pela situação depois do resultado (ganha volta, sem efeito nada fica, perdida é definitivo)", async () => {
    const x = await pagarEConfirmar(c, { forma: "pix", liberar: true });
    const reg = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "med", abertaEm: "2026-10-05", valor: TOTAL, prazo: null, idCaso: null, nota: "MED visto no painel do Mercado Pago." }, equipe, null, sp("2026-10-05 10:00"));
    if (!reg.ok) throw new Error(reg.erro);
    await decidir(reg.contestacaoId, "proporcional", sp("2026-10-06 10:00"));
    const [d] = await lerContestacoesDaEquipe(db, sessaoAdmin(), x.reservaId, sp("2026-10-06 10:05"));
    const texto = d.decisao!.textoParaProprietario!;
    expect(texto).not.toMatch(/cartão/i);
    expect(texto).toContain(`Disputa do pagamento da reserva ${x.reservaCodigo}`);
    expect(texto).toContain("ficam segurados dos seus próximos repasses até o resultado");
    // Depois da ganha: o valor volta (nunca "são descontados").
    const pr = await previaDoResultado(db, c.org, reg.contestacaoId);
    if (!pr.ok) throw new Error(pr.erro);
    const r = await confirmarResultado(db, c.org, reg.contestacaoId, { resultado: "ganha", data: "2026-10-08", nota: "Painel do Mercado Pago mostra ganha.", notaReforcada: true, versao: pr.fatos.versao, assinatura: pr.fatos.assinatura, tarifa: null }, equipe, null, sp("2026-10-08 10:00"));
    if (!r.ok) throw new Error(r.erro);
    const [g] = await lerContestacoesDaEquipe(db, sessaoAdmin(), x.reservaId, sp("2026-10-08 10:05"));
    expect(g.decisao!.textoParaProprietario).not.toContain("são descontados");
    expect(g.decisao!.textoParaProprietario).toMatch(/A SCL ganhou a disputa em 08\/10: o valor segurado \(R\$ [\d.,]+\) volta no repasse seguinte\./);
    // Puro: sem efeito e perdida.
    const base = { reservaCodigo: "SCL-TESTE1", causa: "Outro", valor: 100000, proprietario: 85000, explicacao: "", resultadoEm: "2026-10-09" };
    expect(textoParaOProprietario({ ...base, situacao: "sem_efeito" })).toContain("A disputa foi encerrada sem efeito: nada fica descontado de você (o valor segurado, R$ 850,00, volta no repasse seguinte).");
    expect(textoParaOProprietario({ ...base, situacao: "perdida" })).toContain("A SCL perdeu a disputa em 09/10: o desconto de R$ 850,00 dos seus repasses fica definitivo.");
    expect(textoParaOProprietario({ ...base, situacao: "aberta", resultadoEm: null })).toContain("R$ 850,00 ficam segurados dos seus próximos repasses até o resultado");
    for (const s of ["aberta", "ganha", "perdida", "sem_efeito"] as const) expect(textoParaOProprietario({ ...base, situacao: s })).not.toMatch(/cartão|titular/i);
  });

  it("Início: a disputa ambígua (aviso do pagamento) aparece com o texto próprio, com ou sem linha no quadro", async () => {
    const textos = async () => (await avisosDeContestacao(db, c.org, sp("2026-10-02 12:00"))).map((a) => `${a.nivel}: ${a.texto}`);
    // Sem linha nenhuma: a busca tardia achou uma disputa já encerrada num pagamento sem disputa no quadro.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05" });
    await db.update(pagamentos).set({ avisos: ["contestacao_ambigua"] }).where(eq(pagamentos.id, y.pagamentoId));
    const so = (await avisosDeContestacao(db, c.org, sp("2026-10-02 12:00"))).find((a) => a.texto.includes("não conseguiu casar"));
    expect(so).toEqual({ nivel: "atencao", texto: "1 disputa(s) do pagamento que o sistema não conseguiu casar com as do quadro: confira no painel do Mercado Pago e registre pelo quadro.", link: `/painel/reservas/${y.reservaId}` });
    // Com linha: a order mostra uma disputa B encerrada que o sistema nunca viu.
    const x = await pagarEConfirmar(c, { forma: "cartao" });
    c.provedor.contestar(x.idProvedor);
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, sp("2026-10-02 10:00"), { origem: "rotina", forcar: true });
    const b = c.provedor.contestar(x.idProvedor);
    c.provedor.resolverContestacao(b.idCaso, { estado: "settled" });
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, sp("2026-10-02 11:00"), { origem: "rotina", forcar: true });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("contestacao_ambigua");
    expect(await textos()).toContain("atencao: 2 disputa(s) do pagamento que o sistema não conseguiu casar com as do quadro: confira no painel do Mercado Pago e registre pelo quadro.");
  });

  it("Minha reserva depois da disputa perdida: sem botão, com 'fale com a equipe' (cartão contestado e MED num Pix que segue aprovado)", async () => {
    const x = await disputada();
    const pr = await previaDoResultado(db, c.org, x.id);
    if (!pr.ok) throw new Error(pr.erro);
    const r = await confirmarResultado(
      db,
      c.org,
      x.id,
      { resultado: "perdida", data: "2026-10-08", nota: "Painel do Mercado Pago mostra perdida.", notaReforcada: true, versao: pr.fatos.versao, assinatura: pr.fatos.assinatura, tarifa: null, valorPerdido: pr.fatos.proposta.valorPerdido!, liquidoNaoEntrou: pr.fatos.proposta.liquidoNaoEntrou!, debitoEm: "2026-10-07" },
      equipe,
      null,
      sp("2026-10-08 10:00"),
    );
    if (!r.ok) throw new Error(r.erro);
    expect(await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, sp("2026-10-09 10:00"))).toMatchObject({ podePedir: false, emConferencia: false, faleComAEquipe: true });
    // MED num Pix: o pagamento segue aprovado; perdida, o botão não volta.
    const y = await pagarEConfirmar(c, { forma: "pix", liberar: true, entrada: "2026-11-02", saida: "2026-11-05" });
    const reg = await registrarContestacaoDaEquipe(db, c.org, y.pagamentoId, { tipo: "med", abertaEm: "2026-10-05", valor: TOTAL, prazo: null, idCaso: null, nota: "MED visto no painel do Mercado Pago." }, equipe, null, sp("2026-10-05 10:00"));
    if (!reg.ok) throw new Error(reg.erro);
    expect(await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, y.reservaCodigo, sp("2026-10-05 11:00"))).toMatchObject({ podePedir: false, emConferencia: true, faleComAEquipe: true });
    const pm = await previaDoResultado(db, c.org, reg.contestacaoId);
    if (!pm.ok) throw new Error(pm.erro);
    const rm = await confirmarResultado(
      db,
      c.org,
      reg.contestacaoId,
      { resultado: "perdida", data: "2026-10-08", nota: "Painel do Mercado Pago mostra a devolução.", notaReforcada: true, versao: pm.fatos.versao, assinatura: pm.fatos.assinatura, tarifa: null, valorPerdido: pm.fatos.proposta.valorPerdido!, liquidoNaoEntrou: pm.fatos.proposta.liquidoNaoEntrou!, debitoEm: "2026-10-07" },
      equipe,
      null,
      sp("2026-10-08 10:00"),
    );
    if (!rm.ok) throw new Error(rm.erro);
    expect((await c.tentativa(y.pagamentoId)).situacao).toBe("aprovado");
    expect(await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, y.reservaCodigo, sp("2026-10-09 10:00"))).toMatchObject({ podePedir: false, emConferencia: false, faleComAEquipe: true });
  });

  it("hóspede da reserva cancelada por 'Cancelar a reserva contestada': 'em conferência', nunca 'não há devolução'", async () => {
    const x = await disputada();
    const quando = sp("2026-10-06 10:00");
    const pv = await previaDoCancelamentoContestado(db, c.org, x.reservaId, quando);
    if (!pv.ok) throw new Error(pv.erro);
    const r = await cancelarReservaContestada(db, c.org, x.reservaId, { nota: "Titular não reconhece a compra.", assinatura: pv.previa.assinatura }, equipe, null, quando);
    if (!r.ok) throw new Error(r.erro);
    const v = await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, sp("2026-10-06 11:00"), { comAutorizacao: false });
    expect(v?.estado).toBe("cancelada_em_conferencia");
    const t = textoDoCancelamento(paraOHospede(v!), TEXTOS_SITE_INICIAIS);
    expect(t.linhas).toContain(TEXTOS_SITE_INICIAIS.cancelamentoEmConferencia);
    expect(t.linhas.join(" ")).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoSemDevolucaoEquipe);
    expect(t.linhas.join(" ")).not.toMatch(/não há devolução|chegou depois|contesta/i);
  });

  it("hóspede da reserva cancelada por 'Cancelar a reserva contestada': perdida a disputa, o dinheiro voltou (nunca 'em conferência' para sempre)", async () => {
    const x = await disputada();
    const pv = await previaDoCancelamentoContestado(db, c.org, x.reservaId, sp("2026-10-06 10:00"));
    if (!pv.ok) throw new Error(pv.erro);
    const r = await cancelarReservaContestada(db, c.org, x.reservaId, { nota: "Titular não reconhece a compra.", assinatura: pv.previa.assinatura }, equipe, null, sp("2026-10-06 10:00"));
    if (!r.ok) throw new Error(r.erro);
    const pm = await previaDoResultado(db, c.org, x.id);
    if (!pm.ok) throw new Error(pm.erro);
    const rm = await confirmarResultado(
      db,
      c.org,
      x.id,
      { resultado: "perdida", data: "2026-10-08", nota: "Painel do Mercado Pago mostra a disputa perdida.", notaReforcada: true, versao: pm.fatos.versao, assinatura: pm.fatos.assinatura, tarifa: null, valorPerdido: pm.fatos.proposta.valorPerdido!, liquidoNaoEntrou: pm.fatos.proposta.liquidoNaoEntrou!, debitoEm: "2026-10-07" },
      equipe,
      null,
      sp("2026-10-08 10:00"),
    );
    if (!rm.ok) throw new Error(rm.erro);
    // O pagamento continua contestado (a disputa perdida), mas a página não fica "em conferência" para sempre.
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("contestado");
    const v = await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, sp("2026-10-09 10:00"), { comAutorizacao: false });
    expect(v?.estado).toBe("cancelada_devolvida");
    const t = textoDoCancelamento(paraOHospede(v!), TEXTOS_SITE_INICIAIS);
    expect(t.linhas).toContain(TEXTOS_SITE_INICIAIS.cancelamentoDevolvidoPelaDisputa);
    expect(t.linhas.join(" ")).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoEmConferencia);
    expect(t.linhas.join(" ")).not.toMatch(/não há devolução|contesta/i);
  });

  it("'Cancelar a reserva contestada' com a disputa de parte do valor, perdida: o resto continua retido, a página fica em conferência (nunca 'voltou') (Codex, 11/10)", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao", liberar: true });
    c.provedor.contestar(x.idProvedor, "order", { valor: 50_000 });
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, sp("2026-10-05 10:00"), { origem: "rotina", forcar: true });
    const [l] = await db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.pagamentoId, x.pagamentoId));
    expect(l).toMatchObject({ situacao: "aberta", valorEmRisco: 50_000 });
    const pv = await previaDoCancelamentoContestado(db, c.org, x.reservaId, sp("2026-10-06 10:00"));
    if (!pv.ok) throw new Error(pv.erro);
    expect(pv.previa.valorRetido).toBe(TOTAL);
    const r = await cancelarReservaContestada(db, c.org, x.reservaId, { nota: "Titular contesta parte da compra.", assinatura: pv.previa.assinatura }, equipe, null, sp("2026-10-06 10:00"));
    if (!r.ok) throw new Error(r.erro);
    const pm = await previaDoResultado(db, c.org, l.id);
    if (!pm.ok) throw new Error(pm.erro);
    expect(pm.fatos.proposta.valorPerdido).toBe(50_000);
    const rm = await confirmarResultado(
      db,
      c.org,
      l.id,
      { resultado: "perdida", data: "2026-10-08", nota: "Painel do Mercado Pago mostra a disputa perdida.", notaReforcada: true, versao: pm.fatos.versao, assinatura: pm.fatos.assinatura, tarifa: null, valorPerdido: 50_000, liquidoNaoEntrou: pm.fatos.proposta.liquidoNaoEntrou!, debitoEm: "2026-10-07" },
      equipe,
      null,
      sp("2026-10-08 10:00"),
    );
    if (!rm.ok) throw new Error(rm.erro);
    // Só R$ 500,00 voltaram ao hóspede pela disputa; o resto do pago continua retido.
    const v = await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, sp("2026-10-09 10:00"), { comAutorizacao: false });
    expect(v?.estado).toBe("cancelada_em_conferencia");
    const t = textoDoCancelamento(paraOHospede(v!), TEXTOS_SITE_INICIAIS);
    expect(t.linhas.join(" ")).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoDevolvidoPelaDisputa);
    expect(t.linhas.join(" ")).not.toMatch(/contesta/i);
  });

  it("'Documentos para a defesa': o valor pago só para quem lê o financeiro; o resumo da reserva segue o desenho (sem o titular)", async () => {
    const x = await disputada();
    const semValores = await documentosParaDefesa(db, c.org, x.reservaId, { verValores: false });
    expect(semValores?.pagamentos[0].linhas.some(([k]) => k === "Valor pago")).toBe(false);
    expect(JSON.stringify(semValores)).not.toMatch(/R\$/);
    const comValores = await documentosParaDefesa(db, c.org, x.reservaId, { verValores: true });
    expect(comValores?.pagamentos[0].linhas.find(([k]) => k === "Valor pago")?.[1]).toBe(formatBRL(TOTAL));
    for (const d of [semValores, comValores]) {
      expect(d?.reserva.map(([k]) => k)).toEqual(["Reserva", "Imóvel", "Entrada e saída", "Pessoas"]);
      expect(JSON.stringify(d)).not.toContain(NOME_HOSPEDE);
    }
  });

  it("caso da Chargebacks API ainda sem cobertura (registrado com o número do caso): o quadro mostra a caixa reforçada no resultado e no sem efeito, e a confirmação conclui", async () => {
    const x = await pagarEConfirmar(c, { forma: "cartao", entrada: "2026-11-20", saida: "2026-11-23" });
    const [p] = await db.select().from(pagamentos).where(eq(pagamentos.id, x.pagamentoId));
    const ids = c.provedor.contestarTarde(p.idPagamentoProvedor!);
    // Registrada pela equipe com o número do caso (a releitura pode já tê-la posto no quadro: "já está no quadro").
    await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-05", valor: TOTAL, prazo: "2026-10-20", idCaso: ids.idCaso, nota: "Vista no painel do Mercado Pago." }, equipe, c.provedor, sp("2026-10-05 10:00"));
    const [l] = await db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.pagamentoId, x.pagamentoId));
    expect(l).toMatchObject({ situacao: "aberta", estadoLido: null, coberturaAplicada: null, idCaso: ids.idCaso });
    const reg = { contestacaoId: l.id };
    const [d] = await lerContestacoesDaEquipe(db, sessaoAdmin(), x.reservaId, sp("2026-10-06 10:00"));
    expect(d.situacao).toBe("aberta");
    expect(d.acoes.resultado?.emAndamento).toBe(true);
    expect(d.acoes.semEfeito?.emAndamento).toBe(true);
    const r = d.acoes.resultado!;
    const entrada = { resultado: "ganha" as const, data: "2026-10-06", nota: "O painel do Mercado Pago já mostra o resultado.", versao: r.versao, assinatura: r.assinatura, tarifa: null };
    expect(await confirmarResultado(db, c.org, reg.contestacaoId, { ...entrada, notaReforcada: false }, equipe, c.provedor, sp("2026-10-06 10:05"))).toMatchObject({ ok: false, codigo: "nota_reforcada" });
    expect(await confirmarResultado(db, c.org, reg.contestacaoId, { ...entrada, notaReforcada: true }, equipe, c.provedor, sp("2026-10-06 10:10"))).toMatchObject({ ok: true });
  });

  it("resultado de uma disputa registrada dias depois de abrir: a data vale desde a abertura no Mercado Pago, no domínio e no formulário (Codex, 11/10)", async () => {
    // Aprovado em 01/10; o MED abriu no Mercado Pago em 02/10 e a equipe o registrou em 06/10.
    const y = await pagarEConfirmar(c, { forma: "pix", liberar: true, entrada: "2026-11-02", saida: "2026-11-05" });
    const reg = await registrarContestacaoDaEquipe(db, c.org, y.pagamentoId, { tipo: "med", abertaEm: "2026-10-02", valor: TOTAL, prazo: null, idCaso: null, nota: "MED visto no painel do Mercado Pago." }, equipe, null, sp("2026-10-06 10:00"));
    if (!reg.ok) throw new Error(reg.erro);
    const [d] = await lerContestacoesDaEquipe(db, sessao("admin"), y.reservaId, sp("2026-10-06 11:00"));
    expect(d.acoes.resultado?.desde).toBe("2026-10-02");
    const r = d.acoes.resultado!;
    const entrada = { resultado: "ganha" as const, nota: "Painel do Mercado Pago mostra o MED recusado.", notaReforcada: true, versao: r.versao, assinatura: r.assinatura, tarifa: null };
    expect(await confirmarResultado(db, c.org, reg.contestacaoId, { ...entrada, data: "2026-10-01" }, equipe, null, sp("2026-10-06 12:00"))).toMatchObject({ ok: false, erro: expect.stringContaining("não pode ser antes de 02/10/2026") });
    // Entre a abertura no Mercado Pago e o registro: a data verdadeira do resultado.
    expect(await confirmarResultado(db, c.org, reg.contestacaoId, { ...entrada, data: "2026-10-04" }, equipe, null, sp("2026-10-06 12:00"))).toMatchObject({ ok: true });
  });

  it("'Pedir o cancelamento' pelo servidor com o MED registrado num Pix que segue aprovado: recusado sob a trava, nada gravado (Codex, 11/10)", async () => {
    const y = await pagarEConfirmar(c, { forma: "pix", liberar: true, entrada: "2026-11-02", saida: "2026-11-05" });
    const reg = await registrarContestacaoDaEquipe(db, c.org, y.pagamentoId, { tipo: "med", abertaEm: "2026-10-05", valor: TOTAL, prazo: null, idCaso: null, nota: "MED visto no painel do Mercado Pago." }, equipe, null, sp("2026-10-05 10:00"));
    if (!reg.ok) throw new Error(reg.erro);
    expect((await c.tentativa(y.pagamentoId)).situacao).toBe("aprovado");
    // O formulário velho (ou o envio direto da ação): o botão já tinha sumido, o servidor também recusa.
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, y.reservaCodigo, sp("2026-10-05 11:00"))).toEqual({ ok: false, erro: NAO_DA });
    expect(await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, y.reservaId))).toEqual([]);
  });

  it("pagamento contestado sem linha no quadro (a leitura ambígua, ou contestado antes do M8.2e): o hóspede vê 'em conferência' e 'fale com a equipe' (Codex, 11/10)", async () => {
    const y = await pagarEConfirmar(c, { forma: "cartao", liberar: true, entrada: "2026-11-02", saida: "2026-11-05" });
    await db.update(pagamentos).set({ situacao: "contestado", avisos: ["contestacao_ambigua"] }).where(eq(pagamentos.id, y.pagamentoId));
    expect(await db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.pagamentoId, y.pagamentoId))).toEqual([]);
    expect(await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, y.reservaCodigo, sp("2026-10-05 11:00"))).toMatchObject({ podePedir: false, emConferencia: true, faleComAEquipe: true });
    expect((await vistaDaCotacaoParaHospede(db, c.org, y.cotacaoId, sp("2026-10-05 11:00"), { comAutorizacao: true }))?.pagamentoEmConferencia).toBe(true);
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, y.reservaCodigo, sp("2026-10-05 11:00"))).toEqual({ ok: false, erro: NAO_DA });
  });

  it("só com uma disputa encerrada no quadro, o pagamento contestado de novo pela leitura que não casou: o hóspede vê 'em conferência', nunca o resultado antigo (Codex, 11/10)", async () => {
    const x = await disputada();
    const pr = await previaDoResultado(db, c.org, x.id);
    if (!pr.ok) throw new Error(pr.erro);
    expect(
      await confirmarResultado(db, c.org, x.id, { resultado: "ganha", data: "2026-10-08", nota: "Painel do Mercado Pago mostra ganha.", notaReforcada: true, versao: pr.fatos.versao, assinatura: pr.fatos.assinatura, tarifa: null }, equipe, null, sp("2026-10-08 10:00")),
    ).toMatchObject({ ok: true });
    const emConferencia = async () => (await vistaDaCotacaoParaHospede(db, c.org, x.cotacaoId, sp("2026-10-09 11:00"), { comAutorizacao: true }))?.pagamentoEmConferencia;
    expect(await emConferencia()).toBeUndefined();
    // Uma disputa nova que a leitura não soube casar: o pagamento contestado de novo, com o aviso.
    await db.update(pagamentos).set({ situacao: "contestado", avisos: ["contestacao_ambigua"] }).where(eq(pagamentos.id, x.pagamentoId));
    expect(await emConferencia()).toBe(true);
    expect(await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, sp("2026-10-09 11:00"))).toMatchObject({ podePedir: false, emConferencia: true });
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, sp("2026-10-09 11:00"))).toEqual({ ok: false, erro: NAO_DA });
  });
});
