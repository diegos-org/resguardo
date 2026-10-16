import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { beds24Calendario, beds24Execucoes, beds24ExecucaoReservas, bloqueios, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { registrarRemocaoDeBloqueio } from "@/reservas/bloqueios";
import { sincronizarReserva } from "@/reservas/repositorio";
import { lerConfigBeds24, listarMapeamentosBeds24 } from "./configuracao";
import { paraDadosReserva } from "./converter";
import { avisoDaConferencia, conferirNaImportacao, desvioNaImportacao, passarEnviandoVencidasAIncerta, prepararDesvioNaImportacao } from "./reservas-site";
import { ErroBeds24, type LeitorBeds24, type ReservaBeds24 } from "./tipos";
import { CAUSA_EM_ANDAMENTO, escritaBeds24EmAndamento, MENSAGEM_ENVIO_EM_ANDAMENTO, MENSAGEM_RESERVA_EM_ANDAMENTO_EQUIPE, tentarTravaBeds24 } from "./trava";

export type ResultadoSync = {
  ok: boolean; situacao: "ok" | "parcial" | "erro" | "ocupada" | "desligada";
  criadas: number; atualizadas: number; iguais: number; bloqueios: number; diasCalendario: number;
  totalDivergencias: number; divergencias: string[]; mensagem: string;
  /** Só na "ocupada": a causa em poucas palavras (a rotina diária registra "não rodou: <causa>"). */
  causa?: string;
};
const resultado = (): ResultadoSync => ({ ok: true, situacao: "ok", criadas: 0, atualizadas: 0, iguais: 0, bloqueios: 0, diasCalendario: 0, totalDivergencias: 0, divergencias: [], mensagem: "" });
const referencia = (s: string) => /^[A-Za-z0-9._:-]{1,64}$/.test(s) ? s : "não identificado";
const somarDias = (data: string, n: number) => new Date(Date.parse(`${data}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const aviso = (r: ResultadoSync, s: string) => { r.totalDivergencias++; if (r.divergencias.length < 100) r.divergencias.push(s.slice(0, 300)); };

export function mensagemSeguraBeds24(e: unknown): string {
  return e instanceof ErroBeds24 ? e.message : "Não foi possível confirmar o resultado. Confira o histórico de importações antes de tentar novamente.";
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
        const q = quartos.itens.find(q => q.propertyId === m.propertyId && q.roomId === m.roomId);
        if (!q) throw new ErroBeds24(`O quarto vinculado ao imóvel ${m.codigo} não está acessível. Confira seu mapeamento e as permissões.`, "configuracao");
        if (q.moeda !== "BRL") throw new ErroBeds24(`A moeda do imóvel ${m.codigo} precisa estar confirmada como BRL no Beds24 antes da importação financeira.`, "configuracao");
      }
      const res = resultado();
      // Com os info items (M8.3, desenho 5.4): é onde mora a marca do SCL nas reservas pagas do site e no ensaio.
      const lote = await leitor.reservas({ saidaDe: c.desde, propertyIds: [...new Set(mapas.map(m => m.propertyId))], incluirInfo: true });
      const porId = new Map(lote.itens.map(b => [b.idExterno, b]));
      if (porId.size !== lote.itens.length) throw new ErroBeds24("Consulta com IDs de reserva repetidos. Confira a origem antes de importar; nenhuma mudança foi aplicada.", "formato");
      for (const d of lote.divergencias) aviso(res, `Reserva ${referencia(d.id)}: formato inválido; confira o registro no Beds24.`);

      // Reconsulta IDs já importados que saíram do filtro (mudança de datas, quarto
      // ou cancelamento). Ausência nunca cancela reserva nem libera um bloqueio.
      const antigas = await tx.select({ idFonte: reservas.idFonte, beds24Id: reservas.beds24Id }).from(reservas)
        .where(and(eq(reservas.organizacaoId, org), or(eq(reservas.fonte, "beds24"), sql`${reservas.beds24Id} is not null`)));
      const antigosBloqueios = await tx.select({ idFonte: bloqueios.idFonte }).from(bloqueios).where(and(eq(bloqueios.organizacaoId, org), eq(bloqueios.fonte, "beds24")));
      const conhecidos = [...new Set([...antigas.map(a => a.beds24Id || a.idFonte), ...antigosBloqueios.map(a => a.idFonte)])];
      if (conhecidos.length > 2000 || lote.itens.length > 2000) throw new ErroBeds24("Consulta acima de 2.000 reservas: é necessário ampliar o processamento antes de importar este volume.", "formato");
      const faltantes = conhecidos.filter(id => !porId.has(id));
      for (let i = 0; i < faltantes.length; i += 50) {
        const ids = faltantes.slice(i, i + 50);
        const l = await leitor.reservas({ ids, chegadaDe: "1900-01-01", incluirInfo: true });
        for (const b of l.itens) if (ids.includes(b.idExterno)) porId.set(b.idExterno, b);
        for (const id of ids) if (!porId.has(id)) aviso(res, `Reserva/bloqueio ${referencia(id)} não retornou na consulta. O registro anterior foi preservado.`);
      }
      // Reserva paga do site (M8.3, desenho 5.2): o que o desvio consulta, lido uma vez. O id dela que não voltou na releitura
      // é conferido como apagado no Beds24 (a reserva do SCL continua como estava).
      const desvio = await prepararDesvioNaImportacao(tx, org, porId.values(), new Set(conhecidos), agora);
      for (const id of faltantes) {
        const ligada = porId.has(id) ? undefined : desvio.ligadas.get(id);
        const a = ligada ? avisoDaConferencia(await conferirNaImportacao(tx, org, ligada.id, null, agora), ligada.codigo, id) : null;
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
      // ficam sem observação (desconhecidos), nunca viram "livres" por omissão.
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
    r = { ...resultado(), ok: false, situacao: "erro", mensagem: mensagemSeguraBeds24(e) };
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
