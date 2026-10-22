import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { copiarLeitura } from "@/calendario/copias";
import { beds24Calendario, beds24Execucoes, beds24ExecucaoReservas, bloqueios, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { ErroDeRotina, type MotivoDeFalha, umaFalha } from "@/observabilidade/erro-de-rotina";
import { registrarRemocaoDeBloqueio } from "@/reservas/bloqueios";
import { sincronizarReserva } from "@/reservas/repositorio";
import { lerConfigBeds24, listarMapeamentosBeds24, quartoAcessivelEmBrl } from "./configuracao";
import { paraDadosReserva } from "./converter";
import { avisoDaConferencia, avisoDeRegistroIlegivel, avisoDeReleituraSemConclusao, conferirNaImportacao, desvioNaImportacao, passarEnviandoVencidasAIncerta, prepararDesvioNaImportacao, type RegistroConhecido } from "./reservas-site";
import { ErroBeds24, type LeitorBeds24, type Lido, type ReservaBeds24 } from "./tipos";
import { CAUSA_EM_ANDAMENTO, escritaBeds24EmAndamento, MENSAGEM_ENVIO_EM_ANDAMENTO, MENSAGEM_RESERVA_EM_ANDAMENTO_EQUIPE, tentarTravaBeds24 } from "./trava";

export type ResultadoSync = {
  ok: boolean; situacao: "ok" | "parcial" | "erro" | "ocupada" | "desligada";
  criadas: number; atualizadas: number; iguais: number; bloqueios: number; diasCalendario: number;
  totalDivergencias: number; divergencias: string[]; mensagem: string;
  /** Só na "ocupada": a causa em poucas palavras (a rotina diária registra "não rodou: <causa>"). */
  causa?: string;
  /** Na situação "erro": o tipo da falha, para o aviso da rotina automática ao Sentry (M0.9). */
  falha?: FalhaBeds24;
};
const resultado = (): ResultadoSync => ({ ok: true, situacao: "ok", criadas: 0, atualizadas: 0, iguais: 0, bloqueios: 0, diasCalendario: 0, totalDivergencias: 0, divergencias: [], mensagem: "" });
const referencia = (s: string) => /^[A-Za-z0-9._:-]{1,64}$/.test(s) ? s : "não identificado";
const somarDias = (data: string, n: number) => new Date(Date.parse(`${data}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const aviso = (r: ResultadoSync, s: string) => { r.totalDivergencias++; if (r.divergencias.length < 100) r.divergencias.push(s.slice(0, 300)); };

/**
 * Um id que volta mais de uma vez numa consulta (legível ou em formato inválido; na leitura principal, ou em qualquer lote da
 * releitura por id) deixa a resposta ambígua: não dá para saber qual cópia vale. Nada é aplicado. O "?" e o id torto de um
 * registro ilegível não contam: não casam com id nenhum. `vistos` junta os lotes de uma mesma consulta. A mesma proteção na
 * importação e na conferência contínua das reservas do site (M8.3c, desenho 4.5).
 */
export function semIdsRepetidos(l: Lido<ReservaBeds24>, vistos = new Set<string>()) {
  for (const id of [...l.itens.map(b => b.idExterno), ...l.divergencias.map(d => d.id).filter(id => referencia(id) === id)]) {
    if (vistos.has(id)) throw new ErroBeds24("Consulta com IDs de reserva repetidos. Confira a origem antes de importar; nenhuma mudança foi aplicada.", "formato");
    vistos.add(id);
  }
}

/** O que a releitura por id trouxe (`relerPorIds`). */
export type ReleituraPorIds = {
  /** Os registros legíveis dos ids pedidos. */
  legiveis: ReservaBeds24[];
  /** Os ids pedidos que voltaram em formato inválido, na ordem: o registro existe, só não deu para ler (nunca "não voltou"). */
  ilegiveis: string[];
  /** Registros de um id fora do lote pedido, legíveis ou não, ou sem id legível: a resposta não é a do pedido. */
  semDono: number;
};

/**
 * A releitura por id, em lotes de 50, sem filtro de chegada (desde 1900: sem ele, só as futuras) e com os info items. Uma
 * regra, um lugar (M8.3c, desenho 4.5): a importação relê os ids conhecidos que saíram do filtro, e a conferência contínua
 * relê as reservas do site de hora em hora. Um id que volta duas vezes, nesta releitura ou já visto antes na mesma consulta
 * (`vistos`), para tudo (`semIdsRepetidos` lança). Quem chama decide o que o id que não voltou quer dizer: com qualquer
 * registro sem dono, nenhum conta como "não voltou" (apagado), porque o registro sem dono pode ser ele.
 */
export async function relerPorIds(leitor: LeitorBeds24, ids: readonly string[], vistos: Set<string>): Promise<ReleituraPorIds> {
  const r: ReleituraPorIds = { legiveis: [], ilegiveis: [], semDono: 0 };
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const l = await leitor.reservas({ ids: lote, chegadaDe: "1900-01-01", incluirInfo: true });
    semIdsRepetidos(l, vistos);
    for (const b of l.itens) {
      if (lote.includes(b.idExterno)) r.legiveis.push(b);
      else r.semDono++;
    }
    for (const d of l.divergencias) {
      if (!lote.includes(d.id)) r.semDono++;
      else if (!r.ilegiveis.includes(d.id)) r.ilegiveis.push(d.id);
    }
  }
  return r;
}

export function mensagemSeguraBeds24(e: unknown): string {
  return e instanceof ErroBeds24 ? e.message : "Não foi possível confirmar o resultado. Confira o histórico de importações antes de tentar novamente.";
}

/** O tipo de uma falha do Beds24 (M0.9): o do `ErroBeds24` ou, para qualquer outro erro (do banco, por exemplo), "erro_inesperado". */
export type FalhaBeds24 = ErroBeds24["tipo"] | "erro_inesperado";

/** Cada tipo é um motivo da lista fechada do aviso ao Sentry (a anotação confere isso na compilação). */
function falhaBeds24(e: unknown): FalhaBeds24 & MotivoDeFalha {
  return e instanceof ErroBeds24 ? e.tipo : "erro_inesperado";
}

/**
 * Falha de uma rotina automática do Beds24 (M0.9): a mensagem segura de sempre vai para a página Sistema (ela pode ter
 * o código de um imóvel); o aviso ao Sentry leva só o motivo (o tipo do `ErroBeds24`) e a causa sem a mensagem dela.
 */
export function erroDaRotinaBeds24(e: unknown): ErroDeRotina {
  return new ErroDeRotina(mensagemSeguraBeds24(e), umaFalha(falhaBeds24(e)), { cause: e });
}

/** Uma transação/organização: a leitura completa precede as gravações; falha técnica desfaz tudo. */
export async function sincronizarBeds24(db: Db, org: string, leitor: LeitorBeds24, o: { automatica?: boolean; autorId?: string | null; agora?: Date } = {}): Promise<ResultadoSync> {
  if (o.automatica && !(await lerConfigBeds24(db, org)).automatica) return { ...resultado(), situacao: "desligada", mensagem: "Sincronização automática desligada no painel." };
  const agora = o.agora ?? new Date();
  const limite = Date.now() + 240_000;
  const [exec] = await db.insert(beds24Execucoes).values({ organizacaoId: org, iniciadoEm: agora }).returning({ id: beds24Execucoes.id });
  let r: ResultadoSync;
  try {
    r = await db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '15s'`);
      // Mesma trava do envio de calendário e do envio de reservas do site: importação e envios nunca rodam ao mesmo tempo.
      // Um envio entre a escrita externa e o registro final (fase sem trava) também faz a importação esperar; a mensagem
      // diz qual (calendário ou reserva do site).
      if (!(await tentarTravaBeds24(tx, org))) return { ...resultado(), ok: false, situacao: "ocupada" as const, mensagem: "Já há uma sincronização, um envio de calendário ou um envio de reserva do site em andamento. Aguarde e atualize a página.", causa: CAUSA_EM_ANDAMENTO.trava };
      const emAndamento = await escritaBeds24EmAndamento(tx, org, { agora });
      if (emAndamento) return { ...resultado(), ok: false, situacao: "ocupada" as const, mensagem: emAndamento === "reserva" ? MENSAGEM_RESERVA_EM_ANDAMENTO_EQUIPE : MENSAGEM_ENVIO_EM_ANDAMENTO, causa: CAUSA_EM_ANDAMENTO[emAndamento] };
      const c = await lerConfigBeds24(tx, org);
      if (o.automatica && !c.automatica) return { ...resultado(), situacao: "desligada" as const, mensagem: "Sincronização automática desligada no painel." };
      // Já com a trava (e sem envio em andamento): a reserva do site com o POST tentado e sem resposta há mais de 6 min fica
      // incerta (M8.3, desenho 3.6), e a importação nunca cria por cima dela (desvio "e", abaixo).
      await passarEnviandoVencidasAIncerta(tx, org);
      const mapas = (await listarMapeamentosBeds24(tx, org)).filter(m => m.ativo);
      if (!mapas.length) throw new ErroBeds24("Vincule pelo menos um quarto do Beds24 a um imóvel ativo do SCL antes de importar.", "configuracao");
      if (mapas.some(m => !/^\d+$/.test(m.propertyId) || !/^\d+$/.test(m.roomId))) throw new ErroBeds24("Confira os vínculos: informe propertyId e roomId numéricos para cada imóvel. Vínculo sem quarto não é usado na importação.", "configuracao");
      if (new Set(mapas.map(m => m.imovelId)).size !== mapas.length || new Set(mapas.map(m => m.roomId)).size !== mapas.length) throw new ErroBeds24("Cada imóvel deve estar ligado a um único quarto Beds24. Remova os vínculos duplicados na ficha do imóvel.", "configuracao");
      const quartos = await leitor.quartos();
      for (const m of mapas) {
        const acesso = quartoAcessivelEmBrl(quartos.itens, m.propertyId, m.roomId);
        if (acesso === "inacessivel") throw new ErroBeds24(`O quarto vinculado ao imóvel ${m.codigo} não está acessível. Confira seu mapeamento e as permissões.`, "configuracao");
        if (acesso === "moeda") throw new ErroBeds24(`A moeda do imóvel ${m.codigo} precisa estar confirmada como BRL no Beds24 antes da importação financeira.`, "configuracao");
      }
      const res = resultado();
      // Com os info items (M8.3, desenho 5.4): é onde mora a marca do SCL nas reservas pagas do site e no ensaio.
      const lote = await leitor.reservas({ saidaDe: c.desde, propertyIds: [...new Set(mapas.map(m => m.propertyId))], incluirInfo: true });
      semIdsRepetidos(lote);
      const porId = new Map(lote.itens.map(b => [b.idExterno, b]));
      for (const d of lote.divergencias) aviso(res, `Reserva ${referencia(d.id)}: formato inválido; confira o registro no Beds24.`);
      // Ids que voltaram em formato inválido (aqui e na releitura): o registro existe, só não deu para ler. Nunca contam
      // como "não voltou" (apagado): avisar em vez de supor.
      const ilegiveis = new Set(lote.divergencias.map(d => d.id));

      // Reconsulta IDs já importados que saíram do filtro (mudança de datas, quarto
      // ou cancelamento). Ausência nunca cancela reserva nem libera um bloqueio.
      const antigas = await tx.select({ idFonte: reservas.idFonte, beds24Id: reservas.beds24Id }).from(reservas)
        .where(and(eq(reservas.organizacaoId, org), or(eq(reservas.fonte, "beds24"), sql`${reservas.beds24Id} is not null`)));
      const antigosBloqueios = await tx.select({ idFonte: bloqueios.idFonte }).from(bloqueios).where(and(eq(bloqueios.organizacaoId, org), eq(bloqueios.fonte, "beds24")));
      const conhecidos = [...new Set([...antigas.map(a => a.beds24Id || a.idFonte), ...antigosBloqueios.map(a => a.idFonte)])];
      if (conhecidos.length > 2000 || lote.itens.length > 2000) throw new ErroBeds24("Consulta acima de 2.000 reservas: é necessário ampliar o processamento antes de importar este volume.", "formato");
      const faltantes = conhecidos.filter(id => !porId.has(id));
      // Registro de um id fora do pedido do lote, legível ou não, ou sem id legível: a resposta não é a do pedido, e ele pode
      // ser de qualquer id pedido, inclusive de outro lote. Um id que já voltou legível na leitura do período não é pedido de
      // novo: se ele volta na releitura, é o mesmo id duas vezes (a importação para, como numa leitura só).
      const vistosNaReleitura = new Set<string>(porId.keys());
      const releitura = await relerPorIds(leitor, faltantes, vistosNaReleitura);
      for (const b of releitura.legiveis) porId.set(b.idExterno, b);
      for (const id of releitura.ilegiveis) {
        if (ilegiveis.has(id)) continue;
        ilegiveis.add(id);
        aviso(res, `Reserva ${referencia(id)}: formato inválido; confira o registro no Beds24.`);
      }
      const semDono = releitura.semDono;
      // Com qualquer registro sem dono, em qualquer lote, a releitura toda fica sem conclusão: nenhum id que não voltou conta
      // como "não voltou" (apagado), com um aviso só.
      const semConclusao = new Set<string>();
      if (semDono) {
        for (const id of faltantes) if (!porId.has(id) && !ilegiveis.has(id)) semConclusao.add(id);
        aviso(res, `Releitura por id: ${semDono} registro(s) voltaram com um id que não foi pedido ou que não deu para ler; os registros que não voltaram legíveis ficam como estavam. Confira os registros no Beds24.`);
      }
      for (const id of faltantes) if (!porId.has(id) && !ilegiveis.has(id) && !semConclusao.has(id)) aviso(res, `Reserva/bloqueio ${referencia(id)} não retornou na consulta. O registro anterior foi preservado.`);
      // O que cada id conhecido é no SCL (a reserva vale sobre o bloqueio com o mesmo id): o desvio deixa o registro conhecido
      // com a marca seguir o caminho normal (5.2 c e d).
      const tipoConhecido = new Map<string, RegistroConhecido>([...antigosBloqueios.map(a => [a.idFonte, "bloqueio"] as const), ...antigas.map(a => [a.beds24Id || a.idFonte, "reserva"] as const)]);
      // Reserva paga do site (M8.3, desenho 5.2): o que o desvio consulta, lido uma vez. O id dela que não voltou numa releitura
      // limpa é conferido como apagado no Beds24 (a reserva do SCL continua como estava). O que voltou ilegível, em qualquer
      // leitura desta importação (mesmo que outra leitura o traga legível), e o que não voltou numa releitura sem conclusão
      // não são conferidos: nada muda no acompanhamento (situação, leitura e marcas das OTAs), só o aviso. Com qualquer
      // registro ilegível ou sem dono, a adoção também não conclui (pode ser outra cópia com a marca).
      const desvio = await prepararDesvioNaImportacao(tx, org, porId.values(), tipoConhecido, agora, { ilegiveis, leituraComIlegivel: ilegiveis.size > 0 || semDono > 0 });
      for (const id of faltantes) {
        const ligada = porId.has(id) ? undefined : desvio.ligadas.get(id);
        if (!ligada) continue;
        const a = ilegiveis.has(id) ? avisoDeRegistroIlegivel(ligada.codigo, id) : semConclusao.has(id) ? avisoDeReleituraSemConclusao(ligada.codigo, id) : avisoDaConferencia(await conferirNaImportacao(tx, org, ligada.id, null, agora), ligada.codigo, id);
        if (a) aviso(res, a);
      }
      const inicio = hojeISO("America/Sao_Paulo", agora);
      const fim = somarDias(inicio, c.diasCalendario);
      const calendario = await leitor.calendario({ roomIds: mapas.map(m => m.roomId), inicio, fim });
      for (const d of calendario.divergencias) aviso(res, `Calendário do quarto ${referencia(d.id)}: formato inválido; não usar como disponibilidade confirmada.`);

      for (const b of porId.values()) {
        if (Date.now() > limite) throw new ErroBeds24("A importação excedeu o tempo disponível e foi desfeita. Reduza o período ou solicite processamento em lotes.", "tempo");
        // Antes da conferência de vínculo e do ramo de bloqueio: a reserva do site (e o ensaio) nunca passa por
        // `sincronizarReserva`, mesmo com o vínculo do imóvel trocado depois da criação.
        const d = await desvioNaImportacao(tx, org, b, desvio);
        if (d.desviado) {
          if (d.aviso) aviso(res, d.aviso);
          continue;
        }
        const m = mapas.find(m => m.propertyId === b.propertyId && m.roomId === b.roomId);
        if (!m) { aviso(res, `Reserva ${referencia(b.idExterno)}: quarto sem vínculo ativo e exato no SCL. Nenhuma alteração aplicada a esse registro.`); continue; }
        await aplicarRegistro(tx, org, b, m.imovelId, res, o.autorId ?? null, exec.id);
      }

      // Substitui apenas a observação dos imóveis mapeados. Dias não retornados
      // ficam sem observação (desconhecidos), nunca viram "livres" por omissão. Antes de apagar, a leitura anterior de cada
      // imóvel fica numa cópia datada (M3.11a), nesta mesma transação; imóvel sem noites lidas não gera cópia.
      for (const m of mapas) await copiarLeitura(tx, org, m.imovelId, "antes_da_leitura", { autorId: o.autorId ?? null });
      await tx.delete(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, org), inArray(beds24Calendario.imovelId, mapas.map(m => m.imovelId))));
      const vistos = new Set<string>();
      const valores: typeof beds24Calendario.$inferInsert[] = [];
      for (const d of calendario.itens) {
        const m = mapas.find(m => m.roomId === d.roomId);
        if (!m || d.data < inicio || d.data >= fim) continue;
        const chave = `${m.imovelId}/${d.data}`;
        if (vistos.has(chave)) throw new ErroBeds24("Calendário com datas repetidas. Nenhuma mudança desta execução foi aplicada.", "formato");
        vistos.add(chave);
        valores.push({ organizacaoId: org, imovelId: m.imovelId, data: d.data, roomId: m.roomId, livres: d.livres, preco: d.preco, minimoNoites: d.minimoNoites, maximoNoites: d.maximoNoites, bloqueio: d.bloqueio, observadoEm: agora });
      }
      for (const m of mapas) if (valores.filter(v => v.imovelId === m.imovelId).length < c.diasCalendario) aviso(res, `Imóvel ${m.codigo}: há dias sem observação de calendário; disponibilidade e preço desses dias seguem desconhecidos.`);
      for (let i = 0; i < valores.length; i += 250) await tx.insert(beds24Calendario).values(valores.slice(i, i + 250));
      res.diasCalendario = valores.length;
      res.situacao = res.totalDivergencias ? "parcial" : "ok";
      res.mensagem = `${res.criadas} registro(s) adicionado(s) ao SCL, ${res.atualizadas} atualizada(s), ${res.iguais} sem alteração, ${res.bloqueios} bloqueio(s), ${res.diasCalendario} dia(s) de calendário; ${res.totalDivergencias} aviso(s) para conferir.`;
      await registrarAuditoria(tx, { organizacaoId: org, usuarioId: o.autorId ?? null, acao: "beds24.sincronizar", entidade: "integracao", entidadeId: org, mudancas: { resultado: [null, res.mensagem] } });
      return res;
    });
  } catch (e) {
    r = { ...resultado(), ok: false, situacao: "erro", mensagem: mensagemSeguraBeds24(e), falha: falhaBeds24(e) };
  }
  await db.update(beds24Execucoes).set({ terminadoEm: new Date(), situacao: r.situacao, resumo: r.mensagem.slice(0, 1000), divergencias: r.divergencias }).where(eq(beds24Execucoes.id, exec.id));
  return r;
}

async function aplicarRegistro(tx: Db, org: string, b: ReservaBeds24, imovelId: string, r: ResultadoSync, autorId: string | null, execucaoId: string) {
  const ondeBloqueio = and(eq(bloqueios.organizacaoId, org), eq(bloqueios.fonte, "beds24"), eq(bloqueios.idFonte, b.idExterno));
  const [bl] = await tx.select().from(bloqueios).where(ondeBloqueio);
  if (b.estado === "bloqueio") {
    // Bloqueio ocupa noites: a mesma trava do imóvel que a confirmação do pagamento do site toma antes de conferir
    // as noites (reservas/repositorio.ts, pagamentos/travas.ts), sempre antes da reserva.
    await tx.select({ id: imoveis.id }).from(imoveis).where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, org))).for("no key update");
    const [antiga] = await tx.select().from(reservas).where(and(eq(reservas.organizacaoId, org), or(eq(reservas.beds24Id, b.idExterno), and(eq(reservas.fonte, "beds24"), eq(reservas.idFonte, b.idExterno)))));
    if (antiga) {
      const s = await sincronizarReserva(tx, org, "beds24", b.idExterno, { ...antiga, estado: "cancelada" }, autorId);
      if (!s.ok) { aviso(r, `Registro ${referencia(b.idExterno)}: não foi possível converter a reserva em bloqueio.`); return; }
      if (s.alterada) await tx.insert(beds24ExecucaoReservas).values({ organizacaoId: org, execucaoId, reservaId: s.reserva.id, tipo: s.canceladaAgora ? "cancelada" : "alterada" });
      if (s.financeiroNaoAtualizado) aviso(r, `Registro ${referencia(b.idExterno)}: financeiro protegido; confira o ajuste manual.`);
    }
    const dados = { imovelId, inicio: b.checkin, fim: b.checkout, motivo: "Bloqueio importado do Beds24" };
    if (bl) await tx.update(bloqueios).set(dados).where(ondeBloqueio);
    else await tx.insert(bloqueios).values({ ...dados, organizacaoId: org, fonte: "beds24", idFonte: b.idExterno });
    r.bloqueios++;
    return;
  }
  // Cancelamento de um bloqueio não deve criar uma reserva fictícia. A remoção fica no histórico, como as do
  // painel: a agenda consulta esse registro para não dar como livre um período que foi usado.
  if (bl && b.estado === "cancelada") {
    await tx.delete(bloqueios).where(ondeBloqueio);
    await registrarRemocaoDeBloqueio(tx, org, bl, autorId);
    return;
  }
  const s = await sincronizarReserva(tx, org, "beds24", b.idExterno, paraDadosReserva(b, imovelId)!, autorId);
  if (!s.ok) { aviso(r, `Reserva ${referencia(b.idExterno)}: ${Object.values(s.erros).join(" ")}`); return; }
  if (s.criada || s.alterada) await tx.insert(beds24ExecucaoReservas).values({ organizacaoId: org, execucaoId, reservaId: s.reserva.id, tipo: s.criada ? "adicionada" : s.canceladaAgora ? "cancelada" : "alterada" });
  if (bl) {
    await tx.delete(bloqueios).where(ondeBloqueio);
    await registrarRemocaoDeBloqueio(tx, org, bl, autorId);
  }
  if (s.criada) r.criadas++; else if (s.alterada) r.atualizadas++; else r.iguais++;
  for (const a of s.avisosFinanceiro ?? []) aviso(r, `Reserva ${referencia(b.idExterno)}: ${a}`);
}

export function ultimasSincronizacoes(db: Db, org: string) {
  return db.select().from(beds24Execucoes).where(eq(beds24Execucoes.organizacaoId, org)).orderBy(desc(beds24Execucoes.iniciadoEm)).limit(10);
}
