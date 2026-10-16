import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { auditoria, configuracoes, organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { gravarConfig, travarConfig, travarConfigCompartilhada } from "./armazem";
import { versaoAtual } from "./documentos-versionados";
import { type DadosEmpresa, lerEmpresa, salvarEmpresa } from "./empresa";
import { camposDesatualizados, lerPaginaLegal, lerPaginasLegais, publicarPaginaLegal, regraDaPoliticaDeCancelamento, versaoAtualDaPaginaLegal, versoesLegaisAtuais, versoesLegaisTravadas } from "./paginas-legais";
import { RASCUNHO_PAGINAS_LEGAIS } from "./paginas-legais-rascunho";
import { publicarPaginasLegaisDeTeste, VALORES_LEGAIS_DE_TESTE } from "./paginas-legais-testes";
import {
  blocosDoDocumento,
  CAMPOS_LEGAIS,
  citaBeds24,
  conferirCampos,
  DOCUMENTOS_LEGAIS,
  type DocumentoLegal,
  FRASE_LIMITE_ARREPENDIMENTO,
  MENSAGEM_ARREPENDIMENTO_SEM_LIMITE,
  mensagemDosCampos,
  PAGINAS_LEGAIS,
  prazoDoReembolso,
  preencherCampos,
  regrasComPadrao,
  rotuloDoCampo,
  validarPaginaLegal,
  valoresDisponiveis,
} from "./paginas-legais-texto";

// As travas da configuração são espiadas: o pagamento lê as três versões sob a trava compartilhada, e a publicação
// usa a exclusiva da própria chave.
vi.mock("./armazem", async (orig) => {
  const m = await orig<typeof import("./armazem")>();
  return { ...m, travarConfig: vi.fn(m.travarConfig), travarConfigCompartilhada: vi.fn(m.travarConfigCompartilhada) };
});

let db: Db, close: () => Promise<void>, org: string, outra: string, admin: string;

// Dados fictícios da empresa, com todos os campos que os textos-base usam.
const EMPRESA: DadosEmpresa = {
  nome: "Casa Exemplo",
  razaoSocial: "Casa Exemplo Temporada Ltda.",
  cnpj: "00.000.000/0001-00",
  email: "contato@example.com",
  telefone: "(21) 90000-0000",
  endereco: "Rua Fictícia, 100, Rio de Janeiro, RJ",
  encarregado: "Pessoa Exemplo",
  site: "",
  chavePix: "",
};
const entradaBase = (doc: DocumentoLegal, mudar: Partial<{ resumo: string; texto: string; dias: number | null }> = {}) => {
  const r = RASCUNHO_PAGINAS_LEGAIS[doc];
  const secoes = { ...r.secoes, ...(mudar.resumo !== undefined ? { resumo: mudar.resumo } : {}), ...(mudar.texto !== undefined ? { texto: mudar.texto } : {}) };
  return { secoes, diasReembolsoIntegral: mudar.dias !== undefined ? mudar.dias : r.diasReembolsoIntegral };
};
const publicar = (doc: DocumentoLegal, hoje = "2026-10-10", base?: number, mudar?: Parameters<typeof entradaBase>[1], o = org) => publicarPaginaLegal(db, o, doc, entradaBase(doc, mudar), admin, hoje, base);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outra }] = await db.insert(organizacoes).values([{ nome: "Casa Exemplo" }, { nome: "Outra Casa" }]).returning();
  [{ id: admin }] = await db.insert(usuarios).values({ organizacaoId: org, email: "admin@example.com", nome: "Admin", papel: "admin" }).returning();
});
afterEach(() => close());

describe("campos {{...}} das páginas legais (M7.4)", () => {
  it("conferir: campo desconhecido, prazo fora da política de cancelamento, campo vazio e só os valores usados", () => {
    const valores = { nome_empresa: "Casa Exemplo", razao_social: "Casa Exemplo Ltda.", cnpj: " ", dias_reembolso_integral: "14" };
    const c = conferirCampos("termos", { texto: "{{ nome_empresa }}, CNPJ {{cnpj}}. {{cnpjj}} {{dias_reembolso_integral}} {{nome_empresa}}", resumo: "{{endereco}}" }, valores);
    // O termos não tem resumo: o que vier nessa chave não conta.
    expect(c).toEqual({
      usados: ["nome_empresa", "cnpj"],
      desconhecidos: ["cnpjj"],
      foraDoLugar: ["dias_reembolso_integral"],
      vazios: ["cnpj"],
      valoresUsados: { nome_empresa: "Casa Exemplo" },
      possiveis: ["nome_empresa", "razao_social", "cnpj", "endereco", "email_contato", "telefone_contato", "encarregado"],
    });
    expect(mensagemDosCampos(c)).toBe(
      "O texto usa {{cnpjj}}, que não existe. Campos possíveis: {{nome_empresa}}, {{razao_social}}, {{cnpj}}, {{endereco}}, {{email_contato}}, {{telefone_contato}}, {{encarregado}}. " +
        "{{dias_reembolso_integral}} só pode ser usado na Política de cancelamento. Preencha em Configurações → Empresa antes de publicar: CNPJ.",
    );
    // No cancelamento o prazo vale, e o resumo também é conferido.
    const cancelamento = conferirCampos("cancelamento", { resumo: "Até {{dias_reembolso_integral}} dias.", texto: "Fale com {{email_contato}} ou {{encarregado}}." }, { dias_reembolso_integral: "14", email_contato: "contato@example.com" });
    expect(cancelamento).toMatchObject({ usados: ["email_contato", "encarregado", "dias_reembolso_integral"], foraDoLugar: [], desconhecidos: [], vazios: ["encarregado"] });
    expect(cancelamento.valoresUsados).toEqual({ email_contato: "contato@example.com", dias_reembolso_integral: "14" });
    expect(mensagemDosCampos(cancelamento)).toBe("Preencha em Configurações → Empresa antes de publicar: encarregado pela proteção de dados.");
    expect(mensagemDosCampos(conferirCampos("privacidade", { texto: "{{razao_social}} {{email_contato}} {{telefone_contato}}" }, {}))).toBe(
      "Preencha em Configurações → Empresa antes de publicar: razão social, e-mail de contato, telefone / WhatsApp.",
    );
    expect(mensagemDosCampos(conferirCampos("cancelamento", { resumo: "{{dias_reembolso_integral}}", texto: "x" }, {}))).toBe("Informe em quantos dias antes da entrada vale o reembolso integral.");
    expect(mensagemDosCampos(conferirCampos("termos", { texto: "Sem campos." }, {}))).toBeNull();
    expect(mensagemDosCampos(conferirCampos("termos", { texto: "{{a}} {{b}}" }, {}))).toContain("O texto usa {{a}}, {{b}}, que não existem.");
    expect(rotuloDoCampo("cnpj")).toBe("CNPJ");
    expect(rotuloDoCampo("x")).toBe("x");
  });

  it("valores disponíveis vêm da empresa (vazio fica de fora) e o prazo, da regra da política", () => {
    expect(valoresDisponiveis({ ...EMPRESA, cnpj: "", encarregado: "  " }, { diasReembolsoIntegral: 14 })).toEqual({
      nome_empresa: "Casa Exemplo",
      razao_social: "Casa Exemplo Temporada Ltda.",
      endereco: "Rua Fictícia, 100, Rio de Janeiro, RJ",
      email_contato: "contato@example.com",
      telefone_contato: "(21) 90000-0000",
      dias_reembolso_integral: "14",
    });
    expect(valoresDisponiveis(EMPRESA, null)).not.toHaveProperty("dias_reembolso_integral");
  });

  it("preencher: valor no lugar do campo; ausente vira vazio no site ou o aviso da prévia", () => {
    const valores = { nome_empresa: "Casa Exemplo", cnpj: "00.000.000/0001-00" };
    expect(preencherCampos("{{nome_empresa}}, CNPJ {{ cnpj }}, {{endereco}}{{x}}.", valores)).toBe("Casa Exemplo, CNPJ 00.000.000/0001-00, .");
    expect(preencherCampos("{{nome_empresa}} em {{endereco}} {{x}}", valores, (c) => `[falta: ${rotuloDoCampo(c)}]`)).toBe("Casa Exemplo em [falta: Endereço] [falta: x]");
    // Nome de propriedade do objeto não é campo.
    expect(preencherCampos("{{constructor}}", valores)).toBe("");
  });
});

describe("texto das páginas legais em blocos (M7.4)", () => {
  it("título, parágrafo com quebras, listas com - e com 1. (e o número inicial), frase de abertura seguida de lista", () => {
    const texto = "## Quem somos\r\n\r\nPrimeira linha\r\nsegunda linha\r\n\r\nNão é permitido:\n- mentir;\n• burlar.\n\n3. três\n4) quatro\n\n## Fim\nDepois do título.\n1. um\nTexto solto.";
    expect(blocosDoDocumento(texto)).toEqual([
      { tipo: "titulo", texto: "Quem somos" },
      { tipo: "paragrafo", texto: "Primeira linha\nsegunda linha" },
      { tipo: "paragrafo", texto: "Não é permitido:" },
      { tipo: "lista", ordenada: false, inicio: 1, itens: ["mentir;", "burlar."] },
      { tipo: "lista", ordenada: true, inicio: 3, itens: ["três", "quatro"] },
      { tipo: "titulo", texto: "Fim" },
      { tipo: "paragrafo", texto: "Depois do título." },
      { tipo: "lista", ordenada: true, inicio: 1, itens: ["um"] },
      { tipo: "paragrafo", texto: "Texto solto." },
    ]);
    expect(blocosDoDocumento("  \n\n \n")).toEqual([]);
    // "##" sem espaço não é título; "-" sem espaço não é lista.
    expect(blocosDoDocumento("##Nada\n-nada")).toEqual([{ tipo: "paragrafo", texto: "##Nada\n-nada" }]);
  });

  it("prazo do reembolso integral: entrada menos os dias, valendo até o fim desse dia", () => {
    expect(prazoDoReembolso("2026-10-12", 14, "2026-09-20")).toEqual({ tipo: "integral_ate", data: "2026-09-28" });
    expect(prazoDoReembolso("2026-10-12", 14, "2026-09-28")).toEqual({ tipo: "integral_ate", data: "2026-09-28" });
    expect(prazoDoReembolso("2026-10-12", 14, "2026-09-29")).toEqual({ tipo: "sem_reembolso", dias: 14 });
    // Atravessa mês e ano pelo calendário.
    expect(prazoDoReembolso("2027-01-05", 14, "2026-12-01")).toEqual({ tipo: "integral_ate", data: "2026-12-22" });
    expect(() => prazoDoReembolso("12/10/2026", 14, "2026-09-01")).toThrow();
  });

  it("validar o formulário: todas as seções escritas e no limite; prazo inteiro de 1 a 365 só no cancelamento", () => {
    expect(validarPaginaLegal("cancelamento", { texto: "Texto.", diasReembolsoIntegral: "14" })).toEqual({
      ok: false,
      erros: { resumo: "Escreva esta parte antes de publicar." },
      mensagem: "Confira os campos destacados.",
    });
    for (const dias of ["0", "366", "1.5", "", "abc", "-3", "1000"]) {
      expect(validarPaginaLegal("cancelamento", { resumo: "R", texto: "T", diasReembolsoIntegral: dias })).toMatchObject({ ok: false, erros: { diasReembolsoIntegral: "Informe um número de dias entre 1 e 365." } });
    }
    // A caixa do limite do arrependimento (M8.2c) vem desmarcada quando o formulário não a manda: o texto "T" não diz o contrário.
    expect(validarPaginaLegal("cancelamento", { resumo: " R\r\n\r\nS ", texto: "T", diasReembolsoIntegral: " 14 " })).toEqual({ ok: true, entrada: { secoes: { resumo: "R\n\nS", texto: "T" }, diasReembolsoIntegral: 14, arrependimentoAteEntrada: false } });
    expect(validarPaginaLegal("cancelamento", { resumo: "R", texto: "T", diasReembolsoIntegral: 365 })).toMatchObject({ ok: true, entrada: { diasReembolsoIntegral: 365 } });
    // Termos: só o texto (o resumo e o prazo enviados são ignorados), dentro do limite.
    expect(validarPaginaLegal("termos", { texto: "T", resumo: "ignorado", diasReembolsoIntegral: "0", arrependimentoAteEntrada: "on" })).toEqual({ ok: true, entrada: { secoes: { texto: "T" }, diasReembolsoIntegral: null, arrependimentoAteEntrada: null } });
    expect(validarPaginaLegal("privacidade", { texto: "x".repeat(30_001) })).toMatchObject({ ok: false, erros: { texto: "Máximo de 30000 caracteres." } });
    expect(validarPaginaLegal("privacidade", {})).toMatchObject({ ok: false, erros: { texto: "Escreva esta parte antes de publicar." } });
  });

  it("o aviso do Beds24 pega a palavra solta, em qualquer caixa, e não pedaço de nome", () => {
    expect(citaBeds24("Usamos o BEDS24 para o calendário.")).toBe(true);
    expect(citaBeds24("organizacaoBeds24 e beds24x")).toBe(false);
  });
});

describe("textos-base das páginas legais (M7.4)", () => {
  it("seções certas, só campos conhecidos e no lugar certo, o prazo pelo campo, dentro dos limites e sem o Beds24", () => {
    const todos = valoresDisponiveis(EMPRESA, { diasReembolsoIntegral: 14 });
    for (const doc of DOCUMENTOS_LEGAIS) {
      const r = RASCUNHO_PAGINAS_LEGAIS[doc];
      expect(Object.keys(r.secoes)).toEqual(PAGINAS_LEGAIS[doc].secoes.map((s) => s.chave));
      const c = conferirCampos(doc, r.secoes, todos);
      expect(c.desconhecidos, doc).toEqual([]);
      expect(c.foraDoLugar, doc).toEqual([]);
      expect(mensagemDosCampos(c), doc).toBeNull();
      // O formulário manda a caixa do limite do arrependimento como o texto-base (M8.2c).
      expect(validarPaginaLegal(doc, { ...r.secoes, diasReembolsoIntegral: String(r.diasReembolsoIntegral ?? ""), arrependimentoAteEntrada: r.arrependimentoAteEntrada ? "on" : "" }).ok, doc).toBe(true);
      // Cada texto começa por um título e não tem marcador quebrado.
      expect(blocosDoDocumento(r.secoes.texto)[0].tipo, doc).toBe("titulo");
      for (const t of Object.values(r.secoes)) expect(t).not.toMatch(/\{\{(?![a-z_]+\}\})|(?<!\{\{[a-z_]+)\}\}/);
    }
    expect(RASCUNHO_PAGINAS_LEGAIS.cancelamento.diasReembolsoIntegral).toBe(14);
    expect(RASCUNHO_PAGINAS_LEGAIS.termos.diasReembolsoIntegral).toBeNull();
    const cancelamento = conferirCampos("cancelamento", RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes, todos);
    expect(cancelamento.usados).toContain("dias_reembolso_integral");
    expect(RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes.resumo).toContain("{{dias_reembolso_integral}}");
    expect(conferirCampos("privacidade", RASCUNHO_PAGINAS_LEGAIS.privacidade.secoes, todos).usados).toContain("encarregado");
    // Decisão de 7/10 (M5.9): o hóspede nunca lê o nome Beds24.
    const tudo = JSON.stringify(RASCUNHO_PAGINAS_LEGAIS);
    expect(tudo).not.toMatch(/beds24/i);
    expect(DOCUMENTOS_LEGAIS.some((doc) => Object.values(RASCUNHO_PAGINAS_LEGAIS[doc].secoes).some(citaBeds24))).toBe(false);
    // O aceite é no pagamento (não ao segurar as datas): as edições do desenho estão no texto.
    expect(tudo).not.toContain("Antes de segurar as datas, você marca");
    expect(RASCUNHO_PAGINAS_LEGAIS.termos.secoes.texto).toContain("Antes de pagar pelo site, você marca que leu e aceita estes termos e a Política de cancelamento e que leu a Política de privacidade.");
    expect(RASCUNHO_PAGINAS_LEGAIS.termos.secoes.texto).toContain("2. Para segurar as datas, informa nome, e-mail e WhatsApp. As datas");
    expect(RASCUNHO_PAGINAS_LEGAIS.termos.secoes.texto).toContain("3. Dentro desse prazo, você lê o resumo da Política de cancelamento");
    expect(RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes.texto).toContain("que você aceitou ao pagar");
    expect(RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes.texto).toContain("a data-limite da sua reserva aparece antes do pagamento e na página da reserva");
    expect(RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes.texto).not.toContain("## Resumo");
    expect(RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes.resumo).toContain("Os detalhes estão na Política de cancelamento.");
    expect(RASCUNHO_PAGINAS_LEGAIS.privacidade.secoes.texto).toMatch(/- Pagamento: [^\n]+\n- Aceite dos termos: quais versões/);
    // M8.2b: o que o cartão guarda (bandeira, parcelas, valor pago com os juros, resultado da verificação), nunca o número.
    const pagamento = /- Pagamento: ([^\n]+)/.exec(RASCUNHO_PAGINAS_LEGAIS.privacidade.secoes.texto)![1];
    expect(pagamento).toContain("no cartão, também a bandeira, o número de parcelas, o valor pago com os juros e o resultado da verificação do banco, nunca o número do cartão");
    expect(pagamento).not.toMatch(/últimos dígitos|final do cartão/);
    // M7.14: os formulários de proprietários guardam o registro da autorização; a linha deles diz isso.
    const proprietarios = /- Proprietários que nos procuram pelo site: ([^\n]+)/.exec(RASCUNHO_PAGINAS_LEGAIS.privacidade.secoes.texto)![1];
    expect(proprietarios).toContain("o registro da autorização dada no formulário (o texto autorizado, a versão dele e a data e a hora do envio)");
    // M0.9: o serviço que registra os erros técnicos está na lista de fornecedores e nos dados fora do Brasil, dizendo o
    // que recebe e o que não recebe; continua sem ferramenta de análise de audiência.
    const privacidade = RASCUNHO_PAGINAS_LEGAIS.privacidade.secoes.texto;
    const sentry = /- Sentry, ([^\n]+)/.exec(privacidade)![1];
    expect(sentry).toContain("que registra os erros técnicos do site para a gente corrigir");
    // M0.9 (revisão): o aviso leva também o caminho até o erro (os rastros do Sentry), e o texto diz isso, sem "só".
    expect(sentry).toContain("o caminho até ele (as páginas abertas, os botões tocados e as chamadas feitas pela página logo antes, sem o que foi digitado)");
    expect(sentry).not.toMatch(/recebe só/);
    expect(sentry).toContain("não recebe seu nome, seus contatos, seus documentos nem seus dados de pagamento, e não guarda o seu IP");
    expect(privacidade).toContain("hospedagem do site, banco de dados, registro de erros técnicos, envio de e-mails e pagamento");
    expect(privacidade).toContain("Não usamos cookies de publicidade nem ferramentas de análise de audiência");
  });
});

describe("publicar as páginas legais (M7.4)", () => {
  it("recusa enquanto faltam dados da empresa usados no texto, dizendo quais, e não grava nada", async () => {
    const termos = await publicar("termos", "2026-10-10", 0);
    expect(termos).toEqual({ ok: false, erro: "Preencha em Configurações → Empresa antes de publicar: razão social, CNPJ, endereço, e-mail de contato, telefone / WhatsApp.", atual: null });
    expect(await publicar("privacidade", "2026-10-10", 0)).toMatchObject({ ok: false, erro: expect.stringContaining("encarregado pela proteção de dados") });
    await salvarEmpresa(db, org, { ...EMPRESA, encarregado: "" }, admin);
    expect(await publicar("privacidade", "2026-10-10", 0)).toMatchObject({ ok: false, erro: "Preencha em Configurações → Empresa antes de publicar: encarregado pela proteção de dados." });
    expect(await lerPaginasLegais(db, org)).toEqual({ termos: [], privacidade: [], cancelamento: [] });
    expect(await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.entidade, "configuracao"), eq(auditoria.acao, "configuracao.politica_privacidade")))).toEqual([]);
  });

  it("v1 de cada documento com numeração própria, valores usados congelados, nada muda sem mudança e cada um no seu histórico", async () => {
    await salvarEmpresa(db, org, EMPRESA, admin);
    expect(await versoesLegaisAtuais(db, org)).toBeNull();
    expect(await publicar("termos", "2026-10-10", 0)).toMatchObject({ ok: true, mudou: true, versao: { numero: 1, data: "2026-10-10", autorId: admin, regras: null } });
    expect(await versaoAtualDaPaginaLegal(db, org, "privacidade")).toBeNull();
    expect(await publicar("privacidade", "2026-10-10", 0)).toMatchObject({ ok: true, versao: { numero: 1 } });
    expect(await versoesLegaisAtuais(db, org)).toBeNull();
    // A privacidade sozinha já tem versão em vigor (o aviso do formulário de segurar as datas não espera os outros).
    expect(await versaoAtualDaPaginaLegal(db, org, "privacidade")).toBe(1);
    expect(await versaoAtualDaPaginaLegal(db, org, "cancelamento")).toBeNull();
    const c1 = await publicar("cancelamento", "2026-10-10", 0);
    expect(c1).toMatchObject({ ok: true, versao: { numero: 1, regras: { diasReembolsoIntegral: 14 } } });
    expect(await versoesLegaisAtuais(db, org)).toEqual({ termos: 1, privacidade: 1, cancelamento: 1 });
    expect(await regraDaPoliticaDeCancelamento(db, org, 1)).toEqual({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: true });
    expect(await regraDaPoliticaDeCancelamento(db, org, 2)).toBeNull();

    // Só os campos usados ficam na versão (o termos não usa o encarregado; o cancelamento não usa o CNPJ).
    const [termos] = await lerPaginaLegal(db, org, "termos");
    expect(termos.valores).toEqual({ nome_empresa: "Casa Exemplo", razao_social: "Casa Exemplo Temporada Ltda.", cnpj: "00.000.000/0001-00", endereco: "Rua Fictícia, 100, Rio de Janeiro, RJ", email_contato: "contato@example.com", telefone_contato: "(21) 90000-0000" });
    expect(termos.secoes).toEqual({ texto: RASCUNHO_PAGINAS_LEGAIS.termos.secoes.texto });
    const [cancelamento] = await lerPaginaLegal(db, org, "cancelamento");
    expect(cancelamento.valores).toEqual({ nome_empresa: "Casa Exemplo", email_contato: "contato@example.com", telefone_contato: "(21) 90000-0000", dias_reembolso_integral: "14" });
    expect(Object.keys(cancelamento.secoes)).toEqual(["resumo", "texto"]);
    expect((await lerPaginaLegal(db, org, "privacidade"))[0].valores.encarregado).toBe("Pessoa Exemplo");

    // Publicar de novo sem mudança: nenhuma versão nova.
    expect(await publicar("cancelamento", "2026-10-11", 1)).toMatchObject({ ok: true, mudou: false, versao: { numero: 1, data: "2026-10-10" } });
    // Uma versão nova do termos não mexe na numeração dos outros.
    expect(await publicar("termos", "2026-10-11", 1, { texto: `${RASCUNHO_PAGINAS_LEGAIS.termos.secoes.texto}\n\nParágrafo novo.` })).toMatchObject({ ok: true, mudou: true, versao: { numero: 2 } });
    expect(await versoesLegaisAtuais(db, org)).toEqual({ termos: 2, privacidade: 1, cancelamento: 1 });

    // Cada documento registra a sua ação no histórico da configuração.
    const acoes = (await historicoDe(db, org, "configuracao", org)).map((h) => h.acao).filter((a) => a !== "configuracao.empresa");
    expect(acoes.sort()).toEqual(["configuracao.politica_cancelamento", "configuracao.politica_privacidade", "configuracao.termos_uso", "configuracao.termos_uso"]);
    const v1 = (await historicoDe(db, org, "configuracao", org)).find((h) => h.acao === "configuracao.politica_cancelamento")!.mudancas;
    expect(v1).toMatchObject({ versao: [null, 1], "campo.dias_reembolso_integral": [null, "14"], "regra.diasReembolsoIntegral": [null, 14], "secao.resumo": [null, RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes.resumo] });
  });

  it("dado da empresa mudou: a versão guarda o antigo, o painel avisa e publicar de novo cria a versão seguinte", async () => {
    await salvarEmpresa(db, org, EMPRESA, admin);
    await publicar("termos", "2026-10-10", 0);
    await salvarEmpresa(db, org, { ...EMPRESA, cnpj: "11.111.111/0001-11", encarregado: "Outra Pessoa", site: "https://example.com" }, admin);
    const v1 = versaoAtual(await lerPaginaLegal(db, org, "termos"))!;
    const agora = valoresDisponiveis(await lerEmpresa(db, org), null);
    // O encarregado não aparece nos termos: mudar ele não deixa a versão desatualizada.
    expect(camposDesatualizados(v1, agora)).toEqual(["cnpj"]);
    expect(v1.valores.cnpj).toBe("00.000.000/0001-00");
    const v2 = await publicar("termos", "2026-10-12", 1);
    expect(v2).toMatchObject({ ok: true, mudou: true, versao: { numero: 2, valores: { cnpj: "11.111.111/0001-11" } } });
    expect(camposDesatualizados(versaoAtual(await lerPaginaLegal(db, org, "termos"))!, agora)).toEqual([]);
    const mudancas = (await historicoDe(db, org, "configuracao", org)).find((h) => h.acao === "configuracao.termos_uso" && JSON.stringify(h.mudancas.versao) === "[1,2]")!.mudancas;
    expect(mudancas).toEqual({ versao: [1, 2], "campo.cnpj": ["00.000.000/0001-00", "11.111.111/0001-11"] });
    // A versão 1 continua como foi publicada.
    expect((await lerPaginaLegal(db, org, "termos"))[0]).toEqual(v1);
    // Campo usado apagado da empresa também é desatualização (e publicar é recusado).
    expect(camposDesatualizados(v1, { ...agora, endereco: "" })).toEqual(["cnpj", "endereco"]);
  });

  it("só o prazo mudou: versão nova com a regra no histórico; a anterior mantém o prazo dela", async () => {
    await salvarEmpresa(db, org, EMPRESA, admin);
    await publicar("cancelamento", "2026-10-10", 0);
    expect(await publicar("cancelamento", "2026-10-15", 1, { dias: 21 })).toMatchObject({ ok: true, mudou: true, versao: { numero: 2, data: "2026-10-15", regras: { diasReembolsoIntegral: 21 }, valores: { dias_reembolso_integral: "21" } } });
    expect(await regraDaPoliticaDeCancelamento(db, org, 1)).toEqual({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: true });
    expect(await regraDaPoliticaDeCancelamento(db, org, 2)).toEqual({ diasReembolsoIntegral: 21, arrependimentoAteEntrada: true });
    const mudancas = (await historicoDe(db, org, "configuracao", org)).find((h) => JSON.stringify(h.mudancas.versao) === "[1,2]")!.mudancas;
    expect(mudancas).toEqual({ versao: [1, 2], "campo.dias_reembolso_integral": ["14", "21"], "regra.diasReembolsoIntegral": [14, 21] });
  });

  it("recusa: política sem o campo do prazo, campo desconhecido ou fora do lugar, formulário inválido e base velha", async () => {
    await salvarEmpresa(db, org, EMPRESA, admin);
    const semCampo = (t: string) => t.replaceAll("{{dias_reembolso_integral}}", "14");
    const r = RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes;
    expect(await publicar("cancelamento", "2026-10-10", 0, { resumo: semCampo(r.resumo), texto: semCampo(r.texto) })).toEqual({
      ok: false,
      erro: "A política precisa mostrar o prazo do reembolso pelo campo {{dias_reembolso_integral}}, para o texto e a devolução nunca discordarem.",
      atual: null,
    });
    // Basta o campo no resumo.
    expect(await publicar("cancelamento", "2026-10-10", 0, { texto: semCampo(r.texto) })).toMatchObject({ ok: true, versao: { numero: 1 } });
    expect(await publicar("termos", "2026-10-10", 0, { texto: "Fale com {{cnpjj}}." })).toMatchObject({ ok: false, erro: expect.stringContaining("O texto usa {{cnpjj}}, que não existe.") });
    expect(await publicar("termos", "2026-10-10", 0, { texto: "Prazo de {{dias_reembolso_integral}} dias." })).toMatchObject({
      ok: false,
      erro: "{{dias_reembolso_integral}} só pode ser usado na Política de cancelamento.",
    });
    // O formulário é conferido de novo aqui: sem prazo ou sem texto não publica.
    expect(await publicar("cancelamento", "2026-10-11", 1, { dias: null })).toMatchObject({ ok: false, erros: { diasReembolsoIntegral: "Informe um número de dias entre 1 e 365." }, atual: { numero: 1 } });
    expect(await publicarPaginaLegal(db, org, "privacidade", { secoes: { texto: "  " }, diasReembolsoIntegral: null }, admin, "2026-10-10", 0)).toMatchObject({ ok: false, erros: { texto: "Escreva esta parte antes de publicar." }, atual: null });
    expect(await lerPaginaLegal(db, org, "termos")).toEqual([]);
    // Base velha: outra pessoa publicou no meio.
    expect(await publicar("cancelamento", "2026-10-12", 0, { dias: 30 })).toMatchObject({ ok: false, erro: expect.stringContaining("a versão 1 foi publicada por outra pessoa em 10/10/2026"), atual: { numero: 1 } });
    expect((await lerPaginaLegal(db, org, "cancelamento")).map((v) => v.numero)).toEqual([1]);
  });

  it("cada organização tem as suas páginas legais", async () => {
    await salvarEmpresa(db, org, EMPRESA, admin);
    for (const doc of DOCUMENTOS_LEGAIS) await publicar(doc, "2026-10-10", 0);
    expect(await versoesLegaisAtuais(db, outra)).toBeNull();
    expect(await lerPaginasLegais(db, outra)).toEqual({ termos: [], privacidade: [], cancelamento: [] });
    // Na outra, a empresa ainda não tem os dados: recusado, mesmo com a primeira já publicada.
    expect(await publicar("termos", "2026-10-10", 0, undefined, outra)).toMatchObject({ ok: false, atual: null });
    expect(await db.select().from(configuracoes).where(and(eq(configuracoes.organizacaoId, outra), eq(configuracoes.chave, "termos_uso")))).toEqual([]);
  });

  it("travas: o pagamento lê as três versões sob a trava compartilhada, em ordem; publicar usa a exclusiva da própria chave", async () => {
    await salvarEmpresa(db, org, EMPRESA, admin);
    vi.mocked(travarConfig).mockClear();
    vi.mocked(travarConfigCompartilhada).mockClear();
    await publicar("privacidade", "2026-10-10", 0);
    expect(vi.mocked(travarConfig).mock.calls.map((c) => c[2])).toContain("politica_privacidade");
    expect(vi.mocked(travarConfig).mock.calls.map((c) => c[2])).not.toContain("termos_uso");
    expect(vi.mocked(travarConfigCompartilhada)).not.toHaveBeenCalled();
    await publicar("termos", "2026-10-10", 0);
    await publicar("cancelamento", "2026-10-10", 0);
    vi.mocked(travarConfig).mockClear();
    expect(await db.transaction((tx) => versoesLegaisTravadas(tx, org))).toEqual({ termos: 1, privacidade: 1, cancelamento: 1 });
    expect(vi.mocked(travarConfigCompartilhada).mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [org, "termos_uso"],
      [org, "politica_privacidade"],
      [org, "politica_cancelamento"],
    ]);
    expect(vi.mocked(travarConfig)).not.toHaveBeenCalled();
    expect(await db.transaction((tx) => versoesLegaisTravadas(tx, outra))).toBeNull();
  });
});

describe("limite do arrependimento na Política de cancelamento (M8.2c, regra por versão)", () => {
  /** O texto-base sem a frase do limite (como se o advogado a tirasse). */
  const semLimite = () => {
    const r = RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes;
    const tirar = (t: string) => t.replaceAll(FRASE_LIMITE_ARREPENDIMENTO, "até o fim do prazo de 7 dias");
    return { resumo: tirar(r.resumo), texto: tirar(r.texto) };
  };

  it("o texto-base traz a frase do limite e começa com a caixa marcada; sem o campo, a regra vale 'sim'", () => {
    const r = RASCUNHO_PAGINAS_LEGAIS.cancelamento;
    expect(r.arrependimentoAteEntrada).toBe(true);
    expect(r.secoes.texto).toContain(FRASE_LIMITE_ARREPENDIMENTO);
    expect(RASCUNHO_PAGINAS_LEGAIS.termos.arrependimentoAteEntrada).toBeNull();
    expect(regrasComPadrao({ diasReembolsoIntegral: 14 })).toEqual({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: true });
    expect(regrasComPadrao({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: false })).toEqual({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: false });
  });

  it("formulário: caixa desmarcada com a frase ainda no texto é recusada (mesmo com outra caixa e espaços); sem a frase, passa", () => {
    const r = RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes;
    const recusa = validarPaginaLegal("cancelamento", { ...r, diasReembolsoIntegral: "14" });
    expect(recusa).toEqual({ ok: false, erros: { arrependimentoAteEntrada: MENSAGEM_ARREPENDIMENTO_SEM_LIMITE }, mensagem: "Confira os campos destacados." });
    expect(MENSAGEM_ARREPENDIMENTO_SEM_LIMITE).toBe(
      'Você desmarcou o limite do arrependimento, mas o texto ainda diz que ele vale até o horário de entrada no dia do check-in: ajuste a seção "Direito de arrependimento" ou marque a caixa.',
    );
    expect(validarPaginaLegal("cancelamento", { resumo: "Vale ATÉ O HORÁRIO de entrada\nno dia do check-in.", texto: "T", diasReembolsoIntegral: "14" })).toMatchObject({ ok: false, erros: { arrependimentoAteEntrada: expect.any(String) } });
    expect(validarPaginaLegal("cancelamento", { ...r, diasReembolsoIntegral: "14", arrependimentoAteEntrada: "on" })).toMatchObject({ ok: true, entrada: { arrependimentoAteEntrada: true } });
    expect(validarPaginaLegal("cancelamento", { ...semLimite(), diasReembolsoIntegral: "14" })).toMatchObject({ ok: true, entrada: { arrependimentoAteEntrada: false } });
  });

  it("a versão guarda a regra; só a caixa mudou já cria versão nova (com a regra no histórico); a anterior continua com a dela", async () => {
    await salvarEmpresa(db, org, EMPRESA, admin);
    const v1 = await publicarPaginaLegal(db, org, "cancelamento", { secoes: semLimite(), diasReembolsoIntegral: 14, arrependimentoAteEntrada: true }, admin, "2026-10-10", 0);
    expect(v1).toMatchObject({ ok: true, mudou: true, versao: { numero: 1, regras: { diasReembolsoIntegral: 14, arrependimentoAteEntrada: true } } });
    const v2 = await publicarPaginaLegal(db, org, "cancelamento", { secoes: semLimite(), diasReembolsoIntegral: 14, arrependimentoAteEntrada: false }, admin, "2026-10-11", 1);
    expect(v2).toMatchObject({ ok: true, mudou: true, versao: { numero: 2, regras: { diasReembolsoIntegral: 14, arrependimentoAteEntrada: false } } });
    expect(await regraDaPoliticaDeCancelamento(db, org, 1)).toEqual({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: true });
    expect(await regraDaPoliticaDeCancelamento(db, org, 2)).toEqual({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: false });
    const mudancas = (await historicoDe(db, org, "configuracao", org)).find((h) => JSON.stringify(h.mudancas.versao) === "[1,2]")!.mudancas;
    expect(mudancas).toEqual({ versao: [1, 2], "regra.arrependimentoAteEntrada": [true, false] });
    // Desmarcada com a frase de volta no texto: recusada também na publicação (deny-by-default), nada gravado.
    const r = RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes;
    expect(await publicarPaginaLegal(db, org, "cancelamento", { secoes: r, diasReembolsoIntegral: 14, arrependimentoAteEntrada: false }, admin, "2026-10-12", 2)).toMatchObject({
      ok: false,
      erros: { arrependimentoAteEntrada: MENSAGEM_ARREPENDIMENTO_SEM_LIMITE },
      atual: { numero: 2 },
    });
    expect((await lerPaginaLegal(db, org, "cancelamento")).map((v) => v.numero)).toEqual([1, 2]);
  });

  it("v1 publicada sem o campo: lida como 'sim'; republicar sem mexer na caixa mantém o limite e, sem outra mudança, não cria versão", async () => {
    await publicarPaginasLegaisDeTeste(db, org);
    await salvarEmpresa(db, org, EMPRESA, admin);
    // Gravada como antes do M8.2c: sem o campo na regra.
    const gravada = await db.select().from(configuracoes).where(and(eq(configuracoes.organizacaoId, org), eq(configuracoes.chave, "politica_cancelamento")));
    expect(JSON.stringify(gravada[0].valor)).not.toContain("arrependimentoAteEntrada");
    const [v1] = await lerPaginaLegal(db, org, "cancelamento");
    expect(v1.regras).toEqual({ diasReembolsoIntegral: 14, arrependimentoAteEntrada: true });
    // O formulário abre com o valor da versão (com o padrão): marcada. Enviado assim, sem outra mudança, nada muda.
    const caixa = regrasComPadrao(v1.regras!).arrependimentoAteEntrada ? "on" : "";
    const form = validarPaginaLegal("cancelamento", { ...v1.secoes, diasReembolsoIntegral: "14", arrependimentoAteEntrada: caixa });
    if (!form.ok) throw new Error(form.mensagem);
    expect(await publicarPaginaLegal(db, org, "cancelamento", form.entrada, admin, "2026-10-12", 1)).toMatchObject({ ok: true, mudou: false, versao: { numero: 1 } });
    // Com o texto mudado (o prazo de 21 dias), a v2 nasce com o limite.
    const v2 = await publicarPaginaLegal(db, org, "cancelamento", { ...form.entrada, diasReembolsoIntegral: 21 }, admin, "2026-10-12", 1);
    expect(v2).toMatchObject({ ok: true, mudou: true, versao: { numero: 2, regras: { diasReembolsoIntegral: 21, arrependimentoAteEntrada: true } } });
    // A v1 aceita continua gravada como foi publicada (o padrão da leitura não entra no JSON dela); só a v2 traz o campo.
    const [depois] = await db.select().from(configuracoes).where(and(eq(configuracoes.organizacaoId, org), eq(configuracoes.chave, "politica_cancelamento")));
    const versoes = (depois.valor as { versoes: Record<string, unknown>[] }).versoes;
    expect(versoes).toHaveLength(2);
    expect(versoes[0]).toEqual((gravada[0].valor as { versoes: unknown[] }).versoes[0]);
    expect(JSON.stringify(versoes[0])).not.toContain("arrependimentoAteEntrada");
    expect(versoes[1].regras).toEqual({ diasReembolsoIntegral: 21, arrependimentoAteEntrada: true });
  });

  it("a leitura guarda só os campos conhecidos da regra (o resto é descartado)", async () => {
    const versao = (regras: unknown) => ({ numero: 1, data: "2026-10-01", autorId: null, secoes: RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes, valores: {}, regras });
    await gravarConfig(db, org, "politica_cancelamento", { versoes: [versao({ diasReembolsoIntegral: 10, arrependimentoAteEntrada: false, outra: "x" })] }, null, false);
    expect((await lerPaginaLegal(db, org, "cancelamento"))[0].regras).toEqual({ diasReembolsoIntegral: 10, arrependimentoAteEntrada: false });
    await gravarConfig(db, outra, "politica_cancelamento", { versoes: [versao({ diasReembolsoIntegral: 10, arrependimentoAteEntrada: "nao" })] }, null, false);
    expect((await lerPaginaLegal(db, outra, "cancelamento"))[0].regras).toEqual({ diasReembolsoIntegral: 10, arrependimentoAteEntrada: true });
  });
});

describe("páginas legais de teste (fixture do pagamento)", () => {
  it("publica a v1 dos três no mesmo formato da publicação pelo painel, sem mexer na empresa", async () => {
    expect(await publicarPaginasLegaisDeTeste(db, org)).toEqual({ termos: 1, privacidade: 1, cancelamento: 1 });
    expect(await versoesLegaisAtuais(db, org)).toEqual({ termos: 1, privacidade: 1, cancelamento: 1 });
    expect((await lerEmpresa(db, org)).cnpj).toBe("");
    await expect(publicarPaginasLegaisDeTeste(db, org)).rejects.toThrow("já tem páginas legais");
    // Pelo painel, com os mesmos dados fictícios na empresa, sai a mesma versão.
    const v = VALORES_LEGAIS_DE_TESTE;
    await salvarEmpresa(db, outra, { nome: v.nome_empresa!, razaoSocial: v.razao_social!, cnpj: v.cnpj!, email: v.email_contato!, telefone: v.telefone_contato!, endereco: v.endereco!, encarregado: v.encarregado!, site: "", chavePix: "" }, null);
    for (const doc of DOCUMENTOS_LEGAIS) await publicarPaginaLegal(db, outra, doc, entradaBase(doc), null, "2026-10-01", 0);
    expect(await lerPaginasLegais(db, outra)).toEqual(await lerPaginasLegais(db, org));
    expect(CAMPOS_LEGAIS.filter((c) => c.chave !== "dias_reembolso_integral").every((c) => v[c.chave])).toBe(true);
  });
});
