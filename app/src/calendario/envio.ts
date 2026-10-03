/**
 * Envio controlado de calendário e preços ao Beds24 (M3.7). Uma execução por organização:
 * planeja cada imóvel com envio ligado (motor puro), manda só as noites diferentes, relê o
 * destino e registra antes/depois por noite. Todo envio parte de uma leitura atual do Beds24:
 * sem ela nada é escrito. Sem escritor (BEDS24_ESCRITA desligada) só simula. Nunca cria,
 * altera ou cancela reservas; nunca reabre bloqueio que o SCL não fez.
 */
import { and, asc, count, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { listarMapeamentosBeds24 } from "@/beds24/configuracao";
import { mensagemSeguraBeds24 } from "@/beds24/sincronizacao";
import { chaveTravaBeds24, envioEmAndamento, tentarTravaBeds24 } from "@/beds24/trava";
import { type DiaCalendario, type Divergencia, ErroBeds24, type EscritorBeds24, type LeitorBeds24 } from "@/beds24/tipos";
import { beds24Calendario, beds24CalendarioEnviado, beds24EnvioNoites, beds24Envios, bloqueios, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { lerDetalhes, listarPeriodos, regrasDeVenda } from "@/imoveis/detalhes";
import { somarDias } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";
import { faixasDeEnvio, type LinhaPlano, planejarCalendario, resumirPlano, type ResumoPlano } from "./motor";
import { lerRegrasCalendario, type RegrasCalendario } from "./regras-config";

export type ModoEnvio = "simulacao" | "envio";
export type SituacaoEnvio = "ok" | "parcial" | "erro" | "ocupada" | "desligada" | "simulacao" | "incerto";
export type ImovelEnviado = { imovelId: string; codigo: string; resumo: ResumoPlano; enviadas: number; confirmadas: number; divergentes: number; pendentes: number; falha: string };
export type ResultadoEnvio = { ok: boolean; situacao: SituacaoEnvio; mensagem: string; envioId: string | null; imoveis: ImovelEnviado[]; avisos: string[]; totalAvisos: number };
export type OpcoesEnvio = { modo: ModoEnvio; imovelIds?: string[]; autorId?: string | null; automatica?: boolean; agora?: Date };

const NOMES_SITUACAO: Record<SituacaoEnvio, string> = {
  ok: "Enviado e conferido", parcial: "Enviado com divergências ou falhas", erro: "Falhou", ocupada: "Outra execução em andamento",
  desligada: "Envio desligado", simulacao: "Simulação (nada enviado)", incerto: "Enviado, sem confirmação da releitura",
};
export const nomeSituacaoEnvio = (s: string) => NOMES_SITUACAO[s as SituacaoEnvio] ?? s;

type Plano = { imovelId: string; codigo: string; propertyId: string; roomId: string; linhas: LinhaPlano[] };

/** Quarto Beds24 vinculado ao imóvel (vínculo ativo com propriedade e quarto numéricos), ou null. */
async function quartoVinculado(db: Db, org: string, imovelId: string): Promise<string | null> {
  const m = (await listarMapeamentosBeds24(db, org)).find(m => m.imovelId === imovelId && m.ativo && /^\d+$/.test(m.propertyId) && /^\d+$/.test(m.roomId));
  return m?.roomId ?? null;
}

/**
 * Planeja um imóvel a partir do banco (cadastro, períodos, ocupação, observações e último envio).
 * O estado enviado vale só para o quarto Beds24 vinculado agora (`roomId`; sem informar, é lido do vínculo):
 * o que foi enviado a outro quarto não dá posse de bloqueio neste.
 */
export async function planejarImovel(db: Db, org: string, regras: RegrasCalendario, imovel: { id: string; fuso: string; roomId?: string | null }, agora: Date, intervalo?: { inicio: string; fim: string }) {
  const hoje = hojeISO(imovel.fuso, agora);
  const roomId = imovel.roomId !== undefined ? imovel.roomId : await quartoVinculado(db, org, imovel.id);
  const inicio = intervalo?.inicio && intervalo.inicio > hoje ? intervalo.inicio : hoje;
  const fim = intervalo?.fim ?? somarDias(hoje, regras.horizonteDias - 1);
  const [detalhes, periodos] = await Promise.all([lerDetalhes(db, org, imovel.id), listarPeriodos(db, org, imovel.id)]);
  const regrasVenda = regrasDeVenda(detalhes);
  // Ocupação carregada até onde o maior mínimo aplicável alcança (mínimo 60 dias): uma reserva distante
  // ainda encurta as sobras; sem isso uma noite sairia com o mínimo cheio apesar de a janela livre ser menor.
  const maiorMinimo = Math.max(...regras.minimoPorDia, regrasVenda.estadiaMinima ?? 0, regras.janelaFeriado.estadiaMinima, ...regras.eventos.map(e => e.estadiaMinima ?? 0), ...periodos.map(x => x.estadiaMinima ?? 0));
  const fimDados = somarDias(fim, Math.min(400, Math.max(60, maiorMinimo)));
  const [ocupantes, impedimentos, observacoes, enviados] = await Promise.all([
    db.select({ checkin: reservas.checkin, checkout: reservas.checkout, estado: reservas.estado }).from(reservas).where(and(eq(reservas.organizacaoId, org), eq(reservas.imovelId, imovel.id), lt(reservas.checkin, somarDias(fimDados, 1)), gt(reservas.checkout, inicio))),
    db.select({ inicio: bloqueios.inicio, fim: bloqueios.fim, fonte: bloqueios.fonte }).from(bloqueios).where(and(eq(bloqueios.organizacaoId, org), eq(bloqueios.imovelId, imovel.id), lt(bloqueios.inicio, somarDias(fimDados, 1)), gt(bloqueios.fim, inicio))),
    db.select().from(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, org), eq(beds24Calendario.imovelId, imovel.id), gte(beds24Calendario.data, inicio), lte(beds24Calendario.data, fim))).orderBy(asc(beds24Calendario.data)),
    roomId === null ? [] : db.select().from(beds24CalendarioEnviado).where(and(eq(beds24CalendarioEnviado.organizacaoId, org), eq(beds24CalendarioEnviado.imovelId, imovel.id), eq(beds24CalendarioEnviado.roomId, roomId), gte(beds24CalendarioEnviado.data, inicio), lte(beds24CalendarioEnviado.data, fim))),
  ]);
  const linhas = planejarCalendario({
    imovel: { id: imovel.id, regras: regrasVenda, periodos, pisos: [detalhes.pisoUltimaHora1, detalhes.pisoUltimaHora2] },
    regras, hoje, inicio, fim, fimDados, reservas: ocupantes, bloqueios: impedimentos, observacoes, enviados,
  });
  return { hoje, inicio, fim, linhas, regras: regrasVenda, pisos: [detalhes.pisoUltimaHora1, detalhes.pisoUltimaHora2] as const };
}

/** Grava a leitura do calendário como observação local das noites (a mais nova vale). */
async function gravarObservacoes(tx: Db, org: string, imovelId: string, dias: Iterable<DiaCalendario>, observadoEm: Date) {
  for (const d of dias) {
    await tx.insert(beds24Calendario).values({ organizacaoId: org, imovelId, data: d.data, livres: d.livres, preco: d.preco, minimoNoites: d.minimoNoites, maximoNoites: d.maximoNoites, bloqueio: d.bloqueio, observadoEm })
      .onConflictDoUpdate({ target: [beds24Calendario.organizacaoId, beds24Calendario.imovelId, beds24Calendario.data], set: { livres: d.livres, preco: d.preco, minimoNoites: d.minimoNoites, maximoNoites: d.maximoNoites, bloqueio: d.bloqueio, observadoEm } });
  }
}

/**
 * Quartos cuja leitura não pode ser aproveitada. Uma divergência atribuída a um quarto pedido invalida só
 * esse quarto; uma divergência sem quarto identificável (registro malformado, id fora do pedido) não tem
 * dono, então invalida todos os quartos do pedido: a resposta inteira é ambígua.
 */
function quartosInvalidos(divergencias: Divergencia[], roomIdsPedidos: string[]): { quartos: Set<string>; semDono: boolean } {
  const pedidos = new Set(roomIdsPedidos);
  const semDono = divergencias.some(d => !pedidos.has(d.id));
  return { quartos: new Set(semDono ? roomIdsPedidos : divergencias.map(d => d.id)), semDono };
}

const igualAoLido = (l: LinhaPlano, d: DiaCalendario | undefined) => d !== undefined
  && (l.precoEnviar === null || d.preco === l.precoEnviar) && (l.minimoEnviar === null || d.minimoNoites === l.minimoEnviar) && d.maximoNoites === l.maximoEnviar
  && (l.bloqueioEnviar === undefined || (d.bloqueio ?? "none") === l.bloqueioEnviar);

/**
 * Concilia, por imóvel, as noites de envios anteriores que ficaram sem releitura ("enviado") com a
 * observação mais nova que o envio: igual ao enviado → confirmada (e a posse do bloqueio enviado passa
 * a valer); diferente → divergente, sem posse. Sem observação nova, a noite continua pendente.
 * Não roda quando a leitura atual falhou: a observação guardada pode ser anterior à escrita.
 */
async function conciliarPendentes(tx: Db, org: string, imovelId: string, roomId: string): Promise<{ confirmadas: number; divergentes: number }> {
  const r = { confirmadas: 0, divergentes: 0 };
  const pendentes = await tx.select({ data: beds24CalendarioEnviado.data, enviadoEm: beds24CalendarioEnviado.enviadoEm, envioId: beds24CalendarioEnviado.envioId, bloqueio: beds24CalendarioEnviado.bloqueio, bloqueioAnterior: beds24CalendarioEnviado.bloqueioAnterior })
    .from(beds24CalendarioEnviado).where(and(eq(beds24CalendarioEnviado.organizacaoId, org), eq(beds24CalendarioEnviado.imovelId, imovelId), eq(beds24CalendarioEnviado.roomId, roomId), eq(beds24CalendarioEnviado.confirmado, false), isNotNull(beds24CalendarioEnviado.envioId)));
  if (!pendentes.length) return r;
  const datas = pendentes.map(e => e.data);
  const registros = await tx.select({ envioId: beds24EnvioNoites.envioId, data: beds24EnvioNoites.data, preco: beds24EnvioNoites.precoEnviado, minimo: beds24EnvioNoites.minimoEnviado, maximo: beds24EnvioNoites.maximoEnviado, bloqueio: beds24EnvioNoites.bloqueioEnviado })
    .from(beds24EnvioNoites).where(and(eq(beds24EnvioNoites.organizacaoId, org), eq(beds24EnvioNoites.imovelId, imovelId), inArray(beds24EnvioNoites.envioId, [...new Set(pendentes.map(e => e.envioId!))]), inArray(beds24EnvioNoites.data, datas), eq(beds24EnvioNoites.resultado, "enviado")));
  const porChave = new Map(registros.map(n => [`${n.envioId}/${n.data}`, n]));
  const observacoes = new Map((await tx.select().from(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, org), eq(beds24Calendario.imovelId, imovelId), inArray(beds24Calendario.data, datas)))).map(o => [o.data, o]));
  for (const e of pendentes) {
    const n = porChave.get(`${e.envioId}/${e.data}`);
    const o = observacoes.get(e.data);
    // Só uma observação estritamente posterior ao envio decide; a leitura feita antes da escrita não conta.
    if (!n || !o || o.observadoEm.getTime() <= e.enviadoEm.getTime()) continue;
    // O bloqueio é conferido pelo próprio campo: a posse vale mesmo que preço, mínimo ou máximo tenham divergido.
    const bloqueioConfirmado = n.bloqueio !== null && (o.bloqueio ?? "none") === n.bloqueio;
    const igual = (n.preco === null || o.preco === n.preco) && (n.minimo === null || o.minimoNoites === n.minimo) && (n.maximo === null || o.maximoNoites === n.maximo) && (n.bloqueio === null || bloqueioConfirmado);
    const onde = and(eq(beds24CalendarioEnviado.organizacaoId, org), eq(beds24CalendarioEnviado.imovelId, imovelId), eq(beds24CalendarioEnviado.data, e.data));
    const ondeNoite = and(eq(beds24EnvioNoites.envioId, e.envioId!), eq(beds24EnvioNoites.imovelId, imovelId), eq(beds24EnvioNoites.data, e.data));
    if (igual) {
      await tx.update(beds24CalendarioEnviado).set({ confirmado: true, bloqueio: n.bloqueio ?? e.bloqueio, bloqueioAnterior: n.bloqueio === "blackout" ? e.bloqueioAnterior : n.bloqueio !== null ? null : e.bloqueioAnterior }).where(onde);
      await tx.update(beds24EnvioNoites).set({ resultado: "confirmado", detalhe: "Confirmado pela leitura de uma execução seguinte." }).where(ondeNoite);
      r.confirmadas++;
    } else {
      await tx.update(beds24CalendarioEnviado).set({
        bloqueio: bloqueioConfirmado ? n.bloqueio : e.bloqueio,
        bloqueioAnterior: bloqueioConfirmado ? (n.bloqueio === "blackout" ? e.bloqueioAnterior : null) : (e.bloqueio === "blackout" ? e.bloqueioAnterior : null),
      }).where(onde);
      await tx.update(beds24EnvioNoites).set({ resultado: "divergente", detalhe: `Leitura seguinte: preço ${o.preco ?? "—"}, mín. ${o.minimoNoites ?? "—"}, máx. ${o.maximoNoites ?? "—"}, bloqueio ${o.bloqueio ?? "—"}`.slice(0, 300) }).where(ondeNoite);
      r.divergentes++;
    }
  }
  return r;
}


type Fase1 = { pronto: ResultadoEnvio } | {
  planos: Plano[]; tentados: Plano[]; resultadoImoveis: ImovelEnviado[]; motivosSemEscrita: Map<string, string>; leituraIncompleta: Set<string>;
  inicioLeitura: string; fimLeitura: string;
};

/**
 * Três fases: (1) transação com conferências, leitura atual do destino, plano, confirmações tardias
 * e — no envio real — a intenção durável do que vai ser escrito; (2) a escrita externa, fora de
 * transação; (3) transação com a releitura e o registro final. Se o banco falhar depois da escrita,
 * a intenção gravada na fase 1 permite à execução seguinte assumir a posse pela leitura.
 */
export async function enviarCalendarioBeds24(db: Db, org: string, leitor: LeitorBeds24, escritor: EscritorBeds24 | null, o: OpcoesEnvio): Promise<ResultadoEnvio> {
  const agora = o.agora ?? new Date();
  const base = (situacao: SituacaoEnvio, mensagem: string): ResultadoEnvio => ({ ok: situacao === "ok" || situacao === "simulacao", situacao, mensagem, envioId: null, imoveis: [], avisos: [], totalAvisos: 0 });
  if (o.modo === "envio" && !escritor) return base("desligada", "Envio desligado: BEDS24_ESCRITA não está \"ligada\" na Vercel (só o Diego liga, depois do teste). Use a simulação.");
  // Registro da execução fora das transações: sobrevive a qualquer falha e marca "em andamento".
  const [exec] = await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: agora, modo: o.modo, automatica: o.automatica === true, situacao: "iniciando" }).returning({ id: beds24Envios.id });
  const avisos: string[] = [];
  let totalAvisos = 0;
  const aviso = (s: string) => { totalAvisos++; if (avisos.length < 100) avisos.push(s.slice(0, 300)); };
  const dataBr = (d: string) => d.split("-").reverse().join("/");
  const ocupada = () => ({ pronto: { ...base("ocupada", "Já há um envio ou uma importação do Beds24 em andamento. Aguarde e atualize a página."), ok: false } });
  // Instantes distintos dentro da execução: leitura inicial (agora) < envio (agora+1) < releitura (agora+2).
  // Assim a leitura feita antes da escrita nunca passa por leitura posterior ao envio.
  const instanteEnvio = new Date(agora.getTime() + 1);
  const instanteReleitura = new Date(agora.getTime() + 2);
  let leituraAtualFalhou = false;
  let r: ResultadoEnvio;
  try {
    const fase1 = await db.transaction(async (tx): Promise<Fase1> => {
      await tx.execute(sql`set local lock_timeout = '15s'`);
      // Mesma trava da importação: importação e envio nunca rodam ao mesmo tempo sobre o calendário local.
      if (!(await tentarTravaBeds24(tx, org))) return ocupada();
      // Outra execução entre a escrita externa e o registro final (ou interrompida há pouco) também bloqueia.
      if (await envioEmAndamento(tx, org, agora, exec.id)) return ocupada();
      await tx.update(beds24Envios).set({ situacao: "executando" }).where(eq(beds24Envios.id, exec.id));

      const regras = await lerRegrasCalendario(tx, org);
      const mapas = (await listarMapeamentosBeds24(tx, org)).filter(m => m.ativo && /^\d+$/.test(m.propertyId) && /^\d+$/.test(m.roomId));
      const pedidos = o.imovelIds ? [...new Set(o.imovelIds)] : null;
      if (pedidos?.some(id => !regras.envio.imoveis.includes(id))) throw new ErroBeds24("Este imóvel não está com envio ligado em Configurações → Calendário e preços.", "configuracao");
      const escolhidos = mapas.filter(m => regras.envio.imoveis.includes(m.imovelId) && (!pedidos || pedidos.includes(m.imovelId)));
      if (pedidos?.some(id => !escolhidos.some(m => m.imovelId === id))) throw new ErroBeds24("Imóvel sem vínculo Beds24 ativo (propriedade e quarto numéricos). Confira em Integrações.", "configuracao");
      if (!escolhidos.length) throw new ErroBeds24("Nenhum imóvel com envio ligado e vínculo Beds24 ativo. Ligue o envio por imóvel em Configurações → Calendário e preços.", "configuracao");
      if (new Set(escolhidos.map(m => m.imovelId)).size !== escolhidos.length || new Set(escolhidos.map(m => m.roomId)).size !== escolhidos.length) throw new ErroBeds24("Cada imóvel deve estar ligado a um único quarto Beds24. Remova os vínculos duplicados antes de enviar.", "configuracao");
      const fusos = new Map((await tx.select({ id: imoveis.id, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.organizacaoId, org), inArray(imoveis.id, escolhidos.map(m => m.imovelId))))).map(i => [i.id, i.fuso]));

      // Estado enviado de outro quarto (vínculo trocado) não vale para o quarto atual: a posse de um bloqueio
      // não passa de um quarto para outro. No envio real esse estado é descartado; o histórico por execução fica.
      for (const m of escolhidos) {
        const deOutroQuarto = and(eq(beds24CalendarioEnviado.organizacaoId, org), eq(beds24CalendarioEnviado.imovelId, m.imovelId), or(isNull(beds24CalendarioEnviado.roomId), ne(beds24CalendarioEnviado.roomId, m.roomId)));
        const [{ n }] = await tx.select({ n: count() }).from(beds24CalendarioEnviado).where(deOutroQuarto);
        if (!n) continue;
        aviso(`Imóvel ${m.codigo}: ${n} noite(s) com estado de envio de outro quarto Beds24 (vínculo anterior) ${o.modo === "envio" ? "foram descartadas" : "serão descartadas no envio"}; a posse de bloqueios não passa para o quarto ${m.roomId}. Se o SCL tinha fechado noites no quarto antigo, reabra-as manualmente no Beds24.`);
        if (o.modo === "envio") await tx.delete(beds24CalendarioEnviado).where(deOutroQuarto);
      }

      // Como na importação: a credencial atual precisa enxergar exatamente o par propriedade/quarto
      // de cada imóvel, em BRL. Um vínculo digitado errado nunca recebe preços de outro imóvel.
      const quartos = await leitor.quartos();
      const motivosSemEscrita = new Map<string, string>();
      for (const m of escolhidos) {
        const q = quartos.itens.find(q => q.propertyId === m.propertyId && q.roomId === m.roomId);
        if (!q) motivosSemEscrita.set(m.imovelId, `O quarto vinculado ao imóvel ${m.codigo} (propriedade ${m.propertyId}, quarto ${m.roomId}) não está acessível nesta credencial. Confira o vínculo em Integrações antes de enviar.`);
        else if (q.moeda !== "BRL") motivosSemEscrita.set(m.imovelId, `A moeda do imóvel ${m.codigo} precisa estar confirmada como BRL no Beds24 antes do envio de preços.`);
      }
      for (const [, motivo] of motivosSemEscrita) aviso(`${motivo} Nenhum valor é enviado para esse imóvel.`);

      // Leitura atual do destino antes de planejar: o plano (inclusive reabrir um blackout do SCL)
      // nunca se apoia só na última importação. Sem essa leitura, o envio real não escreve nada; um
      // imóvel cuja leitura não cobriu todo o horizonte (ou veio com dados inválidos) também fica de fora.
      const acessiveis = escolhidos.filter(m => !motivosSemEscrita.has(m.imovelId));
      const leituraIncompleta = new Set<string>();
      if (acessiveis.length) {
        const hojeDe = (m: { imovelId: string }) => hojeISO(fusos.get(m.imovelId) ?? "America/Sao_Paulo", agora);
        const hojes = acessiveis.map(hojeDe);
        const inicio = hojes.reduce((a, b) => (a < b ? a : b));
        const fim = somarDias(hojes.reduce((a, b) => (a > b ? a : b)), regras.horizonteDias - 1);
        try {
          const l = await leitor.calendario({ roomIds: acessiveis.map(m => m.roomId), inicio, fim: somarDias(fim, 1) });
          const invalidos = quartosInvalidos(l.divergencias, acessiveis.map(m => m.roomId));
          for (const d of l.divergencias) aviso(`Leitura do quarto ${d.id}: formato inválido; conferir manualmente.`);
          if (invalidos.semDono) aviso("A leitura do Beds24 trouxe registro inválido sem quarto identificável: a leitura de todos os quartos pedidos é tratada como inválida nesta execução.");
          for (const m of acessiveis) {
            const dias = l.itens.filter(d => d.roomId === m.roomId);
            // A leitura só é guardada e usada quando está íntegra para o imóvel: sem datas repetidas (faixas
            // sobrepostas), sem dados inválidos no quarto e cobrindo todo o horizonte. Como na importação, uma
            // leitura ambígua ou incompleta não substitui a última leitura confiável nem autoriza envio.
            const datas = new Set<string>();
            let repetidas = 0;
            for (const d of dias) { if (datas.has(d.data)) repetidas++; else datas.add(d.data); }
            let faltam = 0;
            for (let d = hojeDe(m), fimImovel = somarDias(d, regras.horizonteDias - 1); d <= fimImovel; d = somarDias(d, 1)) if (!datas.has(d)) faltam++;
            const problemas = [
              repetidas ? `${repetidas} data(s) repetida(s)` : "",
              invalidos.quartos.has(m.roomId) ? "dados inválidos" : "",
              faltam ? `${faltam} noite(s) do horizonte sem retorno` : "",
            ].filter(Boolean);
            if (problemas.length) {
              leituraIncompleta.add(m.imovelId);
              const motivo = `A leitura do Beds24 do imóvel ${m.codigo} ficou incompleta (${problemas.join(", ")}): a leitura não foi guardada e nada é enviado para esse imóvel nesta execução.`;
              motivosSemEscrita.set(m.imovelId, motivo);
              aviso(motivo);
              continue;
            }
            await gravarObservacoes(tx, org, m.imovelId, dias, agora);
          }
        } catch (e) {
          const motivo = mensagemSeguraBeds24(e);
          if (o.modo === "envio") throw new ErroBeds24(`Leitura do Beds24 antes do envio falhou: ${motivo} Nada foi enviado: o SCL só escreve a partir de uma leitura atual do destino.`, "rede");
          // A simulação espelha o envio real: sem leitura atual, nenhum imóvel seria enviado. O plano ainda é
          // mostrado pela última leitura guardada, mas cada imóvel fica marcado como fora do envio.
          leituraAtualFalhou = true;
          aviso(`Leitura do Beds24 falhou: ${motivo} A simulação usa a última leitura guardada.`);
          for (const m of acessiveis) motivosSemEscrita.set(m.imovelId, `Leitura do Beds24 falhou: ${motivo} Sem leitura atual, nada seria enviado para o imóvel ${m.codigo}.`);
        }
      }

      const planos: Plano[] = [];
      let inicioLeitura = "9999-12-31";
      let fimLeitura = "0000-01-01";
      for (const m of escolhidos) {
        // Tentativas anteriores sem releitura são conciliadas com a leitura de agora antes de planejar:
        // igual ao enviado vira confirmação (e a posse do bloqueio passa a valer); diferente vira divergência.
        // Assim um blackout gravado sem releitura tem dono mesmo que o bloqueio local já tenha sido
        // removido, e a reabertura sai nesta mesma execução.
        if (!leituraIncompleta.has(m.imovelId) && !leituraAtualFalhou) {
          const c = await conciliarPendentes(tx, org, m.imovelId, m.roomId);
          if (c.confirmadas) aviso(`Imóvel ${m.codigo}: ${c.confirmadas} noite(s) de envio anterior confirmada(s) pela leitura de agora.`);
          if (c.divergentes) aviso(`Imóvel ${m.codigo}: ${c.divergentes} noite(s) de envio anterior sem releitura diferem da leitura de agora; o plano decide se reenvia.`);
        }
        const p = await planejarImovel(tx, org, regras, { id: m.imovelId, fuso: fusos.get(m.imovelId) ?? "America/Sao_Paulo", roomId: m.roomId }, agora);
        planos.push({ imovelId: m.imovelId, codigo: m.codigo, propertyId: m.propertyId, roomId: m.roomId, linhas: p.linhas });
        if (p.inicio < inicioLeitura) inicioLeitura = p.inicio;
        if (p.fim > fimLeitura) fimLeitura = p.fim;
        const semPreco = p.linhas.filter(l => l.precoReferencia === null).length;
        if (semPreco) aviso(`Imóvel ${m.codigo}: ${semPreco} noite(s) sem preço no SCL; o preço dessas noites não é enviado.`);
        for (const l of p.linhas) for (const a of l.avisos) if (!a.startsWith("Sem leitura do Beds24")) aviso(`Imóvel ${m.codigo}, noite ${dataBr(l.data)}: ${a}`);
        const semLeitura = p.linhas.filter(l => !l.observacao).length;
        if (semLeitura) aviso(`Imóvel ${m.codigo}: ${semLeitura} noite(s) sem leitura anterior do Beds24; serão enviadas e conferidas pela releitura.`);
      }
      const resultadoImoveis: ImovelEnviado[] = planos.map(p => ({ imovelId: p.imovelId, codigo: p.codigo, resumo: resumirPlano(p.linhas), enviadas: 0, confirmadas: 0, divergentes: 0, pendentes: 0, falha: motivosSemEscrita.get(p.imovelId) ?? "" }));

      if (o.modo === "simulacao" || !escritor) {
        // A simulação espelha o envio real: imóvel que ficaria de fora (vínculo, moeda, leitura) não conta
        // como "seria enviado" e mantém o motivo.
        const foraDoEnvio = resultadoImoveis.filter(i => i.falha).length;
        const seriamEnviadas = resultadoImoveis.filter(i => !i.falha).reduce((s, i) => s + i.resumo.enviar, 0);
        const mensagem = `Simulação: ${seriamEnviadas} noite(s) seriam enviadas em ${planos.length - foraDoEnvio} imóvel(is); ${resultadoImoveis.reduce((s, i) => s + i.resumo.iguais, 0)} já iguais; ${foraDoEnvio ? `${foraDoEnvio} imóvel(is) ficariam de fora (ver avisos); ` : ""}${totalAvisos} aviso(s). Nada foi gravado no Beds24.`;
        return { pronto: { ok: true, situacao: "simulacao", mensagem, envioId: exec.id, imoveis: resultadoImoveis, avisos, totalAvisos } };
      }

      // Intenção durável antes da escrita externa: cada noite a enviar fica registrada como "enviado"
      // (ainda sem releitura) e o estado enviado passa a apontar para esta execução, sem mudar a posse.
      const tentados = planos.filter(p => !motivosSemEscrita.has(p.imovelId) && faixasDeEnvio(p.linhas).length);
      const intencao: typeof beds24EnvioNoites.$inferInsert[] = [];
      for (const p of tentados) {
        for (const l of p.linhas) {
          if (l.acao !== "enviar") continue;
          intencao.push({
            organizacaoId: org, envioId: exec.id, imovelId: p.imovelId, data: l.data,
            precoAntes: l.observacao?.preco ?? null, precoEnviado: l.precoEnviar, minimoAntes: l.observacao?.minimoNoites ?? null, minimoEnviado: l.minimoEnviar, maximoEnviado: l.maximoEnviar,
            bloqueioAntes: l.observacao?.bloqueio ?? null, bloqueioEnviado: l.bloqueioEnviar ?? null, regra: l.regra.slice(0, 300), resultado: "enviado", detalhe: "Escrita em andamento; releitura ainda não registrada.",
          });
          const v = {
            organizacaoId: org, imovelId: p.imovelId, data: l.data, roomId: p.roomId, preco: l.precoEnviar, minimo: l.minimoEnviar, maximo: l.maximoEnviar,
            bloqueio: l.enviado?.bloqueio ?? null, bloqueioAnterior: l.bloqueioEnviar === "blackout" ? l.bloqueioAnterior : (l.enviado?.bloqueioAnterior ?? null),
            enviadoEm: instanteEnvio, confirmado: false, envioId: exec.id,
          };
          await tx.insert(beds24CalendarioEnviado).values(v).onConflictDoUpdate({ target: [beds24CalendarioEnviado.organizacaoId, beds24CalendarioEnviado.imovelId, beds24CalendarioEnviado.data], set: { roomId: v.roomId, preco: v.preco, minimo: v.minimo, maximo: v.maximo, bloqueio: v.bloqueio, bloqueioAnterior: v.bloqueioAnterior, enviadoEm: v.enviadoEm, confirmado: v.confirmado, envioId: v.envioId } });
        }
      }
      for (let i = 0; i < intencao.length; i += 250) await tx.insert(beds24EnvioNoites).values(intencao.slice(i, i + 250));
      return { planos, tentados, resultadoImoveis, motivosSemEscrita, leituraIncompleta, inicioLeitura, fimLeitura };
    });

    if ("pronto" in fase1) r = fase1.pronto;
    else {
      const { planos, tentados, resultadoImoveis, leituraIncompleta, inicioLeitura, fimLeitura } = fase1;
      // Fase 2, fora de transação: um pedido por imóvel; falha de um não impede os outros. Todo quarto
      // em que houve tentativa é relido depois: uma recusa (ou queda de rede) não prova que nada mudou.
      for (const p of tentados) {
        const res = resultadoImoveis.find(i => i.imovelId === p.imovelId)!;
        // Conferência final do vínculo: mudar o vínculo Beds24 espera o envio (mesma trava), mas se mesmo assim
        // o par propriedade/quarto do imóvel não é mais exatamente o planejado, nada é escrito para ele.
        const vinculos = (await listarMapeamentosBeds24(db, org)).filter(m => m.imovelId === p.imovelId && m.ativo && /^\d+$/.test(m.propertyId) && /^\d+$/.test(m.roomId));
        if (vinculos.length !== 1 || vinculos[0].propertyId !== p.propertyId || vinculos[0].roomId !== p.roomId) {
          res.falha = "Vínculo Beds24 do imóvel alterado durante o envio: nada foi escrito para este imóvel nesta execução; o próximo envio replaneja.";
          aviso(`Imóvel ${p.codigo}: ${res.falha}`);
          continue;
        }
        // Conferência final dos bloqueios locais: criar/remover bloqueio espera o envio (mesma trava), mas se
        // mesmo assim um bloqueio mudou entre o plano e a escrita, nada é escrito para o imóvel nesta execução.
        const comBloqueio = p.linhas.filter(l => l.acao === "enviar" && l.bloqueioEnviar !== undefined);
        if (comBloqueio.length) {
          const locais = await db.select({ inicio: bloqueios.inicio, fim: bloqueios.fim }).from(bloqueios)
            .where(and(eq(bloqueios.organizacaoId, org), eq(bloqueios.imovelId, p.imovelId), ne(bloqueios.fonte, "beds24"), lt(bloqueios.inicio, somarDias(comBloqueio[comBloqueio.length - 1].data, 1)), gt(bloqueios.fim, comBloqueio[0].data)));
          const bloqueadaAgora = (d: string) => locais.some(b => b.inicio <= d && d < b.fim);
          if (comBloqueio.some(l => bloqueadaAgora(l.data) !== l.bloqueioScl)) {
            res.falha = "Bloqueio local alterado durante o envio: nada foi escrito para este imóvel nesta execução; o próximo envio replaneja.";
            aviso(`Imóvel ${p.codigo}: ${res.falha}`);
            continue;
          }
        }
        try {
          const [resposta] = await escritor!.escreverCalendario([{ roomId: p.roomId, faixas: faixasDeEnvio(p.linhas) }]);
          if (!resposta?.ok) res.falha = resposta?.erro || "Beds24 recusou a escrita.";
          else res.enviadas = p.linhas.filter(l => l.acao === "enviar").length;
        } catch (e) {
          res.falha = mensagemSeguraBeds24(e);
        }
        if (res.falha) aviso(`Imóvel ${p.codigo}: envio falhou — ${res.falha}. O quarto foi relido para registrar o que ficou gravado.`);
      }

      // Fase 3 (transação): releitura do destino, registro noite a noite e observação nova.
      r = await db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '15s'`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chaveTravaBeds24(org)}))`);
        let releituraFalhou = "";
        let lidos: DiaCalendario[] = [];
        let releituraInvalida = new Set<string>();
        if (tentados.length) {
          try {
            const l = await leitor.calendario({ roomIds: tentados.map(p => p.roomId), inicio: inicioLeitura, fim: somarDias(fimLeitura, 1) });
            lidos = l.itens;
            const invalidos = quartosInvalidos(l.divergencias, tentados.map(p => p.roomId));
            releituraInvalida = invalidos.quartos;
            for (const d of l.divergencias) aviso(`Releitura do quarto ${d.id}: formato inválido; conferir manualmente.`);
            if (invalidos.semDono) aviso("A releitura do Beds24 trouxe registro inválido sem quarto identificável: a releitura de todos os quartos é tratada como inválida.");
          } catch (e) {
            releituraFalhou = mensagemSeguraBeds24(e);
            aviso(`Releitura do Beds24 falhou: ${releituraFalhou}. As noites enviadas ficam sem confirmação até a próxima importação ou envio.`);
          }
        }
        for (const p of tentados) {
          const res = resultadoImoveis.find(i => i.imovelId === p.imovelId)!;
          const lidosQuarto = lidos.filter(d => d.roomId === p.roomId);
          // Releitura com datas repetidas ou com dados inválidos no quarto é ambígua: nenhuma noite do
          // quarto é julgada nem observada por ela.
          const repetida = new Set(lidosQuarto.map(d => d.data)).size !== lidosQuarto.length;
          const ambigua = repetida ? "Releitura com datas repetidas" : releituraInvalida.has(p.roomId) ? "Releitura com dados inválidos" : "";
          if (ambigua) aviso(`Imóvel ${p.codigo}: ${ambigua.toLowerCase()}; as noites enviadas ficam pendentes até a próxima leitura.`);
          const porData = new Map(ambigua ? [] : lidosQuarto.map(d => [d.data, d] as const));
          const grupos = new Map<string, { resultado: typeof beds24EnvioNoites.$inferInsert["resultado"]; detalhe: string; datas: string[] }>();
          for (const l of p.linhas) {
            if (l.acao !== "enviar") continue;
            const lido = porData.get(l.data);
            // Só a releitura decide: igual = confirmado; diferente = divergente (falhou, num quarto com falha).
            // Releitura que falhou, ou noite que não voltou nela, não prova nada — nem com a escrita recusada:
            // a noite fica pendente para a leitura seguinte decidir.
            const resultado = releituraFalhou || !lido ? "enviado" : igualAoLido(l, lido) ? "confirmado" : res.falha ? "falhou" : "divergente";
            if (resultado === "confirmado") res.confirmadas++;
            if (resultado === "enviado") res.pendentes++;
            if (resultado === "divergente") { res.divergentes++; aviso(`Imóvel ${p.codigo}, noite ${dataBr(l.data)}: o Beds24 devolveu valores diferentes do enviado; conferir no Beds24.`); }
            const lidoTexto = lido ? `Beds24: preço ${lido.preco ?? "—"}, mín. ${lido.minimoNoites ?? "—"}, máx. ${lido.maximoNoites ?? "—"}, bloqueio ${lido.bloqueio ?? "—"}` : "Noite não retornou na releitura";
            const detalhe = (resultado === "divergente" ? lidoTexto : resultado === "falhou" ? `${res.falha}${releituraFalhou ? "" : ` · ${lidoTexto}`}` : resultado === "enviado" ? `${res.falha ? `${res.falha} · ` : ""}${releituraFalhou ? "Sem releitura" : ambigua || "Noite não retornou na releitura"}: confirmação pendente.` : "").slice(0, 300);
            const chave = `${resultado}\u0000${detalhe}`;
            const grupo = grupos.get(chave) ?? { resultado, detalhe, datas: [] };
            grupo.datas.push(l.data);
            grupos.set(chave, grupo);
            // A posse do bloqueio (blackout/none/restrição devolvida) só muda quando a releitura confirma;
            // até lá vale a anterior. A restrição anterior ao blackout fica guardada enquanto o SCL fecha.
            // A posse do bloqueio é confirmada pelo campo de bloqueio da releitura, independentemente de preço,
            // mínimo e máximo: o Beds24 pode aplicar o override e recusar ou normalizar outro campo. Sem essa posse,
            // um blackout aplicado ficaria sem dono e nunca seria reaberto.
            const confirmouBloqueio = l.bloqueioEnviar !== undefined && lido !== undefined && (lido.bloqueio ?? "none") === l.bloqueioEnviar;
            // Restrição anterior: fica com o blackout confirmado ou ainda em aberto (sem releitura); uma tentativa
            // desmentida sem posse anterior não guarda nada, para não devolver a restrição num ciclo futuro.
            const guardaAnterior = confirmouBloqueio || resultado === "enviado" || l.enviado?.bloqueio === "blackout";
            const v = {
              organizacaoId: org, imovelId: p.imovelId, data: l.data, roomId: p.roomId, preco: l.precoEnviar, minimo: l.minimoEnviar, maximo: l.maximoEnviar,
              bloqueio: confirmouBloqueio ? l.bloqueioEnviar! : (l.enviado?.bloqueio ?? null),
              bloqueioAnterior: l.bloqueioEnviar === "blackout" ? (guardaAnterior ? l.bloqueioAnterior : null) : confirmouBloqueio ? null : (l.enviado?.bloqueioAnterior ?? null),
              enviadoEm: instanteEnvio, confirmado: resultado === "confirmado", envioId: exec.id,
            };
            await tx.insert(beds24CalendarioEnviado).values(v).onConflictDoUpdate({ target: [beds24CalendarioEnviado.organizacaoId, beds24CalendarioEnviado.imovelId, beds24CalendarioEnviado.data], set: { roomId: v.roomId, preco: v.preco, minimo: v.minimo, maximo: v.maximo, bloqueio: v.bloqueio, bloqueioAnterior: v.bloqueioAnterior, enviadoEm: v.enviadoEm, confirmado: v.confirmado, envioId: v.envioId } });
          }
          for (const g of grupos.values()) {
            await tx.update(beds24EnvioNoites).set({ resultado: g.resultado, detalhe: g.detalhe }).where(and(eq(beds24EnvioNoites.envioId, exec.id), eq(beds24EnvioNoites.imovelId, p.imovelId), inArray(beds24EnvioNoites.data, g.datas)));
          }
          // Observação nova para todas as noites relidas deste imóvel (mais recente que o envio).
          await gravarObservacoes(tx, org, p.imovelId, porData.values(), instanteReleitura);
        }
        // Blackout do SCL que a leitura mais nova mostra trocado ou removido no Beds24: a posse acaba (sem escrita).
        for (const p of planos) {
          if (leituraIncompleta.has(p.imovelId)) continue;
          for (const l of p.linhas) {
            if (!l.posseBloqueioEncerrada) continue;
            await tx.update(beds24CalendarioEnviado).set({ bloqueio: null, bloqueioAnterior: null }).where(and(eq(beds24CalendarioEnviado.organizacaoId, org), eq(beds24CalendarioEnviado.imovelId, p.imovelId), eq(beds24CalendarioEnviado.roomId, p.roomId), eq(beds24CalendarioEnviado.data, l.data)));
          }
        }

        const enviadas = resultadoImoveis.reduce((s, i) => s + i.enviadas, 0);
        const confirmadas = resultadoImoveis.reduce((s, i) => s + i.confirmadas, 0);
        const divergentes = resultadoImoveis.reduce((s, i) => s + i.divergentes, 0);
        const falhas = resultadoImoveis.filter(i => i.falha).length;
        const pendentes = resultadoImoveis.reduce((s, i) => s + i.pendentes, 0);
        const situacao: SituacaoEnvio = falhas && !enviadas && !confirmadas && falhas === planos.filter(p => fase1.motivosSemEscrita.has(p.imovelId) || faixasDeEnvio(p.linhas).length).length ? "erro" : falhas || divergentes ? "parcial" : releituraFalhou || pendentes ? "incerto" : "ok";
        const mensagem = `${enviadas} noite(s) enviada(s) em ${tentados.filter(p => !resultadoImoveis.find(i => i.imovelId === p.imovelId)?.falha).length} imóvel(is), ${confirmadas} confirmada(s) na releitura, ${divergentes} divergente(s), ${falhas} imóvel(is) com falha; ${resultadoImoveis.reduce((s, i) => s + i.resumo.iguais, 0)} noite(s) já iguais não foram reenviadas${pendentes ? `; ${pendentes} noite(s) sem releitura (pendente)` : ""}; ${totalAvisos} aviso(s).`;
        await registrarAuditoria(tx, { organizacaoId: org, usuarioId: o.autorId ?? null, acao: "beds24.enviar", entidade: "integracao", entidadeId: org, mudancas: { resultado: [null, mensagem] } });
        return { ok: situacao === "ok", situacao, mensagem, envioId: exec.id, imoveis: resultadoImoveis, avisos, totalAvisos };
      });
    }
  } catch (e) {
    r = { ...base("erro", mensagemSeguraBeds24(e)), ok: false, envioId: exec.id, avisos, totalAvisos };
  }
  await db.update(beds24Envios).set({
    terminadoEm: new Date(), situacao: r.situacao, resumo: r.mensagem.slice(0, 1000), avisos: r.avisos,
    noitesEnviadas: r.imoveis.reduce((s, i) => s + i.enviadas, 0), noitesConfirmadas: r.imoveis.reduce((s, i) => s + i.confirmadas, 0), noitesDivergentes: r.imoveis.reduce((s, i) => s + i.divergentes, 0),
  }).where(eq(beds24Envios.id, exec.id));
  return r;
}

/** Últimas execuções com o número de noites registradas (há registro mesmo quando o Beds24 recusou). */
export function ultimosEnvios(db: Db, org: string, limite = 10) {
  return db.select({ ...getTableColumns(beds24Envios), noites: count(beds24EnvioNoites.id) }).from(beds24Envios)
    .leftJoin(beds24EnvioNoites, eq(beds24EnvioNoites.envioId, beds24Envios.id))
    .where(eq(beds24Envios.organizacaoId, org)).groupBy(beds24Envios.id).orderBy(desc(beds24Envios.iniciadoEm)).limit(limite);
}

/** Noites de uma execução (até `limite`), com o código do imóvel; só da organização. */
export function noitesDoEnvio(db: Db, org: string, envioId: string, limite = 200) {
  return db.select({
    data: beds24EnvioNoites.data, codigo: imoveis.codigo, precoAntes: beds24EnvioNoites.precoAntes, precoEnviado: beds24EnvioNoites.precoEnviado,
    minimoAntes: beds24EnvioNoites.minimoAntes, minimoEnviado: beds24EnvioNoites.minimoEnviado, maximoEnviado: beds24EnvioNoites.maximoEnviado,
    bloqueioAntes: beds24EnvioNoites.bloqueioAntes, bloqueioEnviado: beds24EnvioNoites.bloqueioEnviado, regra: beds24EnvioNoites.regra, resultado: beds24EnvioNoites.resultado, detalhe: beds24EnvioNoites.detalhe,
  }).from(beds24EnvioNoites).innerJoin(imoveis, eq(imoveis.id, beds24EnvioNoites.imovelId))
    .where(and(eq(beds24EnvioNoites.organizacaoId, org), eq(beds24EnvioNoites.envioId, envioId))).orderBy(asc(imoveis.codigo), asc(beds24EnvioNoites.data)).limit(limite);
}
