/**
 * Envio controlado de calendário e preços ao Beds24 (M3.7). Uma execução por organização:
 * planeja cada imóvel com envio ligado (motor puro), manda só as noites diferentes, relê o
 * destino e registra antes/depois por noite. Todo envio parte de uma leitura atual do Beds24:
 * sem ela nada é escrito. Sem escritor (BEDS24_ESCRITA desligada) só simula. Nunca cria,
 * altera ou cancela reservas; nunca reabre bloqueio que o SCL não fez.
 */
import { and, asc, count, desc, eq, getTableColumns, gt, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { listarMapeamentosBeds24 } from "@/beds24/configuracao";
import { mensagemSeguraBeds24 } from "@/beds24/sincronizacao";
import { type DiaCalendario, ErroBeds24, type EscritorBeds24, type LeitorBeds24 } from "@/beds24/tipos";
import { beds24Calendario, beds24CalendarioEnviado, beds24EnvioNoites, beds24Envios, bloqueios, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { lerDetalhes, listarPeriodos, regrasDeVenda } from "@/imoveis/detalhes";
import { somarDias } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";
import { faixasDeEnvio, type LinhaPlano, planejarCalendario, resumirPlano, type ResumoPlano } from "./motor";
import { lerRegrasCalendario, type RegrasCalendario } from "./regras-config";

export type ModoEnvio = "simulacao" | "envio";
export type SituacaoEnvio = "ok" | "parcial" | "erro" | "ocupada" | "desligada" | "simulacao" | "incerto";
export type ImovelEnviado = { imovelId: string; codigo: string; resumo: ResumoPlano; enviadas: number; confirmadas: number; divergentes: number; falha: string };
export type ResultadoEnvio = { ok: boolean; situacao: SituacaoEnvio; mensagem: string; envioId: string | null; imoveis: ImovelEnviado[]; avisos: string[]; totalAvisos: number };
export type OpcoesEnvio = { modo: ModoEnvio; imovelIds?: string[]; autorId?: string | null; automatica?: boolean; agora?: Date };

const NOMES_SITUACAO: Record<SituacaoEnvio, string> = {
  ok: "Enviado e conferido", parcial: "Enviado com divergências ou falhas", erro: "Falhou", ocupada: "Outra execução em andamento",
  desligada: "Envio desligado", simulacao: "Simulação (nada enviado)", incerto: "Enviado, sem confirmação da releitura",
};
export const nomeSituacaoEnvio = (s: string) => NOMES_SITUACAO[s as SituacaoEnvio] ?? s;

type Plano = { imovelId: string; codigo: string; roomId: string; linhas: LinhaPlano[] };

/** Planeja um imóvel a partir do banco (cadastro, períodos, ocupação, observações e último envio). */
export async function planejarImovel(db: Db, org: string, regras: RegrasCalendario, imovel: { id: string; fuso: string }, agora: Date, intervalo?: { inicio: string; fim: string }) {
  const hoje = hojeISO(imovel.fuso, agora);
  const inicio = intervalo?.inicio && intervalo.inicio > hoje ? intervalo.inicio : hoje;
  const fim = intervalo?.fim ?? somarDias(hoje, regras.horizonteDias - 1);
  const fimDados = somarDias(fim, 60);
  const [detalhes, periodos, ocupantes, impedimentos, observacoes, enviados] = await Promise.all([
    lerDetalhes(db, org, imovel.id), listarPeriodos(db, org, imovel.id),
    db.select({ checkin: reservas.checkin, checkout: reservas.checkout, estado: reservas.estado }).from(reservas).where(and(eq(reservas.organizacaoId, org), eq(reservas.imovelId, imovel.id), lt(reservas.checkin, somarDias(fimDados, 1)), gt(reservas.checkout, inicio))),
    db.select({ inicio: bloqueios.inicio, fim: bloqueios.fim, fonte: bloqueios.fonte }).from(bloqueios).where(and(eq(bloqueios.organizacaoId, org), eq(bloqueios.imovelId, imovel.id), lt(bloqueios.inicio, somarDias(fimDados, 1)), gt(bloqueios.fim, inicio))),
    db.select().from(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, org), eq(beds24Calendario.imovelId, imovel.id), gte(beds24Calendario.data, inicio), lte(beds24Calendario.data, fim))).orderBy(asc(beds24Calendario.data)),
    db.select().from(beds24CalendarioEnviado).where(and(eq(beds24CalendarioEnviado.organizacaoId, org), eq(beds24CalendarioEnviado.imovelId, imovel.id), gte(beds24CalendarioEnviado.data, inicio), lte(beds24CalendarioEnviado.data, fim))),
  ]);
  const linhas = planejarCalendario({
    imovel: { id: imovel.id, regras: regrasDeVenda(detalhes), periodos, pisos: [detalhes.pisoUltimaHora1, detalhes.pisoUltimaHora2] },
    regras, hoje, inicio, fim, fimDados, reservas: ocupantes, bloqueios: impedimentos, observacoes, enviados,
  });
  return { hoje, inicio, fim, linhas, regras: regrasDeVenda(detalhes), pisos: [detalhes.pisoUltimaHora1, detalhes.pisoUltimaHora2] as const };
}

/** Grava a leitura do calendário como observação local das noites (a mais nova vale). */
async function gravarObservacoes(tx: Db, org: string, imovelId: string, dias: Iterable<DiaCalendario>, observadoEm: Date) {
  for (const d of dias) {
    await tx.insert(beds24Calendario).values({ organizacaoId: org, imovelId, data: d.data, livres: d.livres, preco: d.preco, minimoNoites: d.minimoNoites, maximoNoites: d.maximoNoites, bloqueio: d.bloqueio, observadoEm })
      .onConflictDoUpdate({ target: [beds24Calendario.organizacaoId, beds24Calendario.imovelId, beds24Calendario.data], set: { livres: d.livres, preco: d.preco, minimoNoites: d.minimoNoites, maximoNoites: d.maximoNoites, bloqueio: d.bloqueio, observadoEm } });
  }
}

const igualAoLido = (l: LinhaPlano, d: DiaCalendario | undefined) => d !== undefined
  && (l.precoEnviar === null || d.preco === l.precoEnviar) && (l.minimoEnviar === null || d.minimoNoites === l.minimoEnviar) && d.maximoNoites === l.maximoEnviar
  && (l.bloqueioEnviar === undefined || (d.bloqueio ?? "none") === l.bloqueioEnviar);

/** Execução "executando" mais nova que isto bloqueia outra; mais velha é considerada interrompida. */
const JANELA_EM_ANDAMENTO_MS = 10 * 60_000;

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
  const chaveTrava = `envio-beds24:${org}`;
  let r: ResultadoEnvio;
  try {
    const fase1 = await db.transaction(async (tx): Promise<Fase1> => {
      await tx.execute(sql`set local lock_timeout = '15s'`);
      const trava = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${chaveTrava})) as obtida`);
      if (!(trava as { rows: { obtida: boolean }[] }).rows[0]?.obtida) return { pronto: { ...base("ocupada", "Já há um envio em andamento. Aguarde e atualize a página."), ok: false } };
      // Outra execução entre a escrita externa e o registro final (ou interrompida há pouco) também bloqueia.
      const emAndamento = await tx.select({ id: beds24Envios.id }).from(beds24Envios)
        .where(and(eq(beds24Envios.organizacaoId, org), eq(beds24Envios.situacao, "executando"), ne(beds24Envios.id, exec.id), gt(beds24Envios.iniciadoEm, new Date(agora.getTime() - JANELA_EM_ANDAMENTO_MS)))).limit(1);
      if (emAndamento.length) return { pronto: { ...base("ocupada", "Já há um envio em andamento. Aguarde e atualize a página."), ok: false } };
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
          const comDivergencia = new Set(l.divergencias.map(d => d.id));
          for (const d of l.divergencias) aviso(`Leitura do quarto ${d.id}: formato inválido; conferir manualmente.`);
          for (const m of acessiveis) {
            const dias = l.itens.filter(d => d.roomId === m.roomId);
            await gravarObservacoes(tx, org, m.imovelId, dias, agora);
            const datas = new Set(dias.map(d => d.data));
            let faltam = 0;
            for (let d = hojeDe(m), fimImovel = somarDias(d, regras.horizonteDias - 1); d <= fimImovel; d = somarDias(d, 1)) if (!datas.has(d)) faltam++;
            if (faltam || comDivergencia.has(m.roomId)) {
              leituraIncompleta.add(m.imovelId);
              const motivo = `A leitura do Beds24 do imóvel ${m.codigo} ficou incompleta (${faltam} noite(s) do horizonte sem retorno${comDivergencia.has(m.roomId) ? ", dados inválidos" : ""}): nada é enviado para esse imóvel nesta execução.`;
              motivosSemEscrita.set(m.imovelId, motivo);
              aviso(motivo);
            }
          }
        } catch (e) {
          const motivo = mensagemSeguraBeds24(e);
          if (o.modo === "envio") throw new ErroBeds24(`Leitura do Beds24 antes do envio falhou: ${motivo} Nada foi enviado: o SCL só escreve a partir de uma leitura atual do destino.`, "rede");
          aviso(`Leitura do Beds24 falhou: ${motivo} A simulação usa a última leitura guardada.`);
        }
      }

      const planos: Plano[] = [];
      let inicioLeitura = "9999-12-31";
      let fimLeitura = "0000-01-01";
      for (const m of escolhidos) {
        const p = await planejarImovel(tx, org, regras, { id: m.imovelId, fuso: fusos.get(m.imovelId) ?? "America/Sao_Paulo" }, agora);
        planos.push({ imovelId: m.imovelId, codigo: m.codigo, roomId: m.roomId, linhas: p.linhas });
        if (p.inicio < inicioLeitura) inicioLeitura = p.inicio;
        if (p.fim > fimLeitura) fimLeitura = p.fim;
        const semPreco = p.linhas.filter(l => l.precoReferencia === null).length;
        if (semPreco) aviso(`Imóvel ${m.codigo}: ${semPreco} noite(s) sem preço no SCL; o preço dessas noites não é enviado.`);
        for (const l of p.linhas) for (const a of l.avisos) if (!a.startsWith("Sem leitura do Beds24")) aviso(`Imóvel ${m.codigo}, noite ${dataBr(l.data)}: ${a}`);
        const semLeitura = p.linhas.filter(l => !l.observacao).length;
        if (semLeitura) aviso(`Imóvel ${m.codigo}: ${semLeitura} noite(s) sem leitura anterior do Beds24; serão enviadas e conferidas pela releitura.`);
        // Envio anterior cuja releitura não aconteceu (resultado "enviado") e que a leitura de agora
        // mostra igual ao plano: confirma tarde e assume a posse do bloqueio enviado, sem escrever.
        // Tentativa que a releitura já desmentiu ("falhou"/"divergente") nunca ganha posse assim: um
        // blackout igual que apareça depois pode ser de terceiros.
        let tardias = 0;
        const candidatas = leituraIncompleta.has(m.imovelId) ? [] : p.linhas.filter(l => l.acao === "igual" && l.enviado && !l.enviado.confirmado && l.enviado.envioId);
        const semReleitura = new Set(candidatas.length ? (await tx.select({ envioId: beds24EnvioNoites.envioId, data: beds24EnvioNoites.data }).from(beds24EnvioNoites)
          .where(and(eq(beds24EnvioNoites.organizacaoId, org), eq(beds24EnvioNoites.imovelId, m.imovelId), inArray(beds24EnvioNoites.envioId, [...new Set(candidatas.map(l => l.enviado!.envioId!))]), eq(beds24EnvioNoites.resultado, "enviado")))).map(n => `${n.envioId}/${n.data}`) : []);
        for (const l of candidatas) {
          if (!semReleitura.has(`${l.enviado!.envioId}/${l.data}`)) continue;
          await tx.update(beds24CalendarioEnviado).set({
            confirmado: true,
            bloqueio: l.posseBloqueioEncerrada ? null : (l.bloqueioEnviar ?? l.enviado!.bloqueio),
            bloqueioAnterior: l.posseBloqueioEncerrada ? null : l.bloqueioEnviar === "blackout" ? l.bloqueioAnterior : l.bloqueioEnviar !== undefined ? null : (l.enviado!.bloqueioAnterior ?? null),
          }).where(and(eq(beds24CalendarioEnviado.organizacaoId, org), eq(beds24CalendarioEnviado.imovelId, m.imovelId), eq(beds24CalendarioEnviado.data, l.data)));
          tardias++;
        }
        if (tardias) aviso(`Imóvel ${m.codigo}: ${tardias} noite(s) de envio anterior confirmada(s) pela leitura de agora.`);
      }
      const resultadoImoveis: ImovelEnviado[] = planos.map(p => ({ imovelId: p.imovelId, codigo: p.codigo, resumo: resumirPlano(p.linhas), enviadas: 0, confirmadas: 0, divergentes: 0, falha: motivosSemEscrita.get(p.imovelId) ?? "" }));
      const totalEnviar = resultadoImoveis.reduce((s, i) => s + i.resumo.enviar, 0);

      if (o.modo === "simulacao" || !escritor) {
        const mensagem = `Simulação: ${totalEnviar} noite(s) seriam enviadas em ${planos.length} imóvel(is); ${resultadoImoveis.reduce((s, i) => s + i.resumo.iguais, 0)} já iguais; ${totalAvisos} aviso(s). Nada foi gravado no Beds24.`;
        return { pronto: { ok: true, situacao: "simulacao", mensagem, envioId: exec.id, imoveis: resultadoImoveis.map(i => ({ ...i, falha: "" })), avisos, totalAvisos } };
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
            organizacaoId: org, imovelId: p.imovelId, data: l.data, preco: l.precoEnviar, minimo: l.minimoEnviar, maximo: l.maximoEnviar,
            bloqueio: l.enviado?.bloqueio ?? null, bloqueioAnterior: l.bloqueioEnviar === "blackout" ? l.bloqueioAnterior : (l.enviado?.bloqueioAnterior ?? null),
            enviadoEm: agora, confirmado: false, envioId: exec.id,
          };
          await tx.insert(beds24CalendarioEnviado).values(v).onConflictDoUpdate({ target: [beds24CalendarioEnviado.organizacaoId, beds24CalendarioEnviado.imovelId, beds24CalendarioEnviado.data], set: { preco: v.preco, minimo: v.minimo, maximo: v.maximo, bloqueio: v.bloqueio, bloqueioAnterior: v.bloqueioAnterior, enviadoEm: v.enviadoEm, confirmado: v.confirmado, envioId: v.envioId } });
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
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chaveTrava}))`);
        let releituraFalhou = "";
        let lidos: DiaCalendario[] = [];
        if (tentados.length) {
          try {
            const l = await leitor.calendario({ roomIds: tentados.map(p => p.roomId), inicio: inicioLeitura, fim: somarDias(fimLeitura, 1) });
            lidos = l.itens;
            for (const d of l.divergencias) aviso(`Releitura do quarto ${d.id}: formato inválido; conferir manualmente.`);
          } catch (e) {
            releituraFalhou = mensagemSeguraBeds24(e);
            aviso(`Releitura do Beds24 falhou: ${releituraFalhou}. As noites enviadas ficam sem confirmação até a próxima importação ou envio.`);
          }
        }
        for (const p of tentados) {
          const res = resultadoImoveis.find(i => i.imovelId === p.imovelId)!;
          const porData = new Map(lidos.filter(d => d.roomId === p.roomId).map(d => [d.data, d]));
          const grupos = new Map<string, { resultado: typeof beds24EnvioNoites.$inferInsert["resultado"]; detalhe: string; datas: string[] }>();
          for (const l of p.linhas) {
            if (l.acao !== "enviar") continue;
            const lido = porData.get(l.data);
            // Num quarto com falha, só a releitura decide: igual = confirmado; diferente = falhou (nada se supõe).
            const resultado = releituraFalhou ? (res.falha ? "falhou" : "enviado") : igualAoLido(l, lido) ? "confirmado" : res.falha ? "falhou" : "divergente";
            if (resultado === "confirmado") res.confirmadas++;
            if (resultado === "divergente") { res.divergentes++; aviso(`Imóvel ${p.codigo}, noite ${dataBr(l.data)}: o Beds24 devolveu valores diferentes do enviado; conferir no Beds24.`); }
            const lidoTexto = lido ? `Beds24: preço ${lido.preco ?? "—"}, mín. ${lido.minimoNoites ?? "—"}, máx. ${lido.maximoNoites ?? "—"}, bloqueio ${lido.bloqueio ?? "—"}` : "Noite não retornou na releitura";
            const detalhe = (resultado === "divergente" ? lidoTexto : resultado === "falhou" ? `${res.falha}${releituraFalhou ? "" : ` · ${lidoTexto}`}` : resultado === "enviado" ? "Sem releitura: confirmação pendente." : "").slice(0, 300);
            const chave = `${resultado}\u0000${detalhe}`;
            const grupo = grupos.get(chave) ?? { resultado, detalhe, datas: [] };
            grupo.datas.push(l.data);
            grupos.set(chave, grupo);
            // A posse do bloqueio (blackout/none/restrição devolvida) só muda quando a releitura confirma;
            // até lá vale a anterior. A restrição anterior ao blackout fica guardada enquanto o SCL fecha.
            const confirmouBloqueio = resultado === "confirmado" && l.bloqueioEnviar !== undefined;
            const v = {
              organizacaoId: org, imovelId: p.imovelId, data: l.data, preco: l.precoEnviar, minimo: l.minimoEnviar, maximo: l.maximoEnviar,
              bloqueio: confirmouBloqueio ? l.bloqueioEnviar! : (l.enviado?.bloqueio ?? null),
              bloqueioAnterior: l.bloqueioEnviar === "blackout" ? l.bloqueioAnterior : confirmouBloqueio ? null : (l.enviado?.bloqueioAnterior ?? null),
              enviadoEm: agora, confirmado: resultado === "confirmado", envioId: exec.id,
            };
            await tx.insert(beds24CalendarioEnviado).values(v).onConflictDoUpdate({ target: [beds24CalendarioEnviado.organizacaoId, beds24CalendarioEnviado.imovelId, beds24CalendarioEnviado.data], set: { preco: v.preco, minimo: v.minimo, maximo: v.maximo, bloqueio: v.bloqueio, bloqueioAnterior: v.bloqueioAnterior, enviadoEm: v.enviadoEm, confirmado: v.confirmado, envioId: v.envioId } });
          }
          for (const g of grupos.values()) {
            await tx.update(beds24EnvioNoites).set({ resultado: g.resultado, detalhe: g.detalhe }).where(and(eq(beds24EnvioNoites.envioId, exec.id), eq(beds24EnvioNoites.imovelId, p.imovelId), inArray(beds24EnvioNoites.data, g.datas)));
          }
          // Observação nova para todas as noites relidas deste imóvel (mais recente que o envio).
          await gravarObservacoes(tx, org, p.imovelId, porData.values(), new Date(agora.getTime() + 1));
        }
        // Blackout do SCL que a leitura mais nova mostra trocado ou removido no Beds24: a posse acaba (sem escrita).
        for (const p of planos) {
          if (leituraIncompleta.has(p.imovelId)) continue;
          for (const l of p.linhas) {
            if (!l.posseBloqueioEncerrada) continue;
            await tx.update(beds24CalendarioEnviado).set({ bloqueio: null, bloqueioAnterior: null }).where(and(eq(beds24CalendarioEnviado.organizacaoId, org), eq(beds24CalendarioEnviado.imovelId, p.imovelId), eq(beds24CalendarioEnviado.data, l.data)));
          }
        }

        const enviadas = resultadoImoveis.reduce((s, i) => s + i.enviadas, 0);
        const confirmadas = resultadoImoveis.reduce((s, i) => s + i.confirmadas, 0);
        const divergentes = resultadoImoveis.reduce((s, i) => s + i.divergentes, 0);
        const falhas = resultadoImoveis.filter(i => i.falha).length;
        const situacao: SituacaoEnvio = falhas && !enviadas && !confirmadas && falhas === planos.filter(p => fase1.motivosSemEscrita.has(p.imovelId) || faixasDeEnvio(p.linhas).length).length ? "erro" : releituraFalhou ? "incerto" : falhas || divergentes ? "parcial" : "ok";
        const mensagem = `${enviadas} noite(s) enviada(s) em ${tentados.filter(p => !resultadoImoveis.find(i => i.imovelId === p.imovelId)?.falha).length} imóvel(is), ${confirmadas} confirmada(s) na releitura, ${divergentes} divergente(s), ${falhas} imóvel(is) com falha; ${resultadoImoveis.reduce((s, i) => s + i.resumo.iguais, 0)} noite(s) já iguais não foram reenviadas; ${totalAvisos} aviso(s).`;
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
