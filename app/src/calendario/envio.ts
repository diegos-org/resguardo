/**
 * Envio controlado de calendário e preços ao Beds24 (M3.7). Uma execução por organização:
 * planeja cada imóvel com envio ligado (motor puro), manda só as noites diferentes, relê o
 * destino e registra antes/depois por noite. Sem escritor (BEDS24_ESCRITA desligada) só
 * simula. Nunca cria, altera ou cancela reservas; nunca reabre bloqueio que o SCL não fez.
 */
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
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

const igualAoLido = (l: LinhaPlano, d: DiaCalendario | undefined) => d !== undefined
  && (l.precoEnviar === null || d.preco === l.precoEnviar) && (l.minimoEnviar === null || d.minimoNoites === l.minimoEnviar) && d.maximoNoites === l.maximoEnviar
  && (l.bloqueioEnviar === undefined || (d.bloqueio ?? "none") === l.bloqueioEnviar);

export async function enviarCalendarioBeds24(db: Db, org: string, leitor: LeitorBeds24, escritor: EscritorBeds24 | null, o: OpcoesEnvio): Promise<ResultadoEnvio> {
  const agora = o.agora ?? new Date();
  const base = (situacao: SituacaoEnvio, mensagem: string): ResultadoEnvio => ({ ok: situacao === "ok" || situacao === "simulacao", situacao, mensagem, envioId: null, imoveis: [], avisos: [], totalAvisos: 0 });
  if (o.modo === "envio" && !escritor) return base("desligada", "Envio desligado: BEDS24_ESCRITA não está \"ligada\" na Vercel (só o Diego liga, depois do teste). Use a simulação.");
  const [exec] = await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: agora, modo: o.modo, automatica: o.automatica === true }).returning({ id: beds24Envios.id });
  let r: ResultadoEnvio;
  try {
    r = await db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '15s'`);
      const trava = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${`envio-beds24:${org}`})) as obtida`);
      if (!(trava as { rows: { obtida: boolean }[] }).rows[0]?.obtida) return { ...base("ocupada", "Já há um envio em andamento. Aguarde e atualize a página."), ok: false };
      const regras = await lerRegrasCalendario(tx, org);
      const mapas = (await listarMapeamentosBeds24(tx, org)).filter(m => m.ativo && /^\d+$/.test(m.propertyId) && /^\d+$/.test(m.roomId));
      const pedidos = o.imovelIds ? [...new Set(o.imovelIds)] : null;
      if (pedidos?.some(id => !regras.envio.imoveis.includes(id))) throw new ErroBeds24("Este imóvel não está com envio ligado em Configurações → Calendário e preços.", "configuracao");
      const escolhidos = mapas.filter(m => regras.envio.imoveis.includes(m.imovelId) && (!pedidos || pedidos.includes(m.imovelId)));
      if (pedidos?.some(id => !escolhidos.some(m => m.imovelId === id))) throw new ErroBeds24("Imóvel sem vínculo Beds24 ativo (propriedade e quarto numéricos). Confira em Integrações.", "configuracao");
      if (!escolhidos.length) throw new ErroBeds24("Nenhum imóvel com envio ligado e vínculo Beds24 ativo. Ligue o envio por imóvel em Configurações → Calendário e preços.", "configuracao");
      if (new Set(escolhidos.map(m => m.imovelId)).size !== escolhidos.length || new Set(escolhidos.map(m => m.roomId)).size !== escolhidos.length) throw new ErroBeds24("Cada imóvel deve estar ligado a um único quarto Beds24. Remova os vínculos duplicados antes de enviar.", "configuracao");
      const fusos = new Map((await tx.select({ id: imoveis.id, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.organizacaoId, org), inArray(imoveis.id, escolhidos.map(m => m.imovelId))))).map(i => [i.id, i.fuso]));

      const avisos: string[] = [];
      let totalAvisos = 0;
      const aviso = (s: string) => { totalAvisos++; if (avisos.length < 100) avisos.push(s.slice(0, 300)); };

      // Como na importação: a credencial atual precisa enxergar exatamente o par propriedade/quarto
      // de cada imóvel, em BRL. Um vínculo digitado errado nunca recebe preços de outro imóvel.
      const quartos = await leitor.quartos();
      const inacessiveis = new Map<string, string>();
      for (const m of escolhidos) {
        const q = quartos.itens.find(q => q.propertyId === m.propertyId && q.roomId === m.roomId);
        if (!q) inacessiveis.set(m.imovelId, `O quarto vinculado ao imóvel ${m.codigo} (propriedade ${m.propertyId}, quarto ${m.roomId}) não está acessível nesta credencial. Confira o vínculo em Integrações antes de enviar.`);
        else if (q.moeda !== "BRL") inacessiveis.set(m.imovelId, `A moeda do imóvel ${m.codigo} precisa estar confirmada como BRL no Beds24 antes do envio de preços.`);
      }
      for (const [, motivo] of inacessiveis) aviso(`${motivo} Nenhum valor é enviado para esse imóvel.`);
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
        for (const l of p.linhas) for (const a of l.avisos) if (!a.startsWith("Sem leitura do Beds24")) aviso(`Imóvel ${m.codigo}, noite ${l.data.split("-").reverse().join("/")}: ${a}`);
        const semLeitura = p.linhas.filter(l => !l.observacao).length;
        if (semLeitura) aviso(`Imóvel ${m.codigo}: ${semLeitura} noite(s) sem leitura anterior do Beds24; serão enviadas e conferidas pela releitura.`);
      }
      const resultadoImoveis: ImovelEnviado[] = planos.map(p => ({ imovelId: p.imovelId, codigo: p.codigo, resumo: resumirPlano(p.linhas), enviadas: 0, confirmadas: 0, divergentes: 0, falha: "" }));
      const totalEnviar = resultadoImoveis.reduce((s, i) => s + i.resumo.enviar, 0);

      if (o.modo === "simulacao" || !escritor) {
        const mensagem = `Simulação: ${totalEnviar} noite(s) seriam enviadas em ${planos.length} imóvel(is); ${resultadoImoveis.reduce((s, i) => s + i.resumo.iguais, 0)} já iguais; ${totalAvisos} aviso(s). Nada foi gravado no Beds24.`;
        return { ok: true, situacao: "simulacao", mensagem, envioId: exec.id, imoveis: resultadoImoveis, avisos, totalAvisos };
      }

      // Escrita: um pedido por imóvel; falha de um não impede os outros. Todo quarto em que
      // houve tentativa é relido depois: uma recusa (ou queda de rede) não prova que nada mudou.
      const tentados: Plano[] = [];
      for (const p of planos) {
        const faixas = faixasDeEnvio(p.linhas);
        const r = resultadoImoveis.find(i => i.imovelId === p.imovelId)!;
        if (inacessiveis.has(p.imovelId)) { r.falha = inacessiveis.get(p.imovelId)!; continue; }
        if (!faixas.length) continue;
        tentados.push(p);
        try {
          const [res] = await escritor.escreverCalendario([{ roomId: p.roomId, faixas }]);
          if (!res?.ok) r.falha = res?.erro || "Beds24 recusou a escrita.";
          else r.enviadas = p.linhas.filter(l => l.acao === "enviar").length;
        } catch (e) {
          r.falha = mensagemSeguraBeds24(e);
        }
        if (r.falha) aviso(`Imóvel ${p.codigo}: envio falhou — ${r.falha}. O quarto foi relido para registrar o que ficou gravado.`);
      }

      // Releitura do destino: confirma noite a noite e atualiza a observação local.
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
      const noites: typeof beds24EnvioNoites.$inferInsert[] = [];
      const estado: typeof beds24CalendarioEnviado.$inferInsert[] = [];
      for (const p of tentados) {
        const r = resultadoImoveis.find(i => i.imovelId === p.imovelId)!;
        const porData = new Map(lidos.filter(d => d.roomId === p.roomId).map(d => [d.data, d]));
        for (const l of p.linhas) {
          if (l.acao !== "enviar") continue;
          const lido = porData.get(l.data);
          // Num quarto com falha, só a releitura decide: igual = confirmado; diferente = falhou (nada se supõe).
          const resultado = releituraFalhou ? (r.falha ? "falhou" : "enviado") : igualAoLido(l, lido) ? "confirmado" : r.falha ? "falhou" : "divergente";
          if (resultado === "confirmado") r.confirmadas++;
          if (resultado === "divergente") { r.divergentes++; aviso(`Imóvel ${p.codigo}, noite ${l.data.split("-").reverse().join("/")}: o Beds24 devolveu valores diferentes do enviado; conferir no Beds24.`); }
          const lidoTexto = lido ? `Beds24: preço ${lido.preco ?? "—"}, mín. ${lido.minimoNoites ?? "—"}, máx. ${lido.maximoNoites ?? "—"}, bloqueio ${lido.bloqueio ?? "—"}` : "Noite não retornou na releitura";
          noites.push({
            organizacaoId: org, envioId: exec.id, imovelId: p.imovelId, data: l.data,
            precoAntes: l.observacao?.preco ?? null, precoEnviado: l.precoEnviar, minimoAntes: l.observacao?.minimoNoites ?? null, minimoEnviado: l.minimoEnviar, maximoEnviado: l.maximoEnviar,
            bloqueioAntes: l.observacao?.bloqueio ?? null, bloqueioEnviado: l.bloqueioEnviar ?? null, regra: l.regra.slice(0, 300), resultado,
            detalhe: (resultado === "divergente" ? lidoTexto : resultado === "falhou" ? `${r.falha}${releituraFalhou ? "" : ` · ${lidoTexto}`}` : "").slice(0, 300),
          });
          estado.push({
            organizacaoId: org, imovelId: p.imovelId, data: l.data, preco: l.precoEnviar, minimo: l.minimoEnviar, maximo: l.maximoEnviar,
            bloqueio: l.bloqueioEnviar ?? l.enviado?.bloqueio ?? null, enviadoEm: agora, confirmado: resultado === "confirmado", envioId: exec.id,
          });
        }
        // Observação nova para todas as noites relidas deste imóvel (mais recente que o envio).
        const observadoEm = new Date(agora.getTime() + 1);
        for (const d of porData.values()) {
          await tx.insert(beds24Calendario).values({ organizacaoId: org, imovelId: p.imovelId, data: d.data, livres: d.livres, preco: d.preco, minimoNoites: d.minimoNoites, maximoNoites: d.maximoNoites, bloqueio: d.bloqueio, observadoEm })
            .onConflictDoUpdate({ target: [beds24Calendario.organizacaoId, beds24Calendario.imovelId, beds24Calendario.data], set: { livres: d.livres, preco: d.preco, minimoNoites: d.minimoNoites, maximoNoites: d.maximoNoites, bloqueio: d.bloqueio, observadoEm } });
        }
      }
      for (let i = 0; i < noites.length; i += 250) await tx.insert(beds24EnvioNoites).values(noites.slice(i, i + 250));
      for (const v of estado) {
        await tx.insert(beds24CalendarioEnviado).values(v).onConflictDoUpdate({ target: [beds24CalendarioEnviado.organizacaoId, beds24CalendarioEnviado.imovelId, beds24CalendarioEnviado.data], set: { preco: v.preco, minimo: v.minimo, maximo: v.maximo, bloqueio: v.bloqueio, enviadoEm: v.enviadoEm, confirmado: v.confirmado, envioId: v.envioId } });
      }

      const enviadas = resultadoImoveis.reduce((s, i) => s + i.enviadas, 0);
      const confirmadas = resultadoImoveis.reduce((s, i) => s + i.confirmadas, 0);
      const divergentes = resultadoImoveis.reduce((s, i) => s + i.divergentes, 0);
      const falhas = resultadoImoveis.filter(i => i.falha).length;
      const situacao: SituacaoEnvio = falhas && !enviadas && !confirmadas && falhas === planos.filter(p => inacessiveis.has(p.imovelId) || faixasDeEnvio(p.linhas).length).length ? "erro" : releituraFalhou ? "incerto" : falhas || divergentes ? "parcial" : "ok";
      const mensagem = `${enviadas} noite(s) enviada(s) em ${tentados.filter(p => !resultadoImoveis.find(i => i.imovelId === p.imovelId)?.falha).length} imóvel(is), ${confirmadas} confirmada(s) na releitura, ${divergentes} divergente(s), ${falhas} imóvel(is) com falha; ${resultadoImoveis.reduce((s, i) => s + i.resumo.iguais, 0)} noite(s) já iguais não foram reenviadas; ${totalAvisos} aviso(s).`;
      await registrarAuditoria(tx, { organizacaoId: org, usuarioId: o.autorId ?? null, acao: "beds24.enviar", entidade: "integracao", entidadeId: org, mudancas: { resultado: [null, mensagem] } });
      return { ok: situacao === "ok", situacao, mensagem, envioId: exec.id, imoveis: resultadoImoveis, avisos, totalAvisos };
    });
  } catch (e) {
    r = { ...base("erro", mensagemSeguraBeds24(e)), ok: false, envioId: exec.id };
  }
  await db.update(beds24Envios).set({
    terminadoEm: new Date(), situacao: r.situacao, resumo: r.mensagem.slice(0, 1000), avisos: r.avisos,
    noitesEnviadas: r.imoveis.reduce((s, i) => s + i.enviadas, 0), noitesConfirmadas: r.imoveis.reduce((s, i) => s + i.confirmadas, 0), noitesDivergentes: r.imoveis.reduce((s, i) => s + i.divergentes, 0),
  }).where(eq(beds24Envios.id, exec.id));
  return r;
}

export function ultimosEnvios(db: Db, org: string, limite = 10) {
  return db.select().from(beds24Envios).where(eq(beds24Envios.organizacaoId, org)).orderBy(desc(beds24Envios.iniciadoEm)).limit(limite);
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
