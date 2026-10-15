/**
 * Cadastro público do proprietário marketplace (M12.3).
 *
 * 1. A pessoa confirma o e-mail com um código (mesmas regras do login, em escopo próprio e com
 *    teto geral menor, para abuso aqui não travar o login da equipe).
 * 2. Manda os dados dela e do imóvel e diz se já anuncia em outra plataforma (com os links) ou se
 *    quer um anúncio novo. Fica "pendente".
 * 3. A equipe revisa no painel. Aprovar cria, de uma vez: o proprietário, o imóvel (NÃO público —
 *    publicar é decisão separada, no cadastro do imóvel) e o convite do portal para aquele e-mail.
 *    Recusar guarda o motivo. Nada vira conta, imóvel ou anúncio sem essa revisão.
 *
 * Autorização (M7.14): o envio do passo 2 guarda, no mesmo insert, quando a caixa foi marcada, a versão e o texto exato
 * dela (`proprietarios/autorizacao`). O texto gravado é sempre o do servidor; o formulário manda só a marca do texto que
 * mostrou, e marca que não confere (texto mudou depois que a página abriu) é recusada.
 */
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { emitirCodigo, emailValido, type OpcoesCodigo, type ResultadoPedido, verificarCodigo } from "@/acesso/codigo-email";
import { normalizarEmail } from "@/acesso/entrada";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lerEmpresa } from "@/configuracoes/empresa";
import { criarConvite } from "@/convites/convites";
import { ANUNCIO_CADASTRO, type AnuncioCadastro, cadastrosMarketplace, type ImovelCadastro, proprietarioImoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { CodigoDuplicado, criarImovel } from "@/imoveis/repositorio";
import { validarImovel } from "@/imoveis/validacao";
import { uuidValido } from "@/lib/ids";
import { conferirAutorizacao, ERRO_AUTORIZACAO_MUDOU, marcaDoFormulario, type TextoAutorizacao } from "@/proprietarios/autorizacao";
import { ERRO_TELEFONE_DDD, telefoneComDddValido } from "@/proprietarios/documento";
import { criarProprietario } from "@/proprietarios/repositorio";

/** Teto de códigos do cadastro por hora (todas as pessoas juntas). */
export const MAX_CODIGOS_CADASTRO_POR_HORA = 50;
/** Pedidos pendentes ao mesmo tempo: por e-mail e no total (contra envio em massa). */
export const MAX_PENDENTES_POR_EMAIL = 3;
export const MAX_PENDENTES_TOTAL = 100;

export type DadosCadastro = {
  nome: string;
  tipo: "fisica" | "juridica";
  telefone: string;
  imovel: ImovelCadastro;
  anuncio: AnuncioCadastro;
  links: string[];
  /** Marca do texto da autorização que o formulário mostrou (campo escondido). Só é conferida: o texto gravado vem do servidor. */
  marcaAutorizacao: string;
};
/** Erros por nome do campo do formulário (os do imóvel com prefixo "imovel_"). */
export type ErrosCadastro = Partial<Record<"nome" | "telefone" | "consentimento" | "anuncio" | "links" | `imovel_${keyof ImovelCadastro}`, string>>;

type Entrada = Record<string, unknown>;
const txt = (e: Entrada, k: string) => (typeof e[k] === "string" ? (e[k] as string).replace(/\r\n/g, "\n").trim() : "");

function inteiro(v: string, min: number, max: number, obrigatorio: boolean): number | null | undefined {
  if (v === "") return obrigatorio ? undefined : null;
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n >= min && n <= max ? n : undefined;
}

function linkValido(l: string): boolean {
  if (l.length > 300) return false;
  try {
    const u = new URL(l);
    return u.protocol === "https:" && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Confere o formulário público (pura). */
export function validarCadastro(e: Entrada): { ok: true; dados: DadosCadastro } | { ok: false; erros: ErrosCadastro } {
  const erros: ErrosCadastro = {};
  const nome = txt(e, "nome");
  const tipo = txt(e, "tipo") === "juridica" ? "juridica" : "fisica";
  const telefone = txt(e, "telefone");
  if (!nome) erros.nome = "Informe seu nome completo ou a razão social.";
  else if (nome.length > 150) erros.nome = "Máximo de 150 caracteres.";
  if (!telefoneComDddValido(telefone)) erros.telefone = ERRO_TELEFONE_DDD;
  if (e.consentimento !== "on" && e.consentimento !== true) erros.consentimento = "É preciso autorizar o uso dos dados para a análise.";

  const limites: [keyof ImovelCadastro, number, string][] = [
    ["nome", 100, "Informe um nome para o imóvel (ex.: Apartamento no Leblon)."],
    ["bairro", 80, "Informe o bairro."],
    ["cidade", 80, "Informe a cidade."],
    ["endereco", 200, "Informe o endereço (fica só com a equipe; não aparece no site)."],
  ];
  const texto: Record<string, string> = {};
  for (const [k, max, msg] of limites) {
    const v = txt(e, `imovel_${k}`);
    if (!v) erros[`imovel_${k}`] = msg;
    else if (v.length > max) erros[`imovel_${k}`] = `Máximo de ${max} caracteres.`;
    texto[k] = v;
  }
  const capacidade = inteiro(txt(e, "imovel_capacidade"), 1, 50, true);
  const quartos = inteiro(txt(e, "imovel_quartos"), 0, 20, false);
  const banheiros = inteiro(txt(e, "imovel_banheiros"), 0, 20, false);
  if (capacidade === undefined || capacidade === null) erros.imovel_capacidade = "Quantas pessoas cabem (1 a 50).";
  if (quartos === undefined) erros.imovel_quartos = "Número inteiro entre 0 e 20.";
  if (banheiros === undefined) erros.imovel_banheiros = "Número inteiro entre 0 e 20.";
  const descricao = txt(e, "imovel_descricao");
  if (descricao.length > 2000) erros.imovel_descricao = "Máximo de 2000 caracteres.";

  const anuncioBruto = txt(e, "anuncio");
  const anuncio = (ANUNCIO_CADASTRO as readonly string[]).includes(anuncioBruto) ? (anuncioBruto as AnuncioCadastro) : null;
  if (!anuncio) erros.anuncio = "Diga se já anuncia em outra plataforma ou se quer um anúncio novo.";
  const links = [...new Set(txt(e, "links").split(/\s+/).filter(Boolean))];
  if (anuncio === "ja_anuncio") {
    if (!links.length) erros.links = "Cole o link do anúncio (Airbnb, Booking…).";
    else if (links.length > 3) erros.links = "No máximo 3 links.";
    else if (!links.every(linkValido)) erros.links = "Use links completos, começando com https://.";
  }

  if (Object.keys(erros).length || !anuncio || capacidade == null || quartos === undefined || banheiros === undefined) return { ok: false, erros };
  return {
    ok: true,
    dados: {
      nome,
      tipo,
      telefone,
      imovel: { nome: texto.nome, bairro: texto.bairro, cidade: texto.cidade, endereco: texto.endereco, capacidade, quartos, banheiros, descricao },
      anuncio,
      links: anuncio === "ja_anuncio" ? links : [],
      marcaAutorizacao: marcaDoFormulario(e),
    },
  };
}

/** Manda o código de confirmação do e-mail (qualquer e-mail válido pode pedir; limites valem). */
export async function pedirCodigoCadastro(
  db: Db,
  correio: Correio,
  organizacaoId: string,
  emailBruto: string,
  o: Pick<OpcoesCodigo, "segredo" | "agora" | "gerar">,
): Promise<ResultadoPedido> {
  const email = normalizarEmail(emailBruto);
  if (!emailValido(email)) return "invalido";
  return emitirCodigo(db, correio, email, { ...o, escopo: "cadastro", maxGeralPorHora: MAX_CODIGOS_CADASTRO_POR_HORA }, {
    autorizado: async () => true,
    mensagem: async (codigo) => {
      const empresa = (await lerEmpresa(db, organizacaoId)).nome;
      return {
        assunto: `Seu código para cadastrar o imóvel: ${codigo}`,
        texto: `Seu código para continuar o cadastro do seu imóvel na ${empresa} é ${codigo}.\n\nEle vale por 10 minutos e só pode ser usado uma vez.\nSe você não pediu este código, ignore este e-mail.`,
      };
    },
  });
}

export const verificarCodigoCadastro = (db: Db, email: string, codigo: string, o: { segredo: string; agora?: Date }) =>
  verificarCodigo(db, email, codigo, { segredo: o.segredo, agora: o.agora, escopo: "cadastro" });

/** `autorizacao`: o texto da caixa mudou depois que a página abriu; é o texto atual, para o formulário mostrar. */
export type ResultadoEnvio = { ok: true; id: string } | { ok: false; erro: string; autorizacao?: TextoAutorizacao };

/**
 * Grava o pedido (e-mail já confirmado pelo código, vindo da sessão assinada). Junto, no mesmo insert, o registro da
 * autorização: agora, a versão e o texto atual da caixa — se a marca do formulário não for a desse texto, nada é gravado.
 */
export async function enviarCadastro(db: Db, organizacaoId: string, emailBruto: string, dados: DadosCadastro, agora: Date): Promise<ResultadoEnvio> {
  const email = normalizarEmail(emailBruto);
  if (!emailValido(email)) return { ok: false, erro: "E-mail inválido." };
  return db.transaction(async (tx) => {
    // Um de cada vez por organização: as contagens abaixo valem na hora de gravar.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cadastro-marketplace:${organizacaoId}`}))`);
    const pendentes = (f?: ReturnType<typeof eq>) =>
      tx
        .select({ n: count() })
        .from(cadastrosMarketplace)
        .where(and(eq(cadastrosMarketplace.organizacaoId, organizacaoId), eq(cadastrosMarketplace.situacao, "pendente"), f))
        .then((r) => r[0].n);
    if ((await pendentes(eq(cadastrosMarketplace.email, email))) >= MAX_PENDENTES_POR_EMAIL)
      return { ok: false as const, erro: `Você já tem ${MAX_PENDENTES_POR_EMAIL} cadastros em análise. Aguarde a nossa resposta por e-mail.` };
    if ((await pendentes()) >= MAX_PENDENTES_TOTAL) return { ok: false as const, erro: "No momento não estamos recebendo novos cadastros por aqui. Fale com a gente pelo contato do site." };
    // O texto que se grava é o do servidor, com o nome da empresa de agora (o mesmo que a página mostra).
    const { ok: confere, autorizacao } = conferirAutorizacao("cadastro", (await lerEmpresa(tx, organizacaoId)).nome, dados.marcaAutorizacao);
    if (!confere) return { ok: false as const, erro: ERRO_AUTORIZACAO_MUDOU, autorizacao };
    const [c] = await tx
      .insert(cadastrosMarketplace)
      .values({
        organizacaoId,
        email,
        nome: dados.nome,
        tipo: dados.tipo,
        telefone: dados.telefone,
        imovel: dados.imovel,
        anuncio: dados.anuncio,
        links: dados.links,
        criadoEm: agora,
        autorizadoEm: agora,
        autorizacaoVersao: autorizacao.versao,
        autorizacaoTexto: autorizacao.texto,
      })
      .returning({ id: cadastrosMarketplace.id });
    return { ok: true as const, id: c.id };
  });
}

export type Cadastro = typeof cadastrosMarketplace.$inferSelect;

/** Pendentes primeiro (mais antigos antes); depois os decididos recentes. */
export async function listarCadastros(db: Db, organizacaoId: string): Promise<{ pendentes: Cadastro[]; decididos: Cadastro[] }> {
  const [pendentes, decididos] = await Promise.all([
    db.select().from(cadastrosMarketplace).where(and(eq(cadastrosMarketplace.organizacaoId, organizacaoId), eq(cadastrosMarketplace.situacao, "pendente"))).orderBy(asc(cadastrosMarketplace.criadoEm)),
    db
      .select()
      .from(cadastrosMarketplace)
      .where(and(eq(cadastrosMarketplace.organizacaoId, organizacaoId), sql`${cadastrosMarketplace.situacao} <> 'pendente'`))
      .orderBy(desc(cadastrosMarketplace.decididoEm))
      .limit(30),
  ]);
  return { pendentes, decididos };
}

export async function contarPendentes(db: Db, organizacaoId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(cadastrosMarketplace)
    .where(and(eq(cadastrosMarketplace.organizacaoId, organizacaoId), eq(cadastrosMarketplace.situacao, "pendente")));
  return r.n;
}

class Recusa extends Error {}

export type ResultadoAprovacao = { ok: true; proprietarioId: string; imovelId: string; token: string; email: string } | { ok: false; erro: string };

/**
 * Aprova: cria proprietário, imóvel (não público) e convite na mesma transação — se qualquer parte
 * falhar (código de imóvel repetido, e-mail que já é da equipe…), nada é criado.
 */
export async function aprovarCadastro(db: Db, organizacaoId: string, id: string, codigoImovel: string, autorId: string | null, agora = new Date()): Promise<ResultadoAprovacao> {
  if (!uuidValido(id)) return { ok: false, erro: "Cadastro não encontrado." };
  try {
    return await db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(cadastrosMarketplace)
        .where(and(eq(cadastrosMarketplace.id, id), eq(cadastrosMarketplace.organizacaoId, organizacaoId)))
        .for("update");
      if (!c) throw new Recusa("Cadastro não encontrado.");
      if (c.situacao !== "pendente") throw new Recusa("Este cadastro já foi decidido.");
      const im = validarImovel({
        codigo: codigoImovel,
        nome: c.imovel.nome,
        bairro: c.imovel.bairro,
        cidade: c.imovel.cidade,
        endereco: c.imovel.endereco,
        capacidade: String(c.imovel.capacidade),
        quartos: c.imovel.quartos === null ? "" : String(c.imovel.quartos),
        banheiros: c.imovel.banheiros === null ? "" : String(c.imovel.banheiros),
        descricao: c.imovel.descricao,
        ativo: "on",
      });
      if (!im.ok) throw new Recusa(Object.values(im.erros).join(" "));
      const origem = c.anuncio === "ja_anuncio" ? `já anuncia (${c.links.join(", ")})` : "anúncio novo";
      const proprietario = await criarProprietario(
        tx,
        organizacaoId,
        {
          nome: c.nome,
          tipo: c.tipo,
          documento: "",
          email: c.email,
          telefone: c.telefone,
          endereco: "",
          chavePix: "",
          observacoes: `Cadastro marketplace pelo site em ${agora.toISOString().slice(0, 10)}; ${origem}. Falta completar documento e Pix.`,
          ativo: true,
        },
        autorId,
      );
      let imovelId: string;
      try {
        imovelId = (await criarImovel(tx, organizacaoId, { ...im.dados, publico: false, ativo: true }, autorId)).id;
      } catch (e) {
        if (e instanceof CodigoDuplicado) throw new Recusa(e.message);
        throw e;
      }
      await tx.insert(proprietarioImoveis).values({ proprietarioId: proprietario.id, imovelId });
      const convite = await criarConvite(tx, organizacaoId, proprietario.id, c.email, autorId, agora);
      if (!convite.ok) throw new Recusa(`Convite: ${convite.erro}`);
      await tx
        .update(cadastrosMarketplace)
        .set({ situacao: "aprovado", decididoEm: agora, decididoPor: autorId, proprietarioId: proprietario.id, imovelId })
        .where(eq(cadastrosMarketplace.id, c.id));
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autorId,
        acao: "cadastro_marketplace.aprovar",
        entidade: "cadastro_marketplace",
        entidadeId: c.id,
        mudancas: { situacao: ["pendente", "aprovado"], imovel: [null, im.dados.codigo] },
      });
      return { ok: true as const, proprietarioId: proprietario.id, imovelId, token: convite.token, email: c.email };
    });
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, erro: e.message };
    throw e;
  }
}

export async function recusarCadastro(db: Db, organizacaoId: string, id: string, motivoBruto: string, autorId: string | null, agora = new Date()): Promise<{ ok: true } | { ok: false; erro: string }> {
  const motivo = motivoBruto.trim();
  if (!motivo) return { ok: false, erro: "Escreva o motivo (fica registrado)." };
  if (motivo.length > 500) return { ok: false, erro: "Motivo com no máximo 500 caracteres." };
  if (!uuidValido(id)) return { ok: false, erro: "Cadastro não encontrado." };
  return db.transaction(async (tx) => {
    const [c] = await tx
      .update(cadastrosMarketplace)
      .set({ situacao: "recusado", motivoRecusa: motivo, decididoEm: agora, decididoPor: autorId })
      .where(and(eq(cadastrosMarketplace.id, id), eq(cadastrosMarketplace.organizacaoId, organizacaoId), eq(cadastrosMarketplace.situacao, "pendente")))
      .returning({ id: cadastrosMarketplace.id });
    if (!c) return { ok: false as const, erro: "Cadastro não encontrado ou já decidido." };
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "cadastro_marketplace.recusar",
      entidade: "cadastro_marketplace",
      entidadeId: c.id,
      mudancas: { situacao: ["pendente", "recusado"], motivo: [null, motivo] },
    });
    return { ok: true as const };
  });
}
