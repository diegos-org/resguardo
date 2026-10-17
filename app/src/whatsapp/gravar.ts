/**
 * Gravação idempotente dos avisos do WhatsApp (M10.1a, desenho na seção "Idempotência e ordem" de
 * `requisitos/product/WHATSAPP.md`). Recebe os blocos já lidos (`whatsapp/aviso.ts`) e já conferidos como da
 * organização (`whatsapp/receber.ts`), dentro da transação da rota: se algo falhar, nada fica, a rota responde 500 e a
 * Meta reenvia. O aviso é o próprio dado (não existe API para buscar avisos antigos), por isso a gravação é síncrona.
 *
 * Por bloco, na ordem do corpo: 1. conversas (pelas identidades, em lote); 2. trocas de número ou de BSUID; 3. mensagens
 * (upsert pelo wamid, com a precedência por posto); 4. edições; 5. apagamentos; 6. reações; 7. agenda; 8. histórico;
 * 9. eventos de conta; 10. resumo das conversas tocadas; 11. um `whatsapp_eventos` por bloco que não é de conta.
 * Repetição (o mesmo aviso de novo, em série ou em paralelo) não cria linha nem muda nada: a garantia de "uma linha só"
 * são os índices únicos da 0073 (wamid, wa_id e BSUID por organização, chave do evento de conta); a ordem estável das
 * travas (identidades, wamid, id da conversa) só reduz o impasse entre entregas paralelas. Se o Postgres desfizer uma
 * delas por impasse (40P01), a rota responde 500 e a Meta reenvia.
 *
 * Telefone, BSUID, nomes, texto e wamid só vão para `whatsapp_contatos` e `whatsapp_mensagens`, sempre como parâmetro:
 * nada daqui escreve no console, e as mensagens de erro lançadas não levam dado nenhum (o erro de banco sai pelo `try`
 * único da rota, que troca a mensagem antes do Sentry).
 */
import { and, eq, inArray, isNull, lt, lte, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { whatsappConta, whatsappContatos, whatsappEventos, whatsappMensagens } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AgendaLida, BlocoLido, ContaLida, EdicaoLida, ApagamentoLido, Identidade, MensagemLida, ReacaoLida, TrocaDeIdentidade } from "./aviso";
import { type ContagemDoDia, somarContagens } from "./contadores";
import { LOTE_INSERCAO, POSTO_DO_TIPO, type ResultadoEvento, TIPOS_PROVISORIOS } from "./regras";
import { efeitoDoEvento } from "./situacao";
import { chavesDoWaId } from "./telefone";

/** `emails`: ids dos eventos de conta novos e aplicados que pedem o e-mail. `contagem`: o que somar no dia. */
export type ResultadoGravacao = { emails: string[]; contagem: ContagemDoDia };

/** Chave interna de uma identidade (uso interno, nunca registrada): o BSUID, ou "wa:" + o wa_id. */
const chaveDaIdentidade = (c: Identidade): string => c.bsuid ?? `wa:${c.waId}`;

const emLotes = <T>(itens: readonly T[], tamanho: number = LOTE_INSERCAO): T[][] => {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
};
const porOrdem = <T>(itens: readonly T[], chave: (x: T) => string): T[] => [...itens].sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0));
const porHora = <T extends { em: Date }>(itens: readonly T[]): T[] => [...itens].sort((a, b) => a.em.getTime() - b.em.getTime());
const instante = (d: Date | null) => (d ? sql`${d.toISOString()}::timestamptz` : sql`null::timestamptz`);

/**
 * Uma gravação de vários blocos da mesma organização, na ordem do corpo. Cada bloco que não é de conta deixa um
 * `whatsapp_eventos` (campo, itens novos ou alterados, resultado), sem nada do corpo; o de conta deixa o evento dele
 * (`aplicarEventoDaConta`), só quando o evento é reconhecido. A contagem devolvida soma a da leitura (o que o parser
 * descartou ou ignorou) e a da gravação (reação a mensagem que o sistema não tem).
 */
export async function gravarBlocos(tx: Db, organizacaoId: string, blocos: BlocoLido[], agora: Date): Promise<ResultadoGravacao> {
  const r: ResultadoGravacao = { emails: [], contagem: {} };
  await travarIdentidades(tx, organizacaoId, blocos);
  for (const b of blocos) {
    somarContagens(r.contagem, b.contagem);
    if (b.campo === "account_update") {
      if (b.conta) {
        const email = await aplicarEventoDaConta(tx, organizacaoId, b.conta, agora);
        if (email) r.emails.push(email);
      }
      continue;
    }
    const { itens, aproveitados } = await gravarBloco(tx, organizacaoId, b, agora, r.contagem);
    const resultado: ResultadoEvento = itens > 0 ? "gravado" : aproveitados > 0 ? "repetido" : "ignorado";
    await tx.insert(whatsappEventos).values({ organizacaoId, campo: b.campo, itens, resultado, recebidoEm: agora });
  }
  return r;
}

/**
 * As chaves das travas de criação de conversa (uso interno, nunca registradas): uma por BSUID e uma por telefone na
 * forma única (a menor das variantes de `chavesDoWaId`, a mesma com e sem o nono dígito), sem repetição e em ordem.
 * Os índices únicos da 0073 só cobrem o `wa_id` exato: sem esta trava, duas entregas paralelas do mesmo cliente, uma
 * com o nono dígito e outra sem, achariam as duas "nenhuma conversa" e criariam duas.
 * @internal Exportado só para teste.
 */
export function chavesDasTravas(org: string, identidades: readonly Identidade[]): string[] {
  const chaves = new Set<string>();
  for (const c of identidades) {
    if (c.bsuid !== null) chaves.add(`whatsapp:contato:${org}:b:${c.bsuid}`);
    const variantes = c.waId !== null ? chavesDoWaId(c.waId) : [];
    if (variantes.length) chaves.add(`whatsapp:contato:${org}:w:${[...variantes].sort()[0]}`);
  }
  return [...chaves].sort();
}

/**
 * Antes do primeiro bloco, as travas de todas as identidades que podem ganhar conversa no corpo (as do passo 1),
 * numa instrução só e na ordem do hash: duas entregas que disputam as mesmas identidades as tomam na mesma ordem.
 * Ficam até o fim da transação.
 */
async function travarIdentidades(tx: Db, org: string, blocos: readonly BlocoLido[]): Promise<void> {
  const quem = blocos.flatMap((b) => [
    ...[...b.perfis, ...b.mensagens, ...b.edicoes, ...b.apagamentos].map((x) => x.cliente),
    ...b.trocas.flatMap((t) => [t.anterior, t.nova]),
  ]);
  const chaves = chavesDasTravas(org, quem);
  if (!chaves.length) return;
  const lista = sql.join(
    chaves.map((k) => sql`${k}`),
    sql`, `,
  );
  await tx.execute(sql`select pg_advisory_xact_lock(h) from (select hashtext(k) as h from unnest(array[${lista}]::text[]) as k order by 1) as ordem`);
}

/**
 * Passos 1 a 8 e 10 de um bloco. `itens` = linhas novas ou alteradas (mensagens, conversas, nomes, agenda, histórico);
 * `aproveitados` = itens que acharam onde se aplicar, mesmo sem mudar nada (0 = o bloco não tinha nada aproveitável).
 */
async function gravarBloco(tx: Db, org: string, b: BlocoLido, agora: Date, contagem: ContagemDoDia): Promise<{ itens: number; aproveitados: number }> {
  let itens = 0;
  let aproveitados = 0;
  const conversas = await garantirContatos(tx, org, b, agora);
  itens += conversas.alteradas;
  for (const t of porHora(b.trocas)) {
    const r = await aplicarTroca(tx, org, t, agora);
    itens += r.itens;
    aproveitados += r.achou ? 1 : 0;
  }
  const gravadas = await inserirMensagens(tx, org, b.mensagens, conversas.contatoDe, agora);
  itens += gravadas.length;
  aproveitados += b.mensagens.length;
  for (const e of porHora(b.edicoes)) itens += await aplicarEdicao(tx, org, e, conversas.contatoDe, agora);
  for (const a of porHora(b.apagamentos)) itens += await aplicarApagamento(tx, org, a, conversas.contatoDe, agora);
  aproveitados += b.edicoes.length + b.apagamentos.length;
  for (const reacao of porHora(b.reacoes)) {
    const r = await aplicarReacao(tx, org, reacao);
    if (r === "sem_alvo") contagem.ignorados = (contagem.ignorados ?? 0) + 1;
    else aproveitados += 1;
    if (r === "aplicada") itens += 1;
  }
  if (b.campo === "smb_app_state_sync") {
    const r = await aplicarAgenda(tx, org, b.agenda, agora);
    itens += r.itens;
    aproveitados += r.aproveitados;
  }
  if (b.progresso) {
    itens += await aplicarProgresso(tx, org, b.progresso.progresso, agora);
    aproveitados += 1;
  }
  if (b.historicoRecusado) {
    itens += await aplicarHistoricoRecusado(tx, org, agora);
    aproveitados += 1;
  }
  await resumirConversas(tx, org, gravadas, agora);
  return { itens, aproveitados };
}

// ---------------------------------------------------------------- 1. conversas

type Linha = { id: string; waId: string | null; bsuid: string | null; nomePerfil: string; conflito: boolean };

/** As linhas achadas, pelo BSUID e por cada chave do `wa_id` (`chavesDoWaId`: com e sem o nono dígito). */
class Indice {
  readonly porBsuid = new Map<string, Linha>();
  readonly porChave = new Map<string, Linha[]>();
  constructor(linhas: Iterable<Linha> = []) {
    for (const l of linhas) this.acrescentar(l);
  }
  acrescentar(l: Linha): void {
    if (l.bsuid !== null && !this.porBsuid.has(l.bsuid)) this.porBsuid.set(l.bsuid, l);
    for (const k of l.waId !== null ? chavesDoWaId(l.waId) : []) {
      const linhas = this.porChave.get(k) ?? [];
      if (!linhas.includes(l)) this.porChave.set(k, [...linhas, l]);
    }
  }
  /** A linha com o mesmo `wa_id` (primeiro) ou com uma variante dele. */
  doWaId(waId: string): Linha | undefined {
    let variante: Linha | undefined;
    for (const k of chavesDoWaId(waId)) {
      for (const l of this.porChave.get(k) ?? []) {
        if (l.waId === waId) return l;
        variante ??= l;
      }
    }
    return variante;
  }
  /**
   * A conversa de uma identidade: pelo BSUID primeiro; sem BSUID (ou sem achar), pelo `wa_id` e as variantes dele. A
   * regra das trocas (passo 2) e da agenda (passo 7); o passo 1 (`decidir`) faz as duas buscas separadas, porque
   * precisa saber se elas dão linhas diferentes (conflito).
   */
  daIdentidade(q: Identidade): Linha | undefined {
    return (q.bsuid !== null ? this.porBsuid.get(q.bsuid) : undefined) ?? (q.waId !== null ? this.doWaId(q.waId) : undefined);
  }
  /** Todas as linhas com o BSUID ou com alguma variante do `wa_id`: as que já têm a identidade nova de uma troca. */
  todasDa(q: Identidade): Set<Linha> {
    const linhas = new Set<Linha>();
    const pelaBsuid = q.bsuid !== null ? this.porBsuid.get(q.bsuid) : undefined;
    if (pelaBsuid) linhas.add(pelaBsuid);
    for (const k of q.waId !== null ? chavesDoWaId(q.waId) : []) for (const l of this.porChave.get(k) ?? []) linhas.add(l);
    return linhas;
  }
}

/** O que uma decisão muda nas linhas já gravadas (aplicado depois, linha a linha: completar e marcar conflito são raros). */
type Mudancas = { completadas: Set<Linha>; conflitos: Set<Linha> };

/**
 * Decide a conversa de uma identidade contra as linhas do índice (as do banco e as novas desta entrega), sem ir ao
 * banco. As duas buscas ficam separadas (e não em `Indice.daIdentidade`) para ver quando dão linhas diferentes: BSUID
 * e `wa_id` em linhas diferentes é conflito nas duas, e fica a do BSUID (T15: nunca fundir). Achou uma linha: completa
 * o campo que falta, que não está em nenhuma outra linha da organização (a busca cobre o BSUID e todas as variantes do
 * `wa_id`); a linha achada só pelo telefone, com outro BSUID, ganha o aviso de conflito (acréscimo ao desenho, dentro
 * de T15: pode ser outra pessoa com o mesmo número). Não achou: `criar` (ou null, na releitura depois do insert).
 */
function decidir(ind: Indice, quem: Identidade, mud: Mudancas, criar: (() => Linha) | null): Linha | null {
  const pelaBsuid = quem.bsuid !== null ? ind.porBsuid.get(quem.bsuid) : undefined;
  const peloWaId = quem.waId !== null ? ind.doWaId(quem.waId) : undefined;
  if (pelaBsuid && peloWaId && pelaBsuid !== peloWaId) {
    for (const l of [pelaBsuid, peloWaId]) if (!l.conflito) mud.conflitos.add(l);
    return pelaBsuid;
  }
  const l = pelaBsuid ?? peloWaId;
  if (!l) {
    if (!criar) return null;
    const nova = criar();
    ind.acrescentar(nova);
    return nova;
  }
  if (quem.bsuid !== null && l.bsuid === null) {
    l.bsuid = quem.bsuid;
    ind.acrescentar(l);
    mud.completadas.add(l);
  } else if (quem.bsuid !== null && l.bsuid !== quem.bsuid && !l.conflito) {
    mud.conflitos.add(l);
  }
  if (quem.waId !== null && l.waId === null) {
    l.waId = quem.waId;
    ind.acrescentar(l);
    mud.completadas.add(l);
  }
  return l;
}

/** As conversas da organização com algum dos BSUID ou alguma variante dos `wa_id`, em lotes de identidades. */
async function buscarContatos(tx: Db, org: string, quem: readonly Identidade[]): Promise<Linha[]> {
  const achadas = new Map<string, Linha>();
  for (const lote of emLotes(quem)) {
    const bsuids = [...new Set(lote.flatMap((q) => (q.bsuid !== null ? [q.bsuid] : [])))];
    const chaves = [...new Set(lote.flatMap((q) => (q.waId !== null ? chavesDoWaId(q.waId) : [])))];
    const filtros = [bsuids.length ? inArray(whatsappContatos.bsuid, bsuids) : undefined, chaves.length ? inArray(whatsappContatos.waId, chaves) : undefined].filter((f) => f !== undefined);
    if (!filtros.length) continue;
    const linhas = await tx
      .select({ id: whatsappContatos.id, waId: whatsappContatos.waId, bsuid: whatsappContatos.bsuid, nomePerfil: whatsappContatos.nomePerfil, conflito: whatsappContatos.conflitoIdentidade })
      .from(whatsappContatos)
      .where(and(eq(whatsappContatos.organizacaoId, org), or(...filtros)));
    for (const l of linhas) achadas.set(l.id, l);
  }
  return [...achadas.values()];
}

/**
 * Passo 1: a conversa de cada identidade do bloco (perfis, mensagens, edições, apagamentos e a identidade anterior de
 * cada troca). A identidade nova de uma troca do mesmo bloco não ganha conversa: se ela ainda não é de nenhuma outra
 * conversa, as mensagens e o perfil dela ficam com a conversa da anterior (o apelido, também em cadeia: A→B e B→C no
 * mesmo bloco caem todos na conversa de A), e o passo 2 troca a identidade dessa conversa. Se ela entrasse aqui como
 * qualquer outra, ganharia uma conversa própria e o passo 2 sempre a acharia "em outra conversa", com conflito falso
 * (a Meta junta até 1.000 atualizações por POST: a troca e a primeira mensagem nova podem vir juntas). Se ela já é de
 * outra conversa, não há apelido: as mensagens dela ficam nessa conversa e o passo 2 marca o conflito nas duas.
 * Uma busca em lote (com as identidades novas das trocas, para saber se já têm conversa), a decisão em memória, um
 * insert em lote das conversas novas (`on conflict do nothing`, sem alvo: cobre os dois únicos parciais) e, para as que
 * outra entrega criou no meio, uma releitura com as duas buscas (BSUID e `wa_id` com as variantes), completando o que
 * falta. Não achou nem assim: lança (500, a Meta reenvia). O nome do perfil é gravado quando muda e não é vazio.
 */
async function garantirContatos(tx: Db, org: string, b: BlocoLido, agora: Date): Promise<{ contatoDe: (c: Identidade) => string; alteradas: number }> {
  const trocas = porHora(b.trocas);
  const doBloco = [...b.perfis, ...b.mensagens, ...b.edicoes, ...b.apagamentos].map((x) => x.cliente);
  const paraBuscar = new Map<string, Identidade>();
  for (const c of [...doBloco, ...trocas.flatMap((t) => [t.anterior, t.nova])]) paraBuscar.set(`${c.bsuid ?? ""}|${c.waId ?? ""}`, c);
  const ind = new Indice(await buscarContatos(tx, org, porOrdem([...paraBuscar.values()], chaveDaIdentidade)));

  // Apelidos, pelas trocas na ordem da hora: chave da identidade nova → raiz (a chave da anterior da primeira troca da
  // cadeia, com a conversa dela no banco, se houver). Uma raiz nunca ganha apelido e uma chave nunca ganha dois: sem
  // ciclo (A→B e B→A no mesmo bloco ficam em A).
  const apelido = new Map<string, string>();
  const resolver = (c: Identidade): string => apelido.get(chaveDaIdentidade(c)) ?? chaveDaIdentidade(c);
  const raizes = new Map<string, { quem: Identidade; linha: Linha | undefined }>();
  for (const t of trocas) {
    const raiz = resolver(t.anterior);
    if (!raizes.has(raiz)) raizes.set(raiz, { quem: t.anterior, linha: ind.daIdentidade(t.anterior) });
    const daRaiz = raizes.get(raiz)!.linha;
    if ([...ind.todasDa(t.nova)].some((l) => l !== daRaiz)) continue;
    // A identidade nova pelo BSUID e pelo telefone (com as variantes): a mensagem nova pode trazer só um dos dois.
    const daNova = [chaveDaIdentidade(t.nova), ...(t.nova.waId !== null ? chavesDoWaId(t.nova.waId).map((k) => `wa:${k}`) : [])];
    for (const k of daNova) if (!raizes.has(k) && !apelido.has(k)) apelido.set(k, raiz);
  }

  const unicas = new Map<string, Identidade>();
  const nomes = new Map<string, string>();
  const juntar = (c: Identidade): string => {
    const k = resolver(c);
    const ja = unicas.get(k);
    // A identidade nova de uma troca não muda a identidade que acha a conversa da anterior.
    if (k !== chaveDaIdentidade(c)) {
      if (!ja) unicas.set(k, { ...raizes.get(k)!.quem });
    } else if (!ja) unicas.set(k, { ...c });
    else if (ja.waId === null && c.waId !== null) ja.waId = c.waId;
    return k;
  };
  for (const p of b.perfis) nomes.set(juntar(p.cliente), p.nome);
  for (const x of [...b.mensagens, ...b.edicoes, ...b.apagamentos]) juntar(x.cliente);
  for (const t of trocas) juntar(t.anterior);
  const mapa = new Map<string, string>();
  const contatoDe = (c: Identidade): string => {
    const id = mapa.get(resolver(c));
    if (!id) throw new Error("WhatsApp: mensagem sem conversa na gravação");
    return id;
  };
  if (!unicas.size) return { contatoDe, alteradas: 0 };

  // Ordem estável das identidades (e das travas que elas tomam) entre entregas paralelas.
  const chaves = porOrdem([...unicas.keys()], (k) => k);
  const mud: Mudancas = { completadas: new Set(), conflitos: new Set() };
  const novas: Linha[] = [];
  const linhaDe = new Map<string, Linha>();
  for (const k of chaves) {
    const quem = unicas.get(k)!;
    const l = decidir(ind, quem, mud, () => {
      const nova: Linha = { id: "", waId: quem.waId, bsuid: quem.bsuid, nomePerfil: "", conflito: false };
      novas.push(nova);
      return nova;
    });
    linhaDe.set(k, l!);
  }
  const ehNova = new Set(novas);
  // Conflito com uma linha nova: ela já nasce marcada.
  for (const l of mud.conflitos) if (ehNova.has(l)) l.conflito = true;
  // O nome do perfil, no fim (a mesma conversa pode vir por duas identidades).
  const nomeDe = new Map<Linha, string>();
  for (const [k, nome] of nomes) nomeDe.set(linhaDe.get(k)!, nome);
  for (const nova of novas) nova.nomePerfil = nomeDe.get(nova) ?? "";

  let alteradas = 0;
  // Conversas novas, em lote. A que não voltou foi criada por outra entrega entre a busca e o insert.
  const naoGravadas: Linha[] = [];
  for (const lote of emLotes(novas)) {
    const gravadas = await tx
      .insert(whatsappContatos)
      .values(lote.map((n) => ({ organizacaoId: org, waId: n.waId, bsuid: n.bsuid, nomePerfil: n.nomePerfil, conflitoIdentidade: n.conflito, atualizadoEm: agora })))
      .onConflictDoNothing()
      .returning({ id: whatsappContatos.id, waId: whatsappContatos.waId, bsuid: whatsappContatos.bsuid });
    for (const n of lote) {
      const g = gravadas.find((x) => (n.bsuid !== null ? x.bsuid === n.bsuid : x.waId === n.waId));
      if (g) n.id = g.id;
      else naoGravadas.push(n);
    }
    alteradas += gravadas.length;
  }
  // Releitura das que outra entrega criou: as duas buscas, e de novo o ramo "achou" (completar ou marcar conflito).
  const substituta = new Map<Linha, Linha>();
  if (naoGravadas.length) {
    const doBanco = new Indice(await buscarContatos(tx, org, naoGravadas));
    for (const n of naoGravadas) {
      const l = decidir(doBanco, { waId: n.waId, bsuid: n.bsuid }, mud, null);
      if (!l) throw new Error("WhatsApp: conversa não encontrada depois do insert");
      if (n.conflito && !l.conflito) mud.conflitos.add(l);
      substituta.set(n, l);
    }
  }
  const final = (l: Linha) => substituta.get(l) ?? l;
  for (const [k, l] of linhaDe) mapa.set(k, final(l).id);

  // Completar e marcar conflito: linha a linha, na ordem das identidades.
  for (const l of mud.completadas) {
    if (ehNova.has(l)) continue;
    const r = await tx
      .update(whatsappContatos)
      .set({ waId: sql`coalesce(${whatsappContatos.waId}, ${l.waId})`, bsuid: sql`coalesce(${whatsappContatos.bsuid}, ${l.bsuid})`, atualizadoEm: agora })
      .where(and(eq(whatsappContatos.id, l.id), eq(whatsappContatos.organizacaoId, org)))
      .returning({ id: whatsappContatos.id });
    alteradas += r.length;
  }
  const conflitos = [...mud.conflitos].filter((l) => !ehNova.has(l)).map((l) => l.id);
  if (conflitos.length) {
    const r = await tx
      .update(whatsappContatos)
      .set({ conflitoIdentidade: true, atualizadoEm: agora })
      .where(and(eq(whatsappContatos.organizacaoId, org), inArray(whatsappContatos.id, conflitos), eq(whatsappContatos.conflitoIdentidade, false)))
      .returning({ id: whatsappContatos.id });
    alteradas += r.length;
  }
  // Nome do perfil das conversas que já existiam (ou que outra entrega criou), quando muda e não é vazio.
  const renomear = porOrdem(
    [...nomeDe].flatMap(([l, nome]) => {
      const alvo = final(l);
      return nome && (substituta.has(l) || !ehNova.has(l)) && alvo.nomePerfil !== nome ? [{ id: alvo.id, nome }] : [];
    }),
    (x) => x.id,
  );
  for (const lote of emLotes(renomear)) {
    const valores = sql.join(lote.map((x) => sql`(${x.id}::uuid, ${x.nome}::text)`), sql`, `);
    const r = await tx
      .update(whatsappContatos)
      .set({ nomePerfil: sql`v.nome`, atualizadoEm: agora })
      .from(sql`(values ${valores}) as v(id, nome)`)
      .where(and(eq(whatsappContatos.organizacaoId, org), sql`${whatsappContatos.id} = v.id`, sql`${whatsappContatos.nomePerfil} <> v.nome`))
      .returning({ id: whatsappContatos.id });
    alteradas += r.length;
  }
  return { contatoDe, alteradas };
}

// ---------------------------------------------------------------- 2. trocas de identidade

/**
 * Passo 2: troca de número (`user_changed_number`) ou de BSUID (`user_changed_user_id`). Acha a conversa pela identidade
 * anterior (`Indice.daIdentidade`: o `user_changed_number` sem `from` acha só pelo BSUID antigo); se a nova já é de
 * outra conversa, as duas ganham o aviso de conflito e nada muda (T15); senão a conversa passa a ter a identidade nova,
 * e campo nulo na nova não apaga o da conversa (a troca de BSUID mantém o `wa_id`; a de número sem BSUID novo mantém o
 * BSUID). A linha `sistema` entra no passo 3, na conversa da identidade anterior.
 */
async function aplicarTroca(tx: Db, org: string, t: TrocaDeIdentidade, agora: Date): Promise<{ itens: number; achou: boolean }> {
  const ind = new Indice(await buscarContatos(tx, org, [t.anterior, t.nova]));
  const conversa = ind.daIdentidade(t.anterior);
  if (!conversa) return { itens: 0, achou: false };
  const outras = [...ind.todasDa(t.nova)].filter((l) => l !== conversa);
  if (outras.length) {
    const r = await tx
      .update(whatsappContatos)
      .set({ conflitoIdentidade: true, atualizadoEm: agora })
      .where(and(eq(whatsappContatos.organizacaoId, org), inArray(whatsappContatos.id, porOrdem([conversa.id, ...outras.map((o) => o.id)], (x) => x)), eq(whatsappContatos.conflitoIdentidade, false)))
      .returning({ id: whatsappContatos.id });
    return { itens: r.length, achou: true };
  }
  const waId = sql`coalesce(${t.nova.waId}::text, ${whatsappContatos.waId})`;
  const bsuid = sql`coalesce(${t.nova.bsuid}::text, ${whatsappContatos.bsuid})`;
  const r = await tx
    .update(whatsappContatos)
    .set({ waId, bsuid, atualizadoEm: agora })
    .where(and(eq(whatsappContatos.id, conversa.id), eq(whatsappContatos.organizacaoId, org), sql`(${whatsappContatos.waId} is distinct from ${waId} or ${whatsappContatos.bsuid} is distinct from ${bsuid})`))
    .returning({ id: whatsappContatos.id });
  return { itens: r.length, achou: true };
}

// ---------------------------------------------------------------- 3. mensagens

/** A precedência por posto (`POSTO_DO_TIPO`, regras.ts) escrita em SQL: pendente 0; os outros provisórios 1; conteúdo 2. */
function postoEmSql(tipo: SQL | PgColumn): SQL {
  const casos = sql.join(TIPOS_PROVISORIOS.map((t) => sql`when ${t} then ${sql.raw(String(POSTO_DO_TIPO(t)))}`), sql` `);
  return sql`(case ${tipo} ${casos} else ${sql.raw(String(POSTO_DO_TIPO("texto")))} end)`;
}
/** A linha que chegou no `on conflict` (nomes de coluna da 0073, de uma lista fechada). */
const NOVO = { tipo: sql.raw("excluded.tipo"), anexoMime: sql.raw("excluded.anexo_mime"), texto: sql.raw("excluded.texto"), respostaA: sql.raw("excluded.resposta_a"), enviadaEm: sql.raw("excluded.enviada_em"), origem: sql.raw("excluded.origem") };

type MensagemGravada = Pick<typeof whatsappMensagens.$inferSelect, "id" | "contatoId" | "direcao" | "origem" | "tipo" | "enviadaEm">;

/**
 * Passo 3: insere as mensagens em lotes de 500, ordenadas pelo wamid (ordem estável de travas), sem repetir wamid no
 * lote (fica o de maior posto e, no empate, o primeiro: o Postgres recusa um `on conflict do update` que toca a mesma
 * linha duas vezes). No mesmo wamid, a precedência por posto (T16):
 * - o conteúdo só sobe de posto, nunca desce (uma 131060 reenviada depois do conteúdo não apaga texto nem tipo);
 * - o tempo real nunca volta a ser histórico (o histórico depois de uma 131060 em tempo real traz o conteúdo e fica
 *   `tempo_real`); `resposta_a` e `anexo_mime` não são apagados por um aviso que não os traz;
 * - o provisório `pendente` ganha a hora verdadeira da original; apagada continua sem texto; editada mantém o texto
 *   da edição; a conversa nunca muda.
 * Repetição (inclusive do mesmo provisório) e eco do mesmo wamid não voltam no `returning`: o bloco sai "repetido".
 */
async function inserirMensagens(tx: Db, org: string, mensagens: readonly MensagemLida[], contatoDe: (c: Identidade) => string, agora: Date): Promise<MensagemGravada[]> {
  const unicas = new Map<string, MensagemLida>();
  for (const m of mensagens) {
    const ja = unicas.get(m.wamid);
    if (!ja || POSTO_DO_TIPO(m.conteudo.tipo) > POSTO_DO_TIPO(ja.conteudo.tipo)) unicas.set(m.wamid, m);
  }
  const atual = whatsappMensagens;
  const sobe = sql`${postoEmSql(NOVO.tipo)} > ${postoEmSql(atual.tipo)}`;
  const gravadas: MensagemGravada[] = [];
  for (const lote of emLotes(porOrdem([...unicas.values()], (m) => m.wamid))) {
    const linhas = await tx
      .insert(whatsappMensagens)
      .values(
        lote.map((m) => ({
          organizacaoId: org,
          contatoId: contatoDe(m.cliente),
          wamid: m.wamid,
          direcao: m.direcao,
          origem: m.origem,
          tipo: m.conteudo.tipo,
          texto: m.conteudo.texto,
          anexoMime: m.conteudo.anexoMime,
          respostaA: m.conteudo.respostaA,
          enviadaEm: m.enviadaEm,
          recebidaEm: agora,
        })),
      )
      .onConflictDoUpdate({
        target: [atual.organizacaoId, atual.wamid],
        set: {
          tipo: sql`case when ${sobe} then ${NOVO.tipo} else ${atual.tipo} end`,
          anexoMime: sql`case when ${sobe} then coalesce(${NOVO.anexoMime}, ${atual.anexoMime}) else coalesce(${atual.anexoMime}, ${NOVO.anexoMime}) end`,
          texto: sql`case when ${atual.apagadaEm} is not null then '' when ${atual.editadaEm} is not null then ${atual.texto} when ${sobe} then ${NOVO.texto} else ${atual.texto} end`,
          respostaA: sql`coalesce(${atual.respostaA}, ${NOVO.respostaA})`,
          enviadaEm: sql`case when ${atual.tipo} = 'pendente' then ${NOVO.enviadaEm} else ${atual.enviadaEm} end`,
          origem: sql`case when 'tempo_real' in (${atual.origem}, ${NOVO.origem}) then 'tempo_real' else 'historico' end`,
        },
        setWhere: sql`${sobe} or (${atual.origem} = 'historico' and ${NOVO.origem} = 'tempo_real')`,
      })
      .returning({ id: atual.id, contatoId: atual.contatoId, direcao: atual.direcao, origem: atual.origem, tipo: atual.tipo, enviadaEm: atual.enviadaEm });
    gravadas.push(...linhas);
  }
  return gravadas;
}

// ---------------------------------------------------------------- 4 e 5. edições e apagamentos

/**
 * A linha provisória (`pendente`) de uma edição ou de um apagamento que chegou antes da original, na conversa de quem
 * mandou; a original, quando chegar no mesmo wamid, sobe de posto e mantém o texto editado ou apagado. Se outra entrega
 * criou a linha no meio (`on conflict do nothing` sem nada devolvido), quem chama aplica de novo.
 */
async function inserirProvisoria(tx: Db, org: string, x: EdicaoLida | ApagamentoLido, contatoDe: (c: Identidade) => string, agora: Date, campos: { texto: string; anexoMime?: string | null; editadaEm?: Date; apagadaEm?: Date }): Promise<boolean> {
  const r = await tx
    .insert(whatsappMensagens)
    .values({ organizacaoId: org, contatoId: contatoDe(x.cliente), wamid: x.original, direcao: x.direcao, origem: x.origem, tipo: "pendente", enviadaEm: x.em, recebidaEm: agora, ...campos })
    .onConflictDoNothing()
    .returning({ id: whatsappMensagens.id });
  return r.length > 0;
}

/**
 * Passo 4: edição mais nova que a aplicada, sobre mensagem não apagada: troca o texto (o provisório mantém o tipo
 * provisório até a original chegar), o mime só se a edição traz um. Edição mais velha ou sobre apagada: nada muda.
 * Original inexistente: a linha provisória com o texto da edição. Devolve as linhas alteradas (0 ou 1).
 */
async function aplicarEdicao(tx: Db, org: string, e: EdicaoLida, contatoDe: (c: Identidade) => string, agora: Date): Promise<number> {
  const atualizar = () =>
    tx
      .update(whatsappMensagens)
      .set({
        texto: e.conteudo.texto,
        tipo: sql`case when ${inArray(whatsappMensagens.tipo, [...TIPOS_PROVISORIOS])} then ${whatsappMensagens.tipo} else ${e.conteudo.tipo} end`,
        anexoMime: sql`coalesce(${e.conteudo.anexoMime}::text, ${whatsappMensagens.anexoMime})`,
        editadaEm: e.em,
      })
      .where(
        and(
          eq(whatsappMensagens.organizacaoId, org),
          eq(whatsappMensagens.wamid, e.original),
          isNull(whatsappMensagens.apagadaEm),
          or(isNull(whatsappMensagens.editadaEm), lt(whatsappMensagens.editadaEm, e.em)),
        ),
      )
      .returning({ id: whatsappMensagens.id });
  if ((await atualizar()).length) return 1;
  if (await inserirProvisoria(tx, org, e, contatoDe, agora, { texto: e.conteudo.texto, anexoMime: e.conteudo.anexoMime, editadaEm: e.em })) return 1;
  return (await atualizar()).length;
}

/**
 * Passo 5: apagamento é absorvente (o CHECK `whatsapp_mensagens_apagada_sem_texto` garante no banco): o texto some e
 * nada depois o devolve. Original inexistente: a linha provisória sem texto. Repetido: nada muda.
 */
async function aplicarApagamento(tx: Db, org: string, a: ApagamentoLido, contatoDe: (c: Identidade) => string, agora: Date): Promise<number> {
  const atualizar = () =>
    tx
      .update(whatsappMensagens)
      .set({ apagadaEm: a.em, texto: "" })
      .where(and(eq(whatsappMensagens.organizacaoId, org), eq(whatsappMensagens.wamid, a.original), isNull(whatsappMensagens.apagadaEm)))
      .returning({ id: whatsappMensagens.id });
  if ((await atualizar()).length) return 1;
  if (await inserirProvisoria(tx, org, a, contatoDe, agora, { texto: "", apagadaEm: a.em })) return 1;
  return (await atualizar()).length;
}

// ---------------------------------------------------------------- 6. reações

/**
 * Passo 6: a reação mais nova vale (retirada = sem emoji); a mais velha não volta. Não cria linha e não mexe em "sem
 * resposta" nem em "não lida". Mensagem que o sistema não tem (por exemplo, enviada pela API): `sem_alvo`, contada em
 * `ignorados`.
 */
async function aplicarReacao(tx: Db, org: string, r: ReacaoLida): Promise<"aplicada" | "velha" | "sem_alvo"> {
  const alvo = and(eq(whatsappMensagens.organizacaoId, org), eq(whatsappMensagens.wamid, r.alvo));
  const feita = await tx
    .update(whatsappMensagens)
    .set({ reacao: r.emoji, reacaoEm: r.em })
    .where(and(alvo, or(isNull(whatsappMensagens.reacaoEm), lt(whatsappMensagens.reacaoEm, r.em))))
    .returning({ id: whatsappMensagens.id });
  if (feita.length) return "aplicada";
  const [existe] = await tx.select({ id: whatsappMensagens.id }).from(whatsappMensagens).where(alvo).limit(1);
  return existe ? "velha" : "sem_alvo";
}

// ---------------------------------------------------------------- 7. agenda

/**
 * Passo 7 (T11): a agenda do celular só dá o nome de quem já tem conversa (achada pelo BSUID e, sem ele, pelo `wa_id`
 * com as variantes; o número da agenda vem na forma do `wa_id`, com o código do país, como no exemplo da referência de
 * smb_app_state_sync). Quem não tem conversa é descartado sem rastro: nada é criado nem contado. Por conversa vale o
 * item mais novo (`add` grava o nome, `remove` limpa), e só se for mais novo que o gravado. Todo bloco de agenda
 * aceito marca que a agenda chegou (`contatos_recebidos_em`; a Meta não manda sinal de fim).
 */
async function aplicarAgenda(tx: Db, org: string, agenda: readonly AgendaLida[], agora: Date): Promise<{ itens: number; aproveitados: number }> {
  const ind = new Indice(await buscarContatos(tx, org, agenda.map((a) => a.cliente)));
  const porConversa = new Map<string, AgendaLida>();
  for (const a of agenda) {
    const l = ind.daIdentidade(a.cliente);
    if (!l) continue;
    const ja = porConversa.get(l.id);
    if (!ja || ja.em.getTime() <= a.em.getTime()) porConversa.set(l.id, a);
  }
  let itens = 0;
  for (const lote of emLotes(porOrdem([...porConversa], ([id]) => id))) {
    const valores = sql.join(lote.map(([id, a]) => sql`(${id}::uuid, ${a.acao === "add" ? (a.nome ?? "") : ""}::text, ${instante(a.em)})`), sql`, `);
    const r = await tx
      .update(whatsappContatos)
      .set({ nomeAgenda: sql`v.nome`, nomeAgendaEm: sql`v.em`, atualizadoEm: agora })
      .from(sql`(values ${valores}) as v(id, nome, em)`)
      .where(and(eq(whatsappContatos.organizacaoId, org), sql`${whatsappContatos.id} = v.id`, sql`(${whatsappContatos.nomeAgendaEm} is null or ${whatsappContatos.nomeAgendaEm} < v.em)`))
      .returning({ id: whatsappContatos.id });
    itens += r.length;
  }
  const sinc = whatsappConta.sincronizacaoContatos;
  await tx
    .insert(whatsappConta)
    .values({ organizacaoId: org, sincronizacaoContatos: "recebendo", contatosRecebidosEm: agora, atualizadoEm: agora })
    .onConflictDoUpdate({
      target: whatsappConta.organizacaoId,
      set: {
        contatosRecebidosEm: sql`greatest(${whatsappConta.contatosRecebidosEm}, ${instante(agora)})`,
        sincronizacaoContatos: sql`case when ${sinc} in ('nao_pedida', 'pedida') then 'recebendo' else ${sinc} end`,
        atualizadoEm: agora,
      },
    });
  return { itens, aproveitados: porConversa.size };
}

// ---------------------------------------------------------------- 8. histórico

/**
 * Passo 8: o progresso do histórico fica no maior recebido (pedaços fora de ordem não importam: as mensagens são
 * idempotentes); 100 = concluído; antes disso, "recebendo" se estava não pedido ou pedido. Devolve 1 se mudou.
 */
async function aplicarProgresso(tx: Db, org: string, progresso: number, agora: Date): Promise<number> {
  const sinc = whatsappConta.sincronizacaoHistorico;
  const maior = sql`greatest(coalesce(${whatsappConta.progressoHistorico}, 0), ${progresso}::integer)`;
  const estado = progresso === 100 ? sql`'concluida'` : sql`case when ${sinc} in ('nao_pedida', 'pedida') then 'recebendo' else ${sinc} end`;
  const r = await tx
    .insert(whatsappConta)
    .values({ organizacaoId: org, progressoHistorico: progresso, sincronizacaoHistorico: progresso === 100 ? "concluida" : "recebendo", atualizadoEm: agora })
    .onConflictDoUpdate({
      target: whatsappConta.organizacaoId,
      set: { progressoHistorico: maior, sincronizacaoHistorico: estado, atualizadoEm: agora },
      setWhere: sql`${whatsappConta.progressoHistorico} is distinct from ${maior} or ${sinc} is distinct from ${estado}`,
    })
    .returning({ id: whatsappConta.organizacaoId });
  return r.length;
}

/** Histórico recusado no celular (2593109): "recusado", salvo se já concluído. Devolve 1 se mudou. */
async function aplicarHistoricoRecusado(tx: Db, org: string, agora: Date): Promise<number> {
  const r = await tx
    .insert(whatsappConta)
    .values({ organizacaoId: org, sincronizacaoHistorico: "recusada", atualizadoEm: agora })
    .onConflictDoUpdate({
      target: whatsappConta.organizacaoId,
      set: { sincronizacaoHistorico: "recusada", atualizadoEm: agora },
      setWhere: sql`${whatsappConta.sincronizacaoHistorico} not in ('concluida', 'recusada')`,
    })
    .returning({ id: whatsappConta.organizacaoId });
  return r.length;
}

// ---------------------------------------------------------------- 9. eventos de conta

/** A chave de repetição do evento de conta: só códigos e a hora da Meta, nunca wamid, telefone, BSUID ou id da Meta. */
const chaveDoEventoDaConta = (c: ContaLida): string =>
  `account_update:${c.evento}:${Math.floor(c.em.getTime() / 1000)}:${c.motivo ?? "-"}:${c.banimento ?? "-"}`;

/**
 * Passo 9: grava o evento de conta uma vez só (a chave dá a idempotência: repetido não grava, não muda a situação e não
 * pede e-mail de novo). Com efeito (`efeitoDoEvento`), muda a situação só se o evento for mais novo que o último
 * aplicado (empate: o que vem depois no corpo); se a situação mudou, a auditoria `whatsapp.conta.situacao` só com
 * códigos e sem autor (o sistema). Aplicado e com e-mail: marca o evento para o e-mail e devolve o id dele. Evento velho
 * (não aplicado) não manda e-mail. Sem efeito: fica só o registro, para Integrações.
 */
async function aplicarEventoDaConta(tx: Db, org: string, c: ContaLida, agora: Date): Promise<string | null> {
  const [evento] = await tx
    .insert(whatsappEventos)
    .values({ organizacaoId: org, campo: "account_update", tipo: c.evento, motivo: c.motivo, chave: chaveDoEventoDaConta(c), ocorridoEm: c.em, resultado: "gravado", recebidoEm: agora })
    .onConflictDoNothing()
    .returning({ id: whatsappEventos.id });
  if (!evento) return null;
  const efeito = efeitoDoEvento(c);
  if (!efeito) return null;
  // A linha da conta existe antes da trava: sem ela, o `for update` não trava nada, e duas entregas paralelas com
  // eventos diferentes leriam a mesma situação "de antes" (a auditoria sairia com a anterior errada, ou repetida). Com
  // ela, a outra entrega espera este insert e lê a situação já gravada.
  await tx.insert(whatsappConta).values({ organizacaoId: org, atualizadoEm: agora }).onConflictDoNothing();
  const [antes] = await tx
    .select({ situacao: whatsappConta.situacao, motivo: whatsappConta.motivo })
    .from(whatsappConta)
    .where(eq(whatsappConta.organizacaoId, org))
    .for("update");
  const aplicado = await tx
    .update(whatsappConta)
    .set({
      situacao: efeito.situacao,
      ultimoEvento: c.evento,
      motivo: efeito.motivo,
      iniciadoPor: efeito.iniciadoPor,
      situacaoEm: c.em,
      ...(efeito.conectadoEm ? { conectadoEm: efeito.conectadoEm } : {}),
      atualizadoEm: agora,
    })
    .where(and(eq(whatsappConta.organizacaoId, org), or(isNull(whatsappConta.situacaoEm), lte(whatsappConta.situacaoEm, c.em))))
    .returning({ situacao: whatsappConta.situacao });
  if (!aplicado.length) return null;
  if (antes.situacao !== efeito.situacao) {
    await registrarAuditoria(tx, {
      organizacaoId: org,
      usuarioId: null,
      acao: "whatsapp.conta.situacao",
      entidade: "whatsapp_conta",
      entidadeId: org,
      mudancas: { situacao: [antes.situacao, efeito.situacao], motivo: [antes.motivo, efeito.motivo] },
    });
  }
  if (!efeito.email) return null;
  await tx.update(whatsappEventos).set({ avisarPorEmail: true }).where(eq(whatsappEventos.id, evento.id));
  return evento.id;
}

// ---------------------------------------------------------------- 10. resumo das conversas

/** Mensagem que "pede resposta" (T13): recebida em tempo real, menos o aviso de troca de número ou de BSUID. */
const pedeResposta = (m: MensagemGravada) => m.direcao === "recebida" && m.origem === "tempo_real" && m.tipo !== "sistema";
/** Resposta (T13): enviada (pelo celular, ou pelo painel no M10.2) em tempo real. */
const ehResposta = (m: MensagemGravada) => m.direcao !== "recebida" && m.origem === "tempo_real";
const maisNova = (a: Date | null, b: Date) => (a && a.getTime() >= b.getTime() ? a : b);

/**
 * Passo 10: uma instrução por lote de conversas (ordenadas pelo id), a partir das mensagens novas ou alteradas do passo
 * 3: a última mensagem (qualquer uma: ordena a lista), a última recebida e a última enviada em tempo real ("sem
 * resposta" e "não lida"; o histórico não conta). `greatest` ignora nulo e nunca volta para trás: idempotente.
 * Reação, edição e apagamento não passam por aqui.
 */
async function resumirConversas(tx: Db, org: string, gravadas: readonly MensagemGravada[], agora: Date): Promise<void> {
  const porConversa = new Map<string, { ultima: Date; recebida: Date | null; enviada: Date | null }>();
  for (const m of gravadas) {
    const r = porConversa.get(m.contatoId) ?? { ultima: m.enviadaEm, recebida: null, enviada: null };
    r.ultima = maisNova(r.ultima, m.enviadaEm);
    if (pedeResposta(m)) r.recebida = maisNova(r.recebida, m.enviadaEm);
    if (ehResposta(m)) r.enviada = maisNova(r.enviada, m.enviadaEm);
    porConversa.set(m.contatoId, r);
  }
  const c = whatsappContatos;
  for (const lote of emLotes(porOrdem([...porConversa], ([id]) => id))) {
    const valores = sql.join(lote.map(([id, r]) => sql`(${id}::uuid, ${instante(r.ultima)}, ${instante(r.recebida)}, ${instante(r.enviada)})`), sql`, `);
    await tx
      .update(c)
      .set({
        ultimaMensagemEm: sql`greatest(${c.ultimaMensagemEm}, v.ultima)`,
        ultimaRecebidaEm: sql`greatest(${c.ultimaRecebidaEm}, v.recebida)`,
        ultimaEnviadaEm: sql`greatest(${c.ultimaEnviadaEm}, v.enviada)`,
        atualizadoEm: agora,
      })
      .from(sql`(values ${valores}) as v(id, ultima, recebida, enviada)`)
      .where(and(eq(c.organizacaoId, org), sql`${c.id} = v.id`));
  }
}
