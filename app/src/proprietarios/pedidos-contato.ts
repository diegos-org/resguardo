/**
 * Pedido de contato para a gestão completa (M7.7).
 *
 * Na página "Anuncie seu imóvel" do site, o proprietário deixa nome, e-mail, telefone e o básico do imóvel e
 * pede que a equipe fale com ele. Nada vira conta, proprietário ou imóvel: o pedido fica "novo" no painel
 * (Proprietários → Pedidos de contato, com aviso no Início) até a equipe marcar como respondido ou arquivar.
 * A equipe também recebe um e-mail no endereço da empresa, quando há e-mail do sistema; o aviso no painel é
 * a garantia (e-mail que falha não perde o pedido).
 *
 * Contra abuso: campo-isca escondido ("site") — robô que preenche recebe "ok" e nada é gravado nem enviado —,
 * e tetos com janela: por e-mail (24 horas) e, por hora, por endereço de origem e no total da organização. Todos se
 * desfazem sozinhos: spam (mesmo com o e-mail de outra pessoa) não trava ninguém por mais que a janela, e ninguém precisa
 * arquivar nada para o formulário voltar a funcionar. O pedido não guarda IP; a origem só entra na conta temporária de
 * tentativas (a mesma do login), apagada depois de um dia parada.
 *
 * Autorização (M7.14): o pedido guarda, no mesmo insert, quando o envio com a caixa marcada chegou ao servidor (relógio
 * do servidor, o mesmo `criadoEm`), a versão e o texto exato dela, com o nome da empresa lido no envio (`./autorizacao`).
 * O texto gravado é sempre o do servidor — desde o M7.15, a versão em vigor editada no painel
 * (`configuracoes/autorizacao-proprietarios`); o formulário manda só a marca do texto que mostrou, e marca que não
 * confere (texto mudou depois que a página abriu) é recusada.
 */
import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { emailValido } from "@/acesso/codigo-email";
import { normalizarEmail } from "@/acesso/entrada";
import { apagarContasVelhas, contarNaJanela, type Limite } from "@/acesso/senha";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { conferirAutorizacao } from "@/configuracoes/autorizacao-proprietarios";
import { pedidosContatoProprietario, type SituacaoPedidoContato, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { avisarEquipePorEmail, type ResultadoAviso } from "@/email/aviso-equipe";
import type { Correio } from "@/email/correio";
import { uuidValido } from "@/lib/ids";
import { ERRO_AUTORIZACAO_MUDOU, marcaDoFormulario, type TextoAutorizacao } from "./autorizacao";
import { ERRO_TELEFONE_DDD, telefoneComDddValido } from "./documento";

/** Pedidos com o mesmo e-mail em 24 horas (o e-mail não é conferido: o teto passa sozinho, ninguém fica bloqueado). */
export const MAX_POR_EMAIL_POR_DIA = 3;
const UM_DIA_MS = 24 * 60 * 60_000;
/** Pedidos por hora: de um mesmo endereço de origem e no total da organização (contra envio em massa). */
export const LIMITE_POR_ORIGEM: Limite = { tentativas: 5, janelaMs: 60 * 60_000 };
/** Tentativas por hora no total (aceitas ou não), conferidas antes da conta por origem. */
export const LIMITE_TENTATIVAS_GERAL: Limite = { tentativas: 120, janelaMs: 60 * 60_000 };
/** Contas de tentativas do pedido de contato, sempre por organização (o tráfego de um site não gasta o teto de outro). */
const PREFIXO_TENTATIVAS = "contato-";
export const MAX_POR_HORA = 30;
const UMA_HORA_MS = 60 * 60_000;
/** Quantos pedidos já tratados a tela mostra (os mais recentes). */
export const LIMITE_DECIDIDOS = 100;
export const MAX_NOTA = 500;
/** Nome do campo-isca escondido do formulário público. */
export const CAMPO_ISCA = "site";

export const QUARTOS_MAX = 10;

export type DadosPedidoContato = {
  nome: string;
  email: string;
  telefone: string;
  bairro: string;
  cidade: string;
  /** 0 = studio; null = não informou. */
  quartos: number | null;
  anunciaHoje: boolean | null;
  mensagem: string;
  /** Marca do texto da autorização que o formulário mostrou (campo escondido). Só é conferida: o texto gravado vem do servidor. */
  marcaAutorizacao: string;
};
/** Erros por nome do campo do formulário. */
export type CampoPedidoContato = "nome" | "email" | "telefone" | "bairro" | "cidade" | "quartos" | "anunciaHoje" | "mensagem" | "consentimento";
export type ErrosPedidoContato = Partial<Record<CampoPedidoContato, string>>;
/** Campos que o formulário pode receber de volta depois de um erro (nunca o campo-isca). */
export const CAMPOS_PEDIDO_CONTATO: readonly CampoPedidoContato[] = ["nome", "email", "telefone", "bairro", "cidade", "quartos", "anunciaHoje", "mensagem", "consentimento"];

type Entrada = Record<string, unknown>;
const txt = (e: Entrada, k: string) => (typeof e[k] === "string" ? (e[k] as string).replace(/\r\n/g, "\n").trim() : "");

/** Robô: preencheu o campo-isca que a pessoa não vê. */
export function preencheuIsca(e: Entrada): boolean {
  return txt(e, CAMPO_ISCA) !== "";
}

/** Confere o formulário público (pura). */
export function validarPedidoContato(e: Entrada): { ok: true; dados: DadosPedidoContato } | { ok: false; erros: ErrosPedidoContato } {
  const erros: ErrosPedidoContato = {};
  const nome = txt(e, "nome");
  if (!nome) erros.nome = "Informe seu nome.";
  else if (nome.length > 150) erros.nome = "Máximo de 150 caracteres.";

  const email = normalizarEmail(txt(e, "email"));
  if (!email) erros.email = "Informe seu e-mail.";
  else if (email.length > 200) erros.email = "Máximo de 200 caracteres.";
  else if (!emailValido(email)) erros.email = "E-mail inválido. Confira se está completo (ex.: nome@exemplo.com).";

  const telefone = txt(e, "telefone");
  if (!telefoneComDddValido(telefone)) erros.telefone = ERRO_TELEFONE_DDD;

  const bairro = txt(e, "bairro");
  if (!bairro) erros.bairro = "Informe o bairro do imóvel.";
  else if (bairro.length > 80) erros.bairro = "Máximo de 80 caracteres.";
  const cidade = txt(e, "cidade");
  if (!cidade) erros.cidade = "Informe a cidade.";
  else if (cidade.length > 80) erros.cidade = "Máximo de 80 caracteres.";

  const quartosBruto = txt(e, "quartos");
  let quartos: number | null = null;
  if (quartosBruto !== "") {
    if (/^\d{1,2}$/.test(quartosBruto) && Number(quartosBruto) <= QUARTOS_MAX) quartos = Number(quartosBruto);
    else erros.quartos = "Escolha uma das opções da lista.";
  }

  const anunciaBruto = txt(e, "anunciaHoje");
  const anunciaHoje = anunciaBruto === "sim" ? true : anunciaBruto === "nao" ? false : null;
  if (anunciaBruto !== "" && anunciaHoje === null) erros.anunciaHoje = "Escolha Sim ou Não (ou deixe em branco).";

  const mensagem = txt(e, "mensagem");
  if (mensagem.length > 2000) erros.mensagem = "Máximo de 2000 caracteres.";

  if (e.consentimento !== "on" && e.consentimento !== true) erros.consentimento = "É preciso autorizar o uso dos dados para a gente responder.";

  if (Object.keys(erros).length) return { ok: false, erros };
  return { ok: true, dados: { nome, email, telefone, bairro, cidade, quartos, anunciaHoje, mensagem, marcaAutorizacao: marcaDoFormulario(e) } };
}

/** Como os quartos aparecem no painel e no e-mail da equipe (o formulário oferece até "4 ou mais"). */
export function descreverQuartos(q: number | null): string {
  if (q === null) return "Não informado";
  if (q === 0) return "Studio";
  if (q === 1) return "1 quarto";
  if (q === 4) return "4 ou mais quartos";
  return `${q} quartos`;
}

export function descreverAnunciaHoje(a: boolean | null): string {
  return a === null ? "Não informado" : a ? "Sim" : "Não";
}

export type PedidoContato = typeof pedidosContatoProprietario.$inferSelect;
export type PedidoContatoComAutor = PedidoContato & { decididoPorNome: string | null };

export const ERRO_LIMITE_POR_EMAIL = "Já recebemos seus pedidos de hoje e vamos responder. Se for urgente, fale com a gente pelo WhatsApp ou pelo e-mail do site.";
export const ERRO_LIMITE_ORIGEM = "Recebemos muitos pedidos deste endereço de internet. Tente de novo daqui a uma hora ou fale com a gente pelo WhatsApp ou pelo e-mail do site.";
export const ERRO_LIMITE_TOTAL = "Recebemos muitos pedidos agora há pouco. Tente de novo daqui a uma hora ou fale com a gente pelo WhatsApp ou pelo e-mail do site.";

/** `autorizacao`: o texto da caixa mudou depois que a página abriu; é o texto atual, para o formulário mostrar. */
export type ResultadoRegistro = { ok: true; pedido: PedidoContato } | { ok: false; erro: string; autorizacao?: TextoAutorizacao };

/**
 * Grava o pedido como "novo", respeitando os tetos. `origem` = endereço de quem enviou (ver `origemDoPedido`); sem ele,
 * só valem os outros tetos. Os tetos por e-mail e por hora da organização são conferidos e gravados sob a mesma trava.
 * Junto, no mesmo insert, o registro da autorização: agora, a versão em vigor do texto da caixa e o texto dela, com o nome
 * da empresa lido nesta transação — se a marca do formulário não for a desse texto, nada é gravado.
 */
export async function registrarPedidoContato(db: Db, organizacaoId: string, dados: DadosPedidoContato, agora: Date, origem: string | null = null): Promise<ResultadoRegistro> {
  const email = normalizarEmail(dados.email);
  if (!emailValido(email)) return { ok: false, erro: "E-mail inválido." };
  // Antes de qualquer conta por origem: o teto geral de tentativas da hora. Muitas origens diferentes não criam linhas
  // sem fim, e a limpeza das contas paradas roda uma vez por janela geral (não a cada origem nova).
  const geral = await contarNaJanela(db, `${PREFIXO_TENTATIVAS}geral:${organizacaoId}`, LIMITE_TENTATIVAS_GERAL, agora);
  if (geral === 1) await apagarContasVelhas(db, agora);
  if (geral > LIMITE_TENTATIVAS_GERAL.tentativas) return { ok: false, erro: ERRO_LIMITE_TOTAL };
  if (origem && (await contarNaJanela(db, `${PREFIXO_TENTATIVAS}origem:${organizacaoId}:${origem}`, LIMITE_POR_ORIGEM, agora)) > LIMITE_POR_ORIGEM.tentativas) {
    return { ok: false, erro: ERRO_LIMITE_ORIGEM };
  }
  return db.transaction(async (tx) => {
    // Um de cada vez por organização: as contagens abaixo valem na hora de gravar.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pedido-contato-proprietario:${organizacaoId}`}))`);
    const desde = (ms: number, f?: ReturnType<typeof eq>) =>
      tx
        .select({ n: count() })
        .from(pedidosContatoProprietario)
        .where(and(eq(pedidosContatoProprietario.organizacaoId, organizacaoId), gt(pedidosContatoProprietario.criadoEm, new Date(agora.getTime() - ms)), f))
        .then((r) => r[0].n);
    if ((await desde(UM_DIA_MS, eq(pedidosContatoProprietario.email, email))) >= MAX_POR_EMAIL_POR_DIA) return { ok: false as const, erro: ERRO_LIMITE_POR_EMAIL };
    if ((await desde(UMA_HORA_MS)) >= MAX_POR_HORA) return { ok: false as const, erro: ERRO_LIMITE_TOTAL };
    const { marcaAutorizacao, ...campos } = dados;
    // O texto que se grava é o do servidor: a versão em vigor (M7.15), com o nome da empresa de agora (o mesmo que a página mostra).
    const { ok: confere, autorizacao } = await conferirAutorizacao(tx, organizacaoId, "contato", marcaAutorizacao);
    if (!confere) return { ok: false as const, erro: ERRO_AUTORIZACAO_MUDOU, autorizacao };
    const [pedido] = await tx
      .insert(pedidosContatoProprietario)
      .values({
        organizacaoId,
        ...campos,
        email,
        situacao: "novo",
        criadoEm: agora,
        autorizadoEm: agora,
        autorizacaoVersao: autorizacao.versao,
        autorizacaoTexto: autorizacao.texto,
      })
      .returning();
    return { ok: true as const, pedido };
  });
}

const colunasComAutor = { pedido: pedidosContatoProprietario, decididoPorNome: usuarios.nome };
const comAutor = (r: { pedido: PedidoContato; decididoPorNome: string | null }): PedidoContatoComAutor => ({ ...r.pedido, decididoPorNome: r.decididoPorNome });

/** Pedidos novos por página da tela (a fila pode crescer mais rápido que a equipe trata, então a tela não carrega tudo). */
export const NOVOS_POR_PAGINA = 30;

/**
 * Novos, mais antigos primeiro (para ninguém ficar esquecido), em páginas de `NOVOS_POR_PAGINA`, com o total; e os já
 * tratados mais recentes. Página fora do intervalo devolve lista vazia (a tela oferece voltar).
 */
export async function listarPedidosContato(
  db: Db,
  organizacaoId: string,
  pagina = 1,
): Promise<{ novos: PedidoContatoComAutor[]; totalNovos: number; decididos: PedidoContatoComAutor[] }> {
  const t = pedidosContatoProprietario;
  const n = Number.isSafeInteger(pagina) && pagina >= 1 ? pagina : 1;
  const [novos, totalNovos, decididos] = await Promise.all([
    db
      .select(colunasComAutor)
      .from(t)
      .leftJoin(usuarios, eq(usuarios.id, t.decididoPor))
      .where(and(eq(t.organizacaoId, organizacaoId), eq(t.situacao, "novo")))
      .orderBy(asc(t.criadoEm), asc(t.id))
      .limit(NOVOS_POR_PAGINA)
      .offset((n - 1) * NOVOS_POR_PAGINA),
    contarPedidosNovos(db, organizacaoId),
    db
      .select(colunasComAutor)
      .from(t)
      .leftJoin(usuarios, eq(usuarios.id, t.decididoPor))
      .where(and(eq(t.organizacaoId, organizacaoId), inArray(t.situacao, ["respondido", "arquivado"])))
      .orderBy(sql`${t.decididoEm} desc nulls last`, desc(t.criadoEm), desc(t.id))
      .limit(LIMITE_DECIDIDOS),
  ]);
  return { novos: novos.map(comAutor), totalNovos, decididos: decididos.map(comAutor) };
}

export async function contarPedidosNovos(db: Db, organizacaoId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(pedidosContatoProprietario)
    .where(and(eq(pedidosContatoProprietario.organizacaoId, organizacaoId), eq(pedidosContatoProprietario.situacao, "novo")));
  return r.n;
}

export type ErroDecisao = "nao-encontrado" | "nota-longa";
/** Textos para a tela (a ação do painel volta só com o código, nunca com texto livre no endereço). */
export const TEXTO_ERRO_DECISAO: Record<ErroDecisao, string> = {
  "nao-encontrado": "Pedido não encontrado ou já tratado. Recarregue a página.",
  "nota-longa": `A nota interna pode ter no máximo ${MAX_NOTA} caracteres.`,
};
export type ResultadoDecisao = { ok: true } | { ok: false; erro: ErroDecisao };

async function decidir(
  db: Db,
  organizacaoId: string,
  id: string,
  notaBruta: string,
  autorId: string | null,
  agora: Date,
  de: readonly SituacaoPedidoContato[],
  para: SituacaoPedidoContato,
): Promise<ResultadoDecisao> {
  const nota = notaBruta.replace(/\r\n/g, "\n").trim();
  if (nota.length > MAX_NOTA) return { ok: false, erro: "nota-longa" };
  if (!uuidValido(id)) return { ok: false, erro: "nao-encontrado" };
  return db.transaction(async (tx) => {
    const t = pedidosContatoProprietario;
    const [p] = await tx
      .select({ id: t.id, situacao: t.situacao, nota: t.nota })
      .from(t)
      .where(and(eq(t.id, id), eq(t.organizacaoId, organizacaoId)))
      .for("update");
    if (!p || !de.includes(p.situacao)) return { ok: false as const, erro: "nao-encontrado" as const };
    // A nota nova soma à anterior (respondido → arquivado não apaga o que a equipe escreveu antes).
    const notaFinal = nota ? (p.nota ? `${p.nota}\n${nota}` : nota) : p.nota;
    await tx.update(t).set({ situacao: para, nota: notaFinal, decididoEm: agora, decididoPor: autorId }).where(eq(t.id, p.id));
    // Só ids e a situação: nada do que a pessoa escreveu (telefone, e-mail, mensagem) nem a nota vai para o histórico.
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: para === "respondido" ? "pedido_contato.responder" : "pedido_contato.arquivar",
      entidade: "pedido_contato_proprietario",
      entidadeId: p.id,
      mudancas: { situacao: [p.situacao, para] },
    });
    return { ok: true as const };
  });
}

/** A equipe já falou com a pessoa: sai da lista de novos. Só de "novo". */
export function marcarRespondido(db: Db, organizacaoId: string, id: string, nota: string, autorId: string | null, agora = new Date()): Promise<ResultadoDecisao> {
  return decidir(db, organizacaoId, id, nota, autorId, agora, ["novo"], "respondido");
}

/** Arquivar (sem resposta, repetido, fora da região…): de "novo" ou de "respondido". Nada é apagado. */
export function arquivarPedido(db: Db, organizacaoId: string, id: string, nota: string, autorId: string | null, agora = new Date()): Promise<ResultadoDecisao> {
  return decidir(db, organizacaoId, id, nota, autorId, agora, ["novo", "respondido"], "arquivado");
}

export type { ResultadoAviso };

/** Texto do e-mail para a equipe (puro). */
export function mensagemAvisoEquipe(p: Pick<PedidoContato, "nome" | "email" | "telefone" | "bairro" | "cidade" | "quartos" | "anunciaHoje" | "mensagem">, linkPainel: string): { assunto: string; texto: string } {
  const linhas = [
    "Chegou um pedido de contato pela página \"Anuncie seu imóvel\" do site.",
    "",
    `Nome: ${p.nome}`,
    `E-mail: ${p.email}`,
    `Telefone: ${p.telefone}`,
    `Imóvel: ${p.bairro}, ${p.cidade}`,
    `Quartos: ${descreverQuartos(p.quartos)}`,
    `Já anuncia em alguma plataforma: ${descreverAnunciaHoje(p.anunciaHoje)}`,
    `Mensagem: ${p.mensagem || "(sem mensagem)"}`,
    "",
    `Responda pelo e-mail ou WhatsApp da pessoa e depois marque como respondido no painel: ${linkPainel}`,
  ];
  return { assunto: "Novo pedido de contato de proprietário", texto: `${linhas.join("\n")}\n` };
}

/**
 * Um e-mail para o endereço da empresa (Configurações → Empresa), pelo padrão dos avisos internos
 * (`avisarEquipePorEmail`). Sem e-mail do sistema ou sem e-mail da empresa, não envia (o pedido continua no painel).
 * Falha no envio não derruba o pedido: volta "falhou".
 */
export async function avisarEquipe(db: Db, organizacaoId: string, pedido: PedidoContato, correio: Correio | null, linkPainel: string): Promise<ResultadoAviso> {
  // Dados pessoais de quem pediu: nunca no terminal de desenvolvimento (o conteúdo vai restrito). Repetir o aviso do
  // mesmo pedido não manda dois e-mails.
  return avisarEquipePorEmail(db, organizacaoId, correio, { ...mensagemAvisoEquipe(pedido, linkPainel), chave: `pedido-contato-proprietario:${pedido.id}`, rotulo: "pedido de contato" });
}
