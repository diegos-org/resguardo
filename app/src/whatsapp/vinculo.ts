/**
 * Vínculo da conversa do WhatsApp (M10.1a, desenho na seção "Vínculo" de `requisitos/product/WHATSAPP.md`): a conversa
 * pode ficar ligada a uma reserva, uma cotação, um pedido de contato, um cadastro pelo site ou um proprietário — no
 * máximo um, e só confirmado à mão (o CHECK `whatsapp_contatos_um_vinculo` da 0073 garante que alvo e data andam juntos).
 * O sistema sugere pelo código da reserva (SCL-…) ou da cotação (COT-…) escrito na conversa e pelo telefone; as
 * sugestões são calculadas na hora, nunca guardadas (T7), e nada se confirma sozinho. O nome do perfil nunca é sinal.
 *
 * Acesso: tudo começa por `exigirVerConversas` (whatsapp/acesso.ts, o lugar único que decide quem vê conversa), e cada
 * tipo de alvo exige também a permissão de ler o alvo (`PERMISSAO_DO_ALVO`, T10): proprietário, pedido de contato e
 * cadastro pelo site só para quem tem `proprietario:*` (hoje só o admin). Quem vê a conversa e não lê o alvo não recebe
 * sugestão desse tipo e, no vínculo já confirmado, só um rótulo genérico, sem nome, sem link e sem "Desfazer".
 *
 * Confirmar e desfazer gravam só as colunas de vínculo da conversa e a auditoria (entidade `whatsapp_conversa`, nunca
 * `reserva`, com `mudancas` só de `tipo:id`): nada é copiado para a reserva, a cotação ou um cadastro. Deste arquivo só
 * saem leituras de reservas, cotações, proprietários, representantes, pedidos e cadastros, e os códigos vêm dos
 * módulos puros (`reservas/regras.ts`, `site/codigo-cotacao.ts`): nada importado daqui grava nesses cadastros.
 *
 * Erro de banco sem dado pessoal: as consultas levam telefone, chaves de telefone, os 8 últimos dígitos, código e texto
 * como parâmetro, e na drizzle-orm um erro de consulta traz os `params` na mensagem ("Failed query: … params: …"), que o
 * Next imprime no registro da Vercel (a limpeza de `observabilidade/limpeza.ts` só vale para o Sentry). Por isso toda
 * função exportada daqui e de `whatsapp/conversas.ts` que consulta o banco passa por `semDadosNoErro`.
 */
import { and, desc, eq, gte, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { AcessoNegado, type Acao, exigir, podeFazer, type Sessao } from "@/acesso/politica";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { cadastrosMarketplace, cotacoes, imoveis, pedidosContatoProprietario, proprietarios, representantes, reservas, whatsappContatos, whatsappMensagens } from "@/db/schema";
import type { Db } from "@/db/types";
import { dataBr, dataNoFuso, FUSO_PADRAO, hojeISO, somarDias } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { erroParaOAviso } from "@/observabilidade/erro-de-rotina";
import { codigosDeReservaNoTexto, ehCodigoDeReserva } from "@/reservas/regras";
import { codigoCotacaoValido, codigosDeCotacaoNoTexto } from "@/site/codigo-cotacao";
import { exigirVerConversas } from "./acesso";
import { ALVOS_VINCULO, type AlvoVinculo, type Direcao } from "./regras";
import { chavesDeTelefone, chavesDoWaId, temChaveEmComum, ultimos8 } from "./telefone";

// ---------------------------------------------------------------- erro sem dado pessoal

/**
 * Roda a função e, se ela lançar, relança o erro sem a mensagem (`erroParaOAviso`: fica o tipo, o SQLSTATE e a pilha,
 * também na cadeia de `cause`). `AcessoNegado` passa como está (a tela e a ação tratam a negação pelo tipo).
 */
export async function semDadosNoErro<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AcessoNegado) throw e;
    throw erroParaOAviso(e);
  }
}

// ---------------------------------------------------------------- alvos, permissões e rótulos

export type MotivoCandidato =
  | "codigo_reserva"
  | "codigo_cotacao"
  | "codigo_cotacao_com_reserva"
  | "telefone_hospede"
  | "telefone_pedido_contato"
  | "telefone_cadastro"
  | "telefone_proprietario"
  | "telefone_representante";

export type Candidato = { tipo: AlvoVinculo; id: string; motivos: MotivoCandidato[]; rotulo: string; link: string | null };

/** Além de ver a conversa, cada tipo de alvo pede a permissão de ler o alvo (T10). */
export const PERMISSAO_DO_ALVO: Record<AlvoVinculo, Acao> = {
  reserva: "reserva:ler",
  cotacao: "reserva:ler",
  pedido_contato: "proprietario:editar",
  cadastro_marketplace: "proprietario:editar",
  proprietario: "proprietario:ler",
};

/**
 * Os motivos como a tela mostra ("{rótulo} — {motivos}"). O nome leva "_CANDIDATO" para não se confundir com o
 * `ROTULO_MOTIVO` de `whatsapp/situacao.ts` (motivo da desconexão da conta), que as mesmas telas importam.
 */
export const ROTULO_MOTIVO_CANDIDATO: Record<MotivoCandidato, string> = {
  codigo_reserva: "código da reserva na conversa",
  codigo_cotacao: "código da cotação na conversa",
  codigo_cotacao_com_reserva: "código da cotação que virou esta reserva",
  telefone_hospede: "mesmo telefone do hóspede",
  telefone_pedido_contato: "mesmo telefone do pedido de contato",
  telefone_cadastro: "mesmo telefone do cadastro pelo site",
  telefone_proprietario: "mesmo telefone do proprietário",
  telefone_representante: "mesmo telefone de um representante",
};

/** Sugestões mostradas; o resto vira "e mais {n}". */
export const MAXIMO_CANDIDATOS = 10;
/** Códigos: lidos das 200 mensagens mais recentes, até 5 por mensagem e 20 por conversa. */
const MENSAGENS_LIDAS = 200;
const CODIGOS_POR_MENSAGEM = 5;
const CODIGOS_POR_CONVERSA = 20;
/** Só a mensagem do cliente e a resposta pelo celular trazem código (nunca a enviada pelo painel, M10.2). */
export const DIRECOES_COM_CODIGO: readonly Direcao[] = ["recebida", "enviada_celular"];
/**
 * Uma regra só para as mensagens em que se procura código: não apagadas, com texto e numa das `DIRECOES_COM_CODIGO`.
 * Usada aqui (sugestões da conversa) e no pré-filtro da ficha da reserva (`whatsapp/conversas.ts`).
 */
export const mensagemComCodigo = (m = whatsappMensagens): SQL => and(isNull(m.apagadaEm), inArray(m.direcao, DIRECOES_COM_CODIGO), ne(m.texto, ""))!;
/** Reserva pelo telefone: não cancelada e com saída a partir de hoje − 365 dias. */
const DIAS_RESERVA_PASSADA = 365;

export type Alvo = { tipo: AlvoVinculo; id: string };
/** Chave interna de um alvo (também o valor da auditoria): "tipo:id", sem nome nem telefone. */
export const chaveDoAlvo = (a: Alvo): string => `${a.tipo}:${a.id}`;

/**
 * Uma regra só (5.3 e 5.4): a cotação que virou reserva vale como a reserva (sugestão, vínculo pelo código e vínculo
 * confirmado à mão); a cotação sem reserva vale como ela mesma.
 */
export const alvoDaCotacao = (c: { id: string; reservaId: string | null }): Alvo => (c.reservaId ? { tipo: "reserva", id: c.reservaId } : { tipo: "cotacao", id: c.id });

/** A coluna de cada alvo em `whatsapp_contatos`. */
const CAMPO_DO_ALVO = {
  reserva: "reservaId",
  cotacao: "cotacaoId",
  pedido_contato: "pedidoContatoId",
  cadastro_marketplace: "cadastroMarketplaceId",
  proprietario: "proprietarioId",
} as const satisfies Record<AlvoVinculo, keyof typeof whatsappContatos.$inferSelect>;

type ColunasDoVinculo = { [K in (typeof CAMPO_DO_ALVO)[AlvoVinculo]]: string | null };

/** As seis colunas do vínculo zeradas (desfazer, e a base de confirmar: um alvo só). */
const SEM_VINCULO = {
  reservaId: null,
  cotacaoId: null,
  pedidoContatoId: null,
  cadastroMarketplaceId: null,
  proprietarioId: null,
  vinculoConfirmadoPor: null,
  vinculoConfirmadoEm: null,
} as const;

/** O vínculo confirmado de uma conversa (no máximo um: CHECK da 0073), ou null. */
export function alvoDaConversa(c: ColunasDoVinculo): Alvo | null {
  for (const tipo of ALVOS_VINCULO) {
    const id = c[CAMPO_DO_ALVO[tipo]];
    if (id) return { tipo, id };
  }
  return null;
}

/** A permissão do tipo, só para um tipo da lista fechada (texto torto, "__proto__" etc. = null). */
const permissaoDoAlvo = (tipo: unknown): Acao | null =>
  typeof tipo === "string" && (ALVOS_VINCULO as readonly string[]).includes(tipo) ? PERMISSAO_DO_ALVO[tipo as AlvoVinculo] : null;

/** A sessão lê esse tipo de alvo? (Além de ver a conversa.) */
const podeLerAlvo = (sessao: Sessao, tipo: AlvoVinculo): boolean => podeFazer(sessao.papel, PERMISSAO_DO_ALVO[tipo]);

/** Para quem vê a conversa e não lê o alvo: o tipo, sem nome, sem data do pedido, sem código. */
const GENERICO: Record<AlvoVinculo, { rotulo: string; selo: string }> = {
  reserva: { rotulo: "uma reserva", selo: "Reserva" },
  cotacao: { rotulo: "uma cotação", selo: "Cotação" },
  pedido_contato: { rotulo: "um pedido de contato", selo: "Pedido de contato" },
  cadastro_marketplace: { rotulo: "um cadastro pelo site", selo: "Cadastro pelo site" },
  proprietario: { rotulo: "um proprietário", selo: "Proprietário" },
};

/**
 * Um alvo lido para a tela: `rotulo` (sem telefone), `selo` (o texto curto da lista: "Reserva SCL-…", "Cotação COT-…",
 * "Pedido de contato", "Cadastro pelo site", "Proprietário") e `link`. `entrada`/`saida` só da reserva (ordem).
 */
type Descricao = { rotulo: string; selo: string; link: string | null; entrada?: string; saida?: string };

/**
 * Lê os alvos na organização e monta o rótulo de cada um (uma consulta por tipo presente). Alvo que não está na
 * organização não aparece no mapa. Quem chama decide antes quais tipos a sessão pode ler.
 */
async function descreverAlvos(db: Db, organizacaoId: string, alvos: readonly Alvo[]): Promise<Map<string, Descricao>> {
  const ids = (tipo: AlvoVinculo) => [...new Set(alvos.filter((a) => a.tipo === tipo).map((a) => a.id))];
  const mapa = new Map<string, Descricao>();
  const guardar = (tipo: AlvoVinculo, id: string, d: Descricao) => mapa.set(chaveDoAlvo({ tipo, id }), d);

  const rs = ids("reserva");
  if (rs.length) {
    const linhas = await db
      .select({ id: reservas.id, codigo: reservas.codigo, estado: reservas.estado, entrada: reservas.checkin, saida: reservas.checkout, hospede: reservas.hospedeNome, imovel: imoveis.nome })
      .from(reservas)
      .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
      .where(and(eq(reservas.organizacaoId, organizacaoId), inArray(reservas.id, rs)));
    for (const r of linhas) {
      const rotulo = `Reserva ${r.codigo} · ${r.imovel} · ${dataBr(r.entrada)} a ${dataBr(r.saida)}${r.hospede ? ` · ${r.hospede}` : ""}${r.estado === "cancelada" ? " · cancelada" : ""}`;
      guardar("reserva", r.id, { rotulo, selo: `Reserva ${r.codigo}`, link: `/painel/reservas/${r.id}`, entrada: r.entrada, saida: r.saida });
    }
  }
  const cs = ids("cotacao");
  if (cs.length) {
    const linhas = await db
      .select({ id: cotacoes.id, codigo: cotacoes.codigo, entrada: cotacoes.checkin, saida: cotacoes.checkout, imovel: imoveis.nome })
      .from(cotacoes)
      .innerJoin(imoveis, eq(imoveis.id, cotacoes.imovelId))
      .where(and(eq(cotacoes.organizacaoId, organizacaoId), inArray(cotacoes.id, cs)));
    for (const c of linhas) guardar("cotacao", c.id, { rotulo: `Cotação ${c.codigo} · ${c.imovel} · ${dataBr(c.entrada)} a ${dataBr(c.saida)}`, selo: `Cotação ${c.codigo}`, link: null });
  }
  const ps = ids("pedido_contato");
  if (ps.length) {
    const linhas = await db
      .select({ id: pedidosContatoProprietario.id, nome: pedidosContatoProprietario.nome, criadoEm: pedidosContatoProprietario.criadoEm })
      .from(pedidosContatoProprietario)
      .where(and(eq(pedidosContatoProprietario.organizacaoId, organizacaoId), inArray(pedidosContatoProprietario.id, ps)));
    for (const p of linhas) guardar("pedido_contato", p.id, { rotulo: `Pedido de contato de ${p.nome} (${dataNoFuso(p.criadoEm)})`, selo: GENERICO.pedido_contato.selo, link: "/painel/proprietarios/contatos" });
  }
  const ks = ids("cadastro_marketplace");
  if (ks.length) {
    const linhas = await db
      .select({ id: cadastrosMarketplace.id, nome: cadastrosMarketplace.nome, criadoEm: cadastrosMarketplace.criadoEm })
      .from(cadastrosMarketplace)
      .where(and(eq(cadastrosMarketplace.organizacaoId, organizacaoId), inArray(cadastrosMarketplace.id, ks)));
    for (const k of linhas) guardar("cadastro_marketplace", k.id, { rotulo: `Cadastro pelo site de ${k.nome} (${dataNoFuso(k.criadoEm)})`, selo: GENERICO.cadastro_marketplace.selo, link: "/painel/proprietarios/cadastros" });
  }
  const os = ids("proprietario");
  if (os.length) {
    const linhas = await db
      .select({ id: proprietarios.id, nome: proprietarios.nome })
      .from(proprietarios)
      .where(and(eq(proprietarios.organizacaoId, organizacaoId), inArray(proprietarios.id, os)));
    for (const o of linhas) guardar("proprietario", o.id, { rotulo: `Proprietário ${o.nome}`, selo: GENERICO.proprietario.selo, link: `/painel/proprietarios/${o.id}` });
  }
  return mapa;
}

/** O vínculo confirmado como a sessão pode ver: com a permissão do alvo, rótulo, link e "Desfazer"; sem ela, o genérico. */
export type VinculoNaTela = { tipo: AlvoVinculo; rotulo: string; selo: string; link: string | null; podeDesfazer: boolean };

/**
 * Os vínculos confirmados de várias conversas, para a lista e para a conversa (`whatsapp/conversas.ts`), chaveados por
 * `chaveDoAlvo`. Só lê as tabelas dos tipos que a sessão pode ler: a operação (quando Diego libera as conversas), diante
 * de um vínculo a proprietário, pedido de contato ou cadastro feito pelo admin, recebe "um proprietário", "um pedido de
 * contato" ou "um cadastro pelo site", com `link` nulo e `podeDesfazer` falso (o "Desfazer" só daria `AcessoNegado`).
 */
export async function vinculosNaTela(db: Db, sessao: Sessao, alvos: readonly Alvo[]): Promise<Map<string, VinculoNaTela>> {
  return semDadosNoErro(async () => {
    await exigirVerConversas(db, sessao);
    const descricoes = await descreverAlvos(db, sessao.organizacaoId, alvos.filter((a) => podeLerAlvo(sessao, a.tipo)));
    const mapa = new Map<string, VinculoNaTela>();
    for (const a of alvos) {
      const pode = podeLerAlvo(sessao, a.tipo);
      const d = pode ? descricoes.get(chaveDoAlvo(a)) : undefined;
      // Sem a permissão, ou alvo que não está mais na organização: o genérico (só quem lê o alvo pode desfazer).
      mapa.set(chaveDoAlvo(a), d ? { tipo: a.tipo, rotulo: d.rotulo, selo: d.selo, link: d.link, podeDesfazer: true } : { tipo: a.tipo, ...GENERICO[a.tipo], link: null, podeDesfazer: pode });
    }
    return mapa;
  });
}

// ---------------------------------------------------------------- sugestões

type ConversaDoVinculo = { id: string; waId: string | null } & ColunasDoVinculo;

const COLUNAS_DA_CONVERSA = {
  id: whatsappContatos.id,
  waId: whatsappContatos.waId,
  reservaId: whatsappContatos.reservaId,
  cotacaoId: whatsappContatos.cotacaoId,
  pedidoContatoId: whatsappContatos.pedidoContatoId,
  cadastroMarketplaceId: whatsappContatos.cadastroMarketplaceId,
  proprietarioId: whatsappContatos.proprietarioId,
};

/** A conversa, só na organização da sessão (id malformado = nenhuma, sem ir ao banco com ele). */
async function conversaDaOrganizacao(db: Db, organizacaoId: string, contatoId: string): Promise<ConversaDoVinculo | null> {
  if (!uuidValido(contatoId)) return null;
  const [c] = await db.select(COLUNAS_DA_CONVERSA).from(whatsappContatos).where(and(eq(whatsappContatos.id, contatoId), eq(whatsappContatos.organizacaoId, organizacaoId)));
  return c ?? null;
}

/**
 * Os códigos escritos na conversa: das 200 mensagens mais recentes (já em maiúsculas, para pegar "scl-7k2qxm"), até 5
 * por mensagem e 20 no total, sem repetição. Só os do alfabeto de cada código (SCL-ABC123, com "1", não conta).
 */
function codigosDaConversa(textos: readonly string[]): { reservas: string[]; cotacoes: string[] } {
  const todos = new Set<string>();
  for (const t of textos) {
    const maiusculo = t.toUpperCase();
    for (const c of [...codigosDeReservaNoTexto(maiusculo), ...codigosDeCotacaoNoTexto(maiusculo)].slice(0, CODIGOS_POR_MENSAGEM)) {
      if (todos.size >= CODIGOS_POR_CONVERSA) break;
      todos.add(c);
    }
    if (todos.size >= CODIGOS_POR_CONVERSA) break;
  }
  const lista = [...todos];
  return { reservas: lista.filter(ehCodigoDeReserva), cotacoes: lista.filter(codigoCotacaoValido) };
}

type Achado = { alvo: Alvo; motivos: Set<MotivoCandidato> };

/** Os 8 últimos dígitos de um telefone em texto livre, no SQL (pré-filtro; a conferência é pelas chaves). */
const oitoFinais = (coluna: PgColumn): SQL => sql`right(regexp_replace(${coluna}, '[^0-9]', '', 'g'), 8)`;

/**
 * Uma regra só para as sugestões de uma conversa (a conversa e a ficha da reserva usam esta): os alvos e os motivos,
 * sem rótulo. Cada tipo só é procurado se a sessão pode lê-lo; o alvo já vinculado à conversa sai.
 * - Código (das mensagens do cliente e das respostas pelo celular, não apagadas): reserva pelo código (qualquer
 *   estado); cotação pelo código, e a cotação que virou reserva sugere a reserva.
 * - Telefone (só conversa com `wa_id`): pré-filtro pelos 8 últimos dígitos e conferência por `chavesDeTelefone` ∩
 *   `chavesDoWaId`. Reserva não cancelada com saída a partir de hoje − 365 dias; pedido de contato; cadastro pelo site;
 *   proprietário; representante (sugere o proprietário dele). Conversa só com BSUID: só por código ou à mão.
 */
async function alvosSugeridos(db: Db, sessao: Sessao, conversa: ConversaDoVinculo, agora: Date): Promise<Map<string, Achado>> {
  const org = sessao.organizacaoId;
  const achados = new Map<string, Achado>();
  const achar = (tipo: AlvoVinculo, id: string, motivo: MotivoCandidato) => {
    if (!podeLerAlvo(sessao, tipo)) return;
    const chave = chaveDoAlvo({ tipo, id });
    const a = achados.get(chave) ?? { alvo: { tipo, id }, motivos: new Set<MotivoCandidato>() };
    a.motivos.add(motivo);
    achados.set(chave, a);
  };

  if (podeLerAlvo(sessao, "reserva") || podeLerAlvo(sessao, "cotacao")) {
    const m = whatsappMensagens;
    const textos = await db
      .select({ texto: m.texto })
      .from(m)
      .where(and(eq(m.organizacaoId, org), eq(m.contatoId, conversa.id), mensagemComCodigo(m)))
      .orderBy(desc(m.enviadaEm), desc(m.recebidaEm))
      .limit(MENSAGENS_LIDAS);
    const codigos = codigosDaConversa(textos.map((t) => t.texto));
    if (codigos.reservas.length && podeLerAlvo(sessao, "reserva")) {
      for (const r of await db.select({ id: reservas.id }).from(reservas).where(and(eq(reservas.organizacaoId, org), inArray(reservas.codigo, codigos.reservas)))) achar("reserva", r.id, "codigo_reserva");
    }
    if (codigos.cotacoes.length) {
      for (const c of await db.select({ id: cotacoes.id, reservaId: cotacoes.reservaId }).from(cotacoes).where(and(eq(cotacoes.organizacaoId, org), inArray(cotacoes.codigo, codigos.cotacoes)))) {
        const alvo = alvoDaCotacao(c);
        achar(alvo.tipo, alvo.id, alvo.tipo === "reserva" ? "codigo_cotacao_com_reserva" : "codigo_cotacao");
      }
    }
  }

  const chaves = conversa.waId ? chavesDoWaId(conversa.waId) : [];
  if (chaves.length) {
    const finais = [...new Set(chaves.map(ultimos8))];
    const casa = (telefone: string) => temChaveEmComum(chavesDeTelefone(telefone), chaves);
    if (podeLerAlvo(sessao, "reserva")) {
      const desde = somarDias(hojeISO(FUSO_PADRAO, agora), -DIAS_RESERVA_PASSADA);
      const linhas = await db
        .select({ id: reservas.id, telefone: reservas.hospedeTelefone })
        .from(reservas)
        .where(and(eq(reservas.organizacaoId, org), ne(reservas.estado, "cancelada"), gte(reservas.checkout, desde), inArray(oitoFinais(reservas.hospedeTelefone), finais)));
      for (const r of linhas) if (casa(r.telefone)) achar("reserva", r.id, "telefone_hospede");
    }
    if (podeLerAlvo(sessao, "pedido_contato")) {
      const t = pedidosContatoProprietario;
      for (const p of await db.select({ id: t.id, telefone: t.telefone }).from(t).where(and(eq(t.organizacaoId, org), inArray(oitoFinais(t.telefone), finais)))) {
        if (casa(p.telefone)) achar("pedido_contato", p.id, "telefone_pedido_contato");
      }
    }
    if (podeLerAlvo(sessao, "cadastro_marketplace")) {
      const t = cadastrosMarketplace;
      for (const k of await db.select({ id: t.id, telefone: t.telefone }).from(t).where(and(eq(t.organizacaoId, org), inArray(oitoFinais(t.telefone), finais)))) {
        if (casa(k.telefone)) achar("cadastro_marketplace", k.id, "telefone_cadastro");
      }
    }
    if (podeLerAlvo(sessao, "proprietario")) {
      for (const o of await db.select({ id: proprietarios.id, telefone: proprietarios.telefone }).from(proprietarios).where(and(eq(proprietarios.organizacaoId, org), inArray(oitoFinais(proprietarios.telefone), finais)))) {
        if (casa(o.telefone)) achar("proprietario", o.id, "telefone_proprietario");
      }
      const linhas = await db
        .select({ proprietarioId: representantes.proprietarioId, telefone: representantes.telefone })
        .from(representantes)
        .innerJoin(proprietarios, eq(proprietarios.id, representantes.proprietarioId))
        .where(and(eq(proprietarios.organizacaoId, org), inArray(oitoFinais(representantes.telefone), finais)));
      for (const r of linhas) if (casa(r.telefone)) achar("proprietario", r.proprietarioId, "telefone_representante");
    }
  }

  const atual = alvoDaConversa(conversa);
  if (atual) achados.delete(chaveDoAlvo(atual));
  return achados;
}

/** Ordem da tela dos motivos e dos tipos (código antes de telefone). */
const ORDEM_DO_MOTIVO: readonly MotivoCandidato[] = Object.keys(ROTULO_MOTIVO_CANDIDATO) as MotivoCandidato[];
const ORDEM_DO_TIPO: Record<AlvoVinculo, number> = { reserva: 0, cotacao: 1, pedido_contato: 2, cadastro_marketplace: 3, proprietario: 4 };
const peloCodigo = (motivos: readonly MotivoCandidato[]) => motivos.some((m) => m.startsWith("codigo_"));

/**
 * Código antes de telefone; depois reserva, cotação, pedido, cadastro e proprietário; reservas em curso e futuras
 * primeiro (pela entrada), depois as passadas (a mais recente primeiro); empate pelo rótulo.
 */
function compararCandidatos(hoje: string) {
  return (a: { c: Candidato; d: Descricao }, b: { c: Candidato; d: Descricao }): number => {
    const grupo = Number(!peloCodigo(a.c.motivos)) - Number(!peloCodigo(b.c.motivos));
    if (grupo) return grupo;
    const tipo = ORDEM_DO_TIPO[a.c.tipo] - ORDEM_DO_TIPO[b.c.tipo];
    if (tipo) return tipo;
    if (a.c.tipo === "reserva" && a.d.entrada && b.d.entrada) {
      const passadaA = (a.d.saida ?? "") < hoje;
      const passadaB = (b.d.saida ?? "") < hoje;
      if (passadaA !== passadaB) return passadaA ? 1 : -1;
      if (a.d.entrada !== b.d.entrada) return (a.d.entrada < b.d.entrada ? -1 : 1) * (passadaA ? -1 : 1);
    }
    return a.c.rotulo.localeCompare(b.c.rotulo, "pt-BR");
  };
}

/**
 * As sugestões de vínculo de uma conversa (até 10, `mais` = o resto), calculadas na hora. Conversa de outra organização
 * (ou id malformado) → null. Rótulos sem telefone; o alvo já vinculado à conversa não aparece.
 */
export async function candidatosDaConversa(db: Db, sessao: Sessao, contatoId: string, agora: Date): Promise<{ candidatos: Candidato[]; mais: number } | null> {
  return semDadosNoErro(async () => {
    await exigirVerConversas(db, sessao);
    const conversa = await conversaDaOrganizacao(db, sessao.organizacaoId, contatoId);
    if (!conversa) return null;
    const achados = [...(await alvosSugeridos(db, sessao, conversa, agora)).values()];
    const descricoes = await descreverAlvos(db, sessao.organizacaoId, achados.map((a) => a.alvo));
    const lista = achados.flatMap((a) => {
      const d = descricoes.get(chaveDoAlvo(a.alvo));
      if (!d) return [];
      const motivos = ORDEM_DO_MOTIVO.filter((m) => a.motivos.has(m));
      return [{ c: { tipo: a.alvo.tipo, id: a.alvo.id, motivos, rotulo: d.rotulo, link: d.link }, d }];
    });
    lista.sort(compararCandidatos(hojeISO(FUSO_PADRAO, agora)));
    return { candidatos: lista.slice(0, MAXIMO_CANDIDATOS).map((x) => x.c), mais: Math.max(0, lista.length - MAXIMO_CANDIDATOS) };
  });
}

/**
 * As conversas (entre as dadas, na organização) que teriam a reserva como sugestão, pela mesma regra das sugestões da
 * conversa. Para a ficha da reserva (`conversasDaReserva`), que faz o pré-filtro.
 */
export async function conversasQueSugeremAReserva(db: Db, sessao: Sessao, contatoIds: readonly string[], reservaId: string, agora: Date): Promise<string[]> {
  return semDadosNoErro(async () => {
    await exigirVerConversas(db, sessao);
    const chave = chaveDoAlvo({ tipo: "reserva", id: reservaId });
    const sugerem: string[] = [];
    for (const id of new Set(contatoIds)) {
      const conversa = await conversaDaOrganizacao(db, sessao.organizacaoId, id);
      if (conversa && (await alvosSugeridos(db, sessao, conversa, agora)).has(chave)) sugerem.push(id);
    }
    return sugerem;
  });
}

// ---------------------------------------------------------------- confirmar e desfazer

/** Trava a conversa da organização (`for update`) para confirmar ou desfazer: duas confirmações seguidas não se cruzam. */
async function travarConversa(tx: Db, organizacaoId: string, contatoId: string): Promise<ConversaDoVinculo | null> {
  const [c] = await tx
    .select(COLUNAS_DA_CONVERSA)
    .from(whatsappContatos)
    .where(and(eq(whatsappContatos.id, contatoId), eq(whatsappContatos.organizacaoId, organizacaoId)))
    .for("update");
  return c ?? null;
}

/** O alvo existe na organização? (Não precisa estar entre as sugestões: vale a busca manual.) */
async function alvoExiste(tx: Db, organizacaoId: string, alvo: Alvo): Promise<boolean> {
  const tabela = {
    reserva: reservas,
    cotacao: cotacoes,
    pedido_contato: pedidosContatoProprietario,
    cadastro_marketplace: cadastrosMarketplace,
    proprietario: proprietarios,
  }[alvo.tipo];
  const [linha] = await tx.select({ id: tabela.id }).from(tabela).where(and(eq(tabela.id, alvo.id), eq(tabela.organizacaoId, organizacaoId))).limit(1);
  return !!linha;
}

/**
 * Grava o vínculo na conversa travada: já vinculada a outro alvo → `ja_vinculada` (desfazer primeiro, de propósito);
 * ao mesmo alvo → `vinculada` sem gravar de novo. Grava só as colunas do vínculo (alvo, quem confirmou e quando) e a
 * auditoria com objeto literal (nunca `calcularMudancas`).
 */
async function vincular(tx: Db, sessao: Sessao, conversa: ConversaDoVinculo, alvo: Alvo, agora: Date): Promise<"vinculada" | "ja_vinculada"> {
  const atual = alvoDaConversa(conversa);
  if (atual) return chaveDoAlvo(atual) === chaveDoAlvo(alvo) ? "vinculada" : "ja_vinculada";
  await tx
    .update(whatsappContatos)
    .set({ ...SEM_VINCULO, [CAMPO_DO_ALVO[alvo.tipo]]: alvo.id, vinculoConfirmadoPor: sessao.usuarioId, vinculoConfirmadoEm: agora, atualizadoEm: agora })
    .where(eq(whatsappContatos.id, conversa.id));
  await registrarAuditoria(tx, {
    organizacaoId: sessao.organizacaoId,
    usuarioId: sessao.usuarioId,
    acao: "whatsapp.conversa.vincular",
    entidade: "whatsapp_conversa",
    entidadeId: conversa.id,
    mudancas: { vinculo: [null, chaveDoAlvo(alvo)] },
  });
  return "vinculada";
}

/**
 * Confirma o vínculo da conversa com um alvo (a sugestão aceita ou um alvo escolhido à mão). Exige ver as conversas e a
 * permissão do tipo do alvo; o alvo precisa existir na organização. A cotação que virou reserva (inclusive depois de a
 * tela mostrar a sugestão) vincula à reserva (`alvoDaCotacao`), como na sugestão e no vínculo pelo código.
 */
export async function confirmarVinculo(
  db: Db,
  sessao: Sessao,
  p: { contatoId: string; tipo: AlvoVinculo; alvoId: string },
  agora: Date = new Date(),
): Promise<"vinculada" | "ja_vinculada" | "alvo_nao_encontrado" | "conversa_nao_encontrada"> {
  return semDadosNoErro(async () => {
    await exigirVerConversas(db, sessao);
    const acao = permissaoDoAlvo(p.tipo);
    if (!acao) throw new AcessoNegado("ACAO_NAO_PERMITIDA");
    exigir(sessao, acao, { organizacaoId: sessao.organizacaoId });
    if (!uuidValido(p.contatoId)) return "conversa_nao_encontrada";
    if (!uuidValido(p.alvoId)) return "alvo_nao_encontrado";
    const org = sessao.organizacaoId;
    return db.transaction(async (tx) => {
      const conversa = await travarConversa(tx, org, p.contatoId);
      if (!conversa) return "conversa_nao_encontrada";
      let alvo: Alvo = { tipo: p.tipo, id: p.alvoId };
      if (alvo.tipo === "cotacao") {
        const [c] = await tx.select({ id: cotacoes.id, reservaId: cotacoes.reservaId }).from(cotacoes).where(and(eq(cotacoes.id, alvo.id), eq(cotacoes.organizacaoId, org))).limit(1);
        if (!c) return "alvo_nao_encontrado";
        alvo = alvoDaCotacao(c);
      }
      if (!(await alvoExiste(tx, org, alvo))) return "alvo_nao_encontrado";
      exigir(sessao, PERMISSAO_DO_ALVO[alvo.tipo], { organizacaoId: org });
      return vincular(tx, sessao, conversa, alvo, agora);
    });
  });
}

/**
 * A busca manual: o código da reserva (SCL-XXXXXX) ou da cotação (COT-XXXXXXXX), em maiúsculas e sem espaços nas
 * pontas. A cotação que virou reserva vincula à reserva. Reserva e cotação pedem a mesma permissão (ler reservas).
 */
export async function vincularPorCodigo(
  db: Db,
  sessao: Sessao,
  p: { contatoId: string; codigo: string },
  agora: Date = new Date(),
): Promise<"vinculada" | "ja_vinculada" | "codigo_invalido" | "codigo_nao_encontrado" | "conversa_nao_encontrada"> {
  return semDadosNoErro(async () => {
    await exigirVerConversas(db, sessao);
    const codigo = typeof p.codigo === "string" ? p.codigo.toUpperCase().trim() : "";
    const daReserva = ehCodigoDeReserva(codigo);
    if (!daReserva && !codigoCotacaoValido(codigo)) return "codigo_invalido";
    exigir(sessao, PERMISSAO_DO_ALVO[daReserva ? "reserva" : "cotacao"], { organizacaoId: sessao.organizacaoId });
    if (!uuidValido(p.contatoId)) return "conversa_nao_encontrada";
    const org = sessao.organizacaoId;
    return db.transaction(async (tx) => {
      const conversa = await travarConversa(tx, org, p.contatoId);
      if (!conversa) return "conversa_nao_encontrada";
      let alvo: Alvo | null = null;
      if (daReserva) {
        const [r] = await tx.select({ id: reservas.id }).from(reservas).where(and(eq(reservas.organizacaoId, org), eq(reservas.codigo, codigo))).limit(1);
        if (r) alvo = { tipo: "reserva", id: r.id };
      } else {
        const [c] = await tx.select({ id: cotacoes.id, reservaId: cotacoes.reservaId }).from(cotacoes).where(and(eq(cotacoes.organizacaoId, org), eq(cotacoes.codigo, codigo))).limit(1);
        if (c) alvo = alvoDaCotacao(c);
      }
      if (!alvo || !(await alvoExiste(tx, org, alvo))) return "codigo_nao_encontrado";
      exigir(sessao, PERMISSAO_DO_ALVO[alvo.tipo], { organizacaoId: org });
      return vincular(tx, sessao, conversa, alvo, agora);
    });
  });
}

/**
 * Desfaz o vínculo (a tela pede confirmação antes): zera as colunas do vínculo e registra na auditoria. Exige a
 * permissão do tipo do alvo atual: a operação não desfaz o vínculo a um proprietário feito pelo admin.
 */
export async function desfazerVinculo(db: Db, sessao: Sessao, contatoId: string, agora: Date = new Date()): Promise<"desfeito" | "sem_vinculo" | "conversa_nao_encontrada"> {
  return semDadosNoErro(async () => {
    await exigirVerConversas(db, sessao);
    if (!uuidValido(contatoId)) return "conversa_nao_encontrada";
    return db.transaction(async (tx) => {
      const conversa = await travarConversa(tx, sessao.organizacaoId, contatoId);
      if (!conversa) return "conversa_nao_encontrada";
      const atual = alvoDaConversa(conversa);
      if (!atual) return "sem_vinculo";
      exigir(sessao, PERMISSAO_DO_ALVO[atual.tipo], { organizacaoId: sessao.organizacaoId });
      await tx.update(whatsappContatos).set({ ...SEM_VINCULO, atualizadoEm: agora }).where(eq(whatsappContatos.id, conversa.id));
      await registrarAuditoria(tx, {
        organizacaoId: sessao.organizacaoId,
        usuarioId: sessao.usuarioId,
        acao: "whatsapp.conversa.desvincular",
        entidade: "whatsapp_conversa",
        entidadeId: conversa.id,
        mudancas: { vinculo: [chaveDoAlvo(atual), null] },
      });
      return "desfeito";
    });
  });
}
