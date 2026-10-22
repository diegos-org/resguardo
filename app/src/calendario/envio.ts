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
import { CAUSA_EM_ANDAMENTO, type CausaEscritaBeds24, chaveTravaBeds24, escritaBeds24EmAndamento, MENSAGEM_ENVIO_EM_ANDAMENTO, MENSAGEM_RESERVA_EM_ANDAMENTO_EQUIPE, tentarTravaBeds24 } from "@/beds24/trava";
import { type DiaCalendario, type Divergencia, ErroBeds24, type EscritorBeds24, type LeitorBeds24 } from "@/beds24/tipos";
import { beds24Calendario, beds24CalendarioEnviado, beds24EnvioImoveis, beds24EnvioNoites, beds24Envios, bloqueios, imoveis, type MotivoCopiaCalendario, precosImportados, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { fontesDePrecosDosImoveis, lerDetalhes, listarPeriodos, regrasDeVenda } from "@/imoveis/detalhes";
import type { FontePrecos } from "@/imoveis/fonte-precos";
import { somarDias } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";
import { copiarLeitura } from "./copias";
import { faixasDeEnvio, intervaloDasReservas, type LinhaPlano, planejarCalendario, type PrecoImportado, resumirPlano, type ResumoPlano } from "./motor";
import { lerRegrasCalendario, type RegrasCalendario } from "./regras-config";

export type ModoEnvio = "simulacao" | "envio";
export type SituacaoEnvio = "ok" | "parcial" | "erro" | "ocupada" | "desligada" | "simulacao" | "incerto";
export type ImovelEnviado = { imovelId: string; codigo: string; resumo: ResumoPlano; enviadas: number; confirmadas: number; divergentes: number; pendentes: number; falha: string };
export type ResultadoEnvio = {
  ok: boolean;
  situacao: SituacaoEnvio;
  mensagem: string;
  envioId: string | null;
  imoveis: ImovelEnviado[];
  avisos: string[];
  totalAvisos: number;
  /** A execução que refez os imóveis cujas reservas mudaram durante esta (ver `OpcoesEnvio.refazendo`). */
  refeito?: ResultadoEnvio;
  /** Só na "ocupada": a causa em poucas palavras (a rotina diária registra "não rodou: <causa>"). */
  causa?: string;
};
/** `credencial` = impressão da credencial Beds24 usada (`impressaoCredencialBeds24`), gravada na execução: o veredito por imóvel só vale para ela. */
export type OpcoesEnvio = {
  modo: ModoEnvio;
  imovelIds?: string[];
  autorId?: string | null;
  automatica?: boolean;
  agora?: Date;
  credencial?: string;
  /** A execução que refaz os imóveis cujas reservas mudaram durante a anterior (uma vez só: ela não refaz de novo). */
  refazendo?: boolean;
};
/** Veredito de um imóvel numa execução que ainda não terminou (ou morreu no meio): nunca conta como incluído. */
export const VEREDITO_PENDENTE = "Execução ainda não concluída.";

type VinculoBeds24 = { imovelId: string; ativo: boolean; propertyId: string; roomId: string };
/** Vínculo Beds24 que vale para o envio: ativo, com propriedade e quarto numéricos. */
export const vinculoValidoParaEnvio = (m: Pick<VinculoBeds24, "ativo" | "propertyId" | "roomId">) => m.ativo && /^\d+$/.test(m.propertyId) && /^\d+$/.test(m.roomId);
/** Vínculos escolhidos para um envio são ambíguos quando um imóvel tem dois ou um quarto serve a dois imóveis: o envio inteiro é abortado. */
export const vinculosAmbiguos = (escolhidos: readonly Pick<VinculoBeds24, "imovelId" | "roomId">[]) =>
  new Set(escolhidos.map((m) => m.imovelId)).size !== escolhidos.length || new Set(escolhidos.map((m) => m.roomId)).size !== escolhidos.length;
/**
 * O imóvel está pronto para o envio pela régua que aborta o envio inteiro: ele tem um vínculo válido e, entre os vínculos
 * válidos de toda a lista de envio (mais o dele), nenhuma ambiguidade — a ambiguidade de outro imóvel também derruba o
 * envio deste. O portal lê daqui para nunca prometer o que o envio recusaria.
 */
export function vinculoUnicoParaEnvio(mapas: readonly VinculoBeds24[], imovelId: string, listaDeEnvio: readonly string[]): boolean {
  const escolhidos = mapas.filter(vinculoValidoParaEnvio).filter((m) => m.imovelId === imovelId || listaDeEnvio.includes(m.imovelId));
  return escolhidos.some((m) => m.imovelId === imovelId) && !vinculosAmbiguos(escolhidos);
}

const NOMES_SITUACAO: Record<SituacaoEnvio, string> = {
  ok: "Enviado e conferido", parcial: "Enviado com divergências ou falhas", erro: "Falhou", ocupada: "Outra execução em andamento",
  desligada: "Envio desligado", simulacao: "Simulação (nada enviado)", incerto: "Enviado, sem confirmação da releitura",
};
export const nomeSituacaoEnvio = (s: string) => NOMES_SITUACAO[s as SituacaoEnvio] ?? s;

type Plano = { imovelId: string; codigo: string; propertyId: string; roomId: string; fontePrecos: FontePrecos; linhas: LinhaPlano[]; ocupacao: OcupacaoDoPlano };

/** As reservas que o plano usou (a janela e a assinatura delas), para a conferência final antes da escrita. */
type OcupacaoDoPlano = { inicio: string; fim: string; assinatura: string };

/**
 * As reservas que ocupam o imóvel numa janela (`desde` < saída e entrada ≤ `ate`), a regra única do plano e da conferência
 * final do envio. `ignorar` e `paraOBeds24`: ver `planejarImovel`.
 */
async function ocupantesDoImovel(db: Db, org: string, imovelId: string, desde: string, ate: string, o: { ignorar?: ReservaIgnorada; paraOBeds24?: boolean }) {
  return db
    .select({ checkin: reservas.checkin, checkout: reservas.checkout, estado: reservas.estado })
    .from(reservas)
    .where(and(eq(reservas.organizacaoId, org), eq(reservas.imovelId, imovelId), lt(reservas.checkin, somarDias(ate, 1)), gt(reservas.checkout, desde), o.ignorar ? ne(reservas.id, o.ignorar.reservaId) : undefined, o.paraOBeds24 ? ne(reservas.fonte, "alteracao") : undefined));
}

/** A assinatura de uma ocupação: as reservas (entrada, saída e estado) em ordem, para saber se mudaram. */
const assinaturaDaOcupacao = (xs: readonly { checkin: string; checkout: string; estado: string }[]) =>
  xs.map((x) => `${x.checkin}|${x.checkout}|${x.estado}`).sort().join(";");

/**
 * Quarto Beds24 vinculado ao imóvel: exatamente um vínculo ativo com propriedade e quarto numéricos, e esse
 * quarto não ligado a outro imóvel — a mesma regra da importação. Vínculo ausente, repetido ou ambíguo = null:
 * nenhuma leitura nem estado enviado descreve o imóvel até o cadastro ser corrigido.
 */
export async function quartoVinculado(db: Db, org: string, imovelId: string): Promise<string | null> {
  return quartoDoVinculo(await listarMapeamentosBeds24(db, org), imovelId);
}

/** A mesma régua de `quartoVinculado`, sobre os vínculos já lidos (M8.3: a lista de imóveis em Integrações lê uma vez só). */
export function quartoDoVinculo(mapas: readonly VinculoBeds24[], imovelId: string): string | null {
  const validos = mapas.filter(vinculoValidoParaEnvio);
  const doImovel = validos.filter(m => m.imovelId === imovelId);
  if (doImovel.length !== 1) return null;
  return validos.some(m => m.imovelId !== imovelId && m.roomId === doImovel[0].roomId) ? null : doImovel[0].roomId;
}

/** Uma reserva que o plano não vê (M8.2d): a cotação da alteração dela não pode contar as próprias noites como ocupadas. */
export type ReservaIgnorada = { reservaId: string; inicio: string; fim: string };

/**
 * Tira de cada bloqueio vindo do Beds24 as noites [inicio, fim) da reserva ignorada (até o M8.3, a equipe fecha as datas
 * de uma reserva do site no Beds24 como bloqueio, que volta na importação); o que passa para fora dela continua. Os
 * bloqueios do SCL (equipe, proprietário) ficam inteiros.
 */
export function bloqueiosSemAReserva<B extends { inicio: string; fim: string; fonte: string }>(lista: readonly B[], ignorar: ReservaIgnorada | undefined): B[] {
  if (!ignorar) return [...lista];
  return lista.flatMap((b) => {
    if (b.fonte !== "beds24" || b.fim <= ignorar.inicio || b.inicio >= ignorar.fim) return [b];
    const partes: B[] = [];
    if (b.inicio < ignorar.inicio) partes.push({ ...b, fim: ignorar.inicio });
    if (b.fim > ignorar.fim) partes.push({ ...b, inicio: ignorar.fim });
    return partes;
  });
}

/**
 * A camada do preço importado do Beds24 (M3.11a) de um imóvel nas noites [inicio, fim], por noite. `em` = o dia da
 * importação no fuso do imóvel, que o motivo do plano cita.
 */
async function lerPrecosImportados(db: Db, org: string, imovelId: string, inicio: string, fim: string, fuso: string): Promise<Map<string, PrecoImportado>> {
  const linhas = await db
    .select({ data: precosImportados.data, preco: precosImportados.preco, minimo: precosImportados.minimoNoites, criadoEm: precosImportados.criadoEm })
    .from(precosImportados)
    .where(and(eq(precosImportados.organizacaoId, org), eq(precosImportados.imovelId, imovelId), gte(precosImportados.data, inicio), lte(precosImportados.data, fim)));
  return new Map(linhas.map((l) => [l.data, { preco: l.preco, minimo: l.minimo, em: hojeISO(fuso, l.criadoEm) }]));
}

/**
 * O que a revisão da importação (M3.11a) põe no lugar do cadastro (preço base e estadia máxima) e da camada importada para
 * mostrar o plano "depois de aprovar". Só no plano: nada é gravado. Campo ausente = o que está gravado.
 */
export type SubstituicaoDoPlano = { precoBase?: number | null; estadiaMaxima?: number | null; importados?: ReadonlyMap<string, PrecoImportado> };

/**
 * Planeja um imóvel a partir do banco (cadastro, períodos, preços importados, ocupação, observações e último envio).
 * O estado enviado vale só para o quarto Beds24 vinculado agora (`roomId`; sem informar, é lido do vínculo):
 * o que foi enviado a outro quarto não dá posse de bloqueio neste. `o.ignorar` (M8.2d): a reserva sai da ocupação e os
 * bloqueios do Beds24 perdem as noites dela — o mínimo, as sobras e a regra de 6/10 são calculados sem ela.
 * `o.paraOBeds24` (envio e prévia do envio): as reservas-pedido das alterações (M8.2d, fonte "alteracao") ficam de fora,
 * porque nunca vão ao Beds24 e podem vencer; o site continua contando essas noites como seguradas.
 * A camada do preço importado do Beds24 (M3.11a) é lida só com a fonte "preços automáticos do SCL" (nas outras o motor
 * não a usa); `o.substituir`: a conferência da revisão da importação, sem gravar nada.
 */
export async function planejarImovel(
  db: Db,
  org: string,
  regras: RegrasCalendario,
  imovel: { id: string; fuso: string; roomId?: string | null },
  agora: Date,
  intervalo?: { inicio: string; fim: string },
  o: { ignorar?: ReservaIgnorada; paraOBeds24?: boolean; substituir?: SubstituicaoDoPlano } = {},
) {
  const hoje = hojeISO(imovel.fuso, agora);
  const roomId = imovel.roomId !== undefined ? imovel.roomId : await quartoVinculado(db, org, imovel.id);
  const inicio = intervalo?.inicio && intervalo.inicio > hoje ? intervalo.inicio : hoje;
  const fim = intervalo?.fim ?? somarDias(hoje, regras.horizonteDias - 1);
  const [detalhes, periodos] = await Promise.all([lerDetalhes(db, org, imovel.id), listarPeriodos(db, org, imovel.id)]);
  const troca = o.substituir ?? {};
  const regrasVenda = regrasDeVenda({
    ...detalhes,
    ...(troca.precoBase !== undefined ? { precoBase: troca.precoBase } : {}),
    ...(troca.estadiaMaxima !== undefined ? { estadiaMaxima: troca.estadiaMaxima } : {}),
  });
  const importados = detalhes.fontePrecos !== "scl" ? undefined : (troca.importados ?? (await lerPrecosImportados(db, org, imovel.id, inicio, fim, imovel.fuso)));
  // Ocupação carregada até onde o maior mínimo aplicável alcança (mínimo 60 dias): uma reserva distante
  // ainda encurta as sobras; sem isso uma noite sairia com o mínimo cheio apesar de a janela livre ser menor.
  // O mínimo importado do Beds24 (M3.11a) também conta.
  const maiorMinimo = Math.max(
    ...regras.minimoPorDia, regrasVenda.estadiaMinima ?? 0, regras.janelaFeriado.estadiaMinima, ...regras.eventos.map(e => e.estadiaMinima ?? 0), ...periodos.map(x => x.estadiaMinima ?? 0),
    ...[...(importados?.values() ?? [])].map(x => x.minimo ?? 0),
  );
  const fimDados = somarDias(fim, Math.min(400, Math.max(60, maiorMinimo)));
  // Reservas também do período inteiro de cada feriadão/evento que toca as noites (regra de 6/10).
  const daRegra = intervaloDasReservas(regras, imovel.id, inicio, fim);
  const ateReservas = daRegra.fim > fimDados ? daRegra.fim : fimDados;
  const ignorar = o.ignorar;
  const [ocupantes, impedimentos, observacoes, enviados] = await Promise.all([
    ocupantesDoImovel(db, org, imovel.id, daRegra.inicio, ateReservas, o),
    db.select({ inicio: bloqueios.inicio, fim: bloqueios.fim, fonte: bloqueios.fonte }).from(bloqueios).where(and(eq(bloqueios.organizacaoId, org), eq(bloqueios.imovelId, imovel.id), lt(bloqueios.inicio, somarDias(fimDados, 1)), gt(bloqueios.fim, inicio))).then((l) => bloqueiosSemAReserva(l, ignorar)),
    roomId === null ? [] : db.select().from(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, org), eq(beds24Calendario.imovelId, imovel.id), eq(beds24Calendario.roomId, roomId), gte(beds24Calendario.data, inicio), lte(beds24Calendario.data, fim))).orderBy(asc(beds24Calendario.data)),
    roomId === null ? [] : db.select().from(beds24CalendarioEnviado).where(and(eq(beds24CalendarioEnviado.organizacaoId, org), eq(beds24CalendarioEnviado.imovelId, imovel.id), eq(beds24CalendarioEnviado.roomId, roomId), gte(beds24CalendarioEnviado.data, inicio), lte(beds24CalendarioEnviado.data, fim))),
  ]);
  const linhas = planejarCalendario({
    imovel: { id: imovel.id, regras: regrasVenda, periodos, pisos: [detalhes.pisoUltimaHora1, detalhes.pisoUltimaHora2], fontePrecos: detalhes.fontePrecos, importados },
    regras, hoje, inicio, fim, fimDados, reservas: ocupantes, bloqueios: impedimentos, observacoes, enviados,
  });
  const ocupacao: OcupacaoDoPlano = { inicio: daRegra.inicio, fim: ateReservas, assinatura: assinaturaDaOcupacao(ocupantes) };
  return { hoje, inicio, fim, linhas, regras: regrasVenda, pisos: [detalhes.pisoUltimaHora1, detalhes.pisoUltimaHora2] as const, fontePrecos: detalhes.fontePrecos, ocupacao };
}

/**
 * Grava a leitura do calendário como observação local das noites (a mais nova vale), presa ao quarto lido. Antes, a leitura
 * que vai ser regravada fica numa cópia datada (M3.11a), na mesma transação: `antes_da_simulacao` ou `antes_do_envio`.
 */
async function gravarObservacoes(tx: Db, org: string, imovelId: string, roomId: string, dias: Iterable<DiaCalendario>, observadoEm: Date, copia: { motivo: MotivoCopiaCalendario; autorId: string | null }) {
  const lista = [...dias];
  if (!lista.length) return;
  await copiarLeitura(tx, org, imovelId, copia.motivo, { autorId: copia.autorId });
  for (const d of lista) {
    await tx.insert(beds24Calendario).values({ organizacaoId: org, imovelId, data: d.data, roomId, livres: d.livres, preco: d.preco, minimoNoites: d.minimoNoites, maximoNoites: d.maximoNoites, bloqueio: d.bloqueio, observadoEm })
      .onConflictDoUpdate({ target: [beds24Calendario.organizacaoId, beds24Calendario.imovelId, beds24Calendario.data], set: { roomId, livres: d.livres, preco: d.preco, minimoNoites: d.minimoNoites, maximoNoites: d.maximoNoites, bloqueio: d.bloqueio, observadoEm } });
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
  const observacoes = new Map((await tx.select().from(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, org), eq(beds24Calendario.imovelId, imovelId), eq(beds24Calendario.roomId, roomId), inArray(beds24Calendario.data, datas)))).map(o => [o.data, o]));
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
  const [exec] = await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: agora, modo: o.modo, automatica: o.automatica === true, situacao: "iniciando", credencial: o.credencial ?? "" }).returning({ id: beds24Envios.id });
  const avisos: string[] = [];
  let totalAvisos = 0;
  const aviso = (s: string) => { totalAvisos++; if (avisos.length < 100) avisos.push(s.slice(0, 300)); };
  const dataBr = (d: string) => d.split("-").reverse().join("/");
  // "Ocupada" diz a causa: a trava (outra importação ou envio) ou uma escrita fora da trava (calendário ou reserva do site).
  const ocupada = (causa: CausaEscritaBeds24 | "trava") => ({
    pronto: {
      ...base("ocupada", causa === "trava" ? "Já há um envio ou uma importação do Beds24 em andamento. Aguarde e atualize a página." : causa === "reserva" ? MENSAGEM_RESERVA_EM_ANDAMENTO_EQUIPE : MENSAGEM_ENVIO_EM_ANDAMENTO),
      ok: false,
      causa: CAUSA_EM_ANDAMENTO[causa],
    },
  });
  // Instantes distintos dentro da execução: leitura inicial (agora) < envio (agora+1) < releitura (agora+2).
  // Assim a leitura feita antes da escrita nunca passa por leitura posterior ao envio.
  const instanteEnvio = new Date(agora.getTime() + 1);
  const instanteReleitura = new Date(agora.getTime() + 2);
  let leituraAtualFalhou = false;
  // Imóveis cujas reservas mudaram entre o plano e a conferência logo depois da escrita: o envio deles é refeito em
  // seguida, numa execução nova (uma vez), com o plano das reservas de agora.
  const refazer = new Set<string>();
  let r: ResultadoEnvio;
  try {
    const fase1 = await db.transaction(async (tx): Promise<Fase1> => {
      await tx.execute(sql`set local lock_timeout = '15s'`);
      // Mesma trava da importação: importação e envio nunca rodam ao mesmo tempo sobre o calendário local.
      if (!(await tentarTravaBeds24(tx, org))) return ocupada("trava");
      // Outra execução entre a escrita externa e o registro final (ou interrompida há pouco) também bloqueia, e também uma
      // reserva do site sendo enviada (M8.3): dois escritores no Beds24 nunca ao mesmo tempo.
      const emAndamento = await escritaBeds24EmAndamento(tx, org, { agora, excetoEnvioId: exec.id });
      if (emAndamento) return ocupada(emAndamento);
      await tx.update(beds24Envios).set({ situacao: "executando" }).where(eq(beds24Envios.id, exec.id));

      const regras = await lerRegrasCalendario(tx, org);
      const mapas = (await listarMapeamentosBeds24(tx, org)).filter(vinculoValidoParaEnvio);
      const pedidos = o.imovelIds ? [...new Set(o.imovelIds)] : null;
      if (pedidos?.some(id => !regras.envio.imoveis.includes(id))) throw new ErroBeds24("Este imóvel não está com envio ligado em Configurações → Calendário e preços.", "configuracao");
      const escolhidos = mapas.filter(m => regras.envio.imoveis.includes(m.imovelId) && (!pedidos || pedidos.includes(m.imovelId)));
      if (pedidos?.some(id => !escolhidos.some(m => m.imovelId === id))) throw new ErroBeds24("Imóvel sem vínculo Beds24 ativo (propriedade e quarto numéricos). Confira em Integrações.", "configuracao");
      if (!escolhidos.length) throw new ErroBeds24("Nenhum imóvel com envio ligado e vínculo Beds24 ativo. Ligue o envio por imóvel em Configurações → Calendário e preços.", "configuracao");
      if (vinculosAmbiguos(escolhidos)) throw new ErroBeds24("Cada imóvel deve estar ligado a um único quarto Beds24. Remova os vínculos duplicados antes de enviar.", "configuracao");
      // Quais imóveis esta execução incluiu (e com que vínculo), mesmo que nenhuma noite precise mudar: é o que conta como
      // "último envio" por imóvel. Nascem pendentes: só o fim da execução dá o veredito — interrompida, nunca vale como sucesso.
      await tx.insert(beds24EnvioImoveis).values(escolhidos.map(m => ({ organizacaoId: org, envioId: exec.id, imovelId: m.imovelId, propertyId: m.propertyId, roomId: m.roomId, falha: VEREDITO_PENDENTE })));
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
            await gravarObservacoes(tx, org, m.imovelId, m.roomId, dias, agora, { motivo: o.modo === "simulacao" ? "antes_da_simulacao" : "antes_do_envio", autorId: o.autorId ?? null });
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
        const p = await planejarImovel(tx, org, regras, { id: m.imovelId, fuso: fusos.get(m.imovelId) ?? "America/Sao_Paulo", roomId: m.roomId }, agora, undefined, { paraOBeds24: true });
        planos.push({ imovelId: m.imovelId, codigo: m.codigo, propertyId: m.propertyId, roomId: m.roomId, fontePrecos: p.fontePrecos, linhas: p.linhas, ocupacao: p.ocupacao });
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
        // Conferência final da fonte de preços (M3.9): a ficha do imóvel não espera o envio, então a fonte pode ter
        // mudado entre o plano e a escrita — por exemplo para "preços definidos no Beds24", quando a carga planejada
        // ainda traz preços e sobrescreveria os do proprietário. Fonte diferente da planejada: nada é escrito.
        const fonteAgora = (await fontesDePrecosDosImoveis(db, org, [p.imovelId])).get(p.imovelId) ?? "scl";
        if (fonteAgora !== p.fontePrecos) {
          res.falha = "Fonte de preços do imóvel alterada durante o envio: nada foi escrito para este imóvel nesta execução; o próximo envio replaneja.";
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
        // Conferência final das reservas: uma reserva confirmada, cancelada ou alterada (M8.2d: a alteração aplicada muda as
        // datas da reserva, e a reserva-pedido dela fica fora do plano) entre o plano e a escrita mudaria o mínimo e as
        // sobras; nada é escrito para o imóvel nesta execução.
        const ocupacaoDeAgora = async () => assinaturaDaOcupacao(await ocupantesDoImovel(db, org, p.imovelId, p.ocupacao.inicio, p.ocupacao.fim, { paraOBeds24: true }));
        if ((await ocupacaoDeAgora()) !== p.ocupacao.assinatura) {
          res.falha = "Reservas do imóvel alteradas durante o envio: nada foi escrito para este imóvel nesta execução; o envio dele é refeito em seguida.";
          aviso(`Imóvel ${p.codigo}: ${res.falha}`);
          refazer.add(p.imovelId);
          continue;
        }
        try {
          const [resposta] = await escritor!.escreverCalendario([{ roomId: p.roomId, faixas: faixasDeEnvio(p.linhas) }]);
          if (!resposta?.ok) res.falha = resposta?.erro || "Beds24 recusou a escrita.";
          else res.enviadas = p.linhas.filter(l => l.acao === "enviar").length;
        } catch (e) {
          res.falha = mensagemSeguraBeds24(e);
        }
        if (res.falha) aviso(`Imóvel ${p.codigo}: envio falhou — ${res.falha}. O quarto foi relido para registrar o que ficou gravado.`);
        // E de novo logo depois da escrita: uma reserva que mudou entre a conferência e a escrita deixou o plano escrito
        // velho. Tudo o que mudar depois desta conferência já é posterior à escrita (vale para o próximo envio).
        else if ((await ocupacaoDeAgora()) !== p.ocupacao.assinatura) {
          aviso(`Imóvel ${p.codigo}: reservas do imóvel alteradas durante a escrita no Beds24; o envio dele é refeito em seguida com as reservas de agora.`);
          refazer.add(p.imovelId);
        }
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
          await gravarObservacoes(tx, org, p.imovelId, p.roomId, porData.values(), instanteReleitura, { motivo: "antes_do_envio", autorId: o.autorId ?? null });
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
  // Veredito por imóvel (quarto inacessível à credencial, moeda, leitura incompleta, escrita recusada): o portal lê daqui
  // para não prometer envio a um imóvel que a execução deixa de fora. Imóvel sem resultado (execução interrompida por
  // exceção depois da fase 1) fica com a mensagem do erro, nunca em branco.
  // Só conta como aplicado o imóvel sem falha, sem noite divergente e sem noite pendente de releitura.
  const veredito = (i: ImovelEnviado) =>
    i.falha ? i.falha : i.divergentes ? `${i.divergentes} noite(s) divergente(s) na releitura: o Beds24 não ficou igual ao enviado.` : i.pendentes ? `${i.pendentes} noite(s) sem confirmação na releitura.` : "";
  for (const linha of await db.select({ imovelId: beds24EnvioImoveis.imovelId }).from(beds24EnvioImoveis).where(eq(beds24EnvioImoveis.envioId, exec.id))) {
    const resultado = r.imoveis.find(i => i.imovelId === linha.imovelId);
    const falha = resultado ? veredito(resultado) : `Execução não concluída para este imóvel: ${r.mensagem}`;
    await db.update(beds24EnvioImoveis).set({ falha: falha.slice(0, 300) }).where(and(eq(beds24EnvioImoveis.envioId, exec.id), eq(beds24EnvioImoveis.imovelId, linha.imovelId)));
  }
  // O envio dos imóveis cujas reservas mudaram durante esta execução é refeito agora (execução nova, com histórico
  // próprio), depois de esta terminar e soltar a trava. Uma vez só: mudou de novo, fica para o próximo envio.
  if (refazer.size && o.modo === "envio" && !o.refazendo) {
    const codigos = new Map(r.imoveis.map((i) => [i.imovelId, i.codigo]));
    const r2 = await enviarCalendarioBeds24(db, org, leitor, escritor, { ...o, imovelIds: [...refazer], refazendo: true, agora: new Date(agora.getTime() + 3) });
    const nota = `Envio refeito para ${[...refazer].map((id) => codigos.get(id) ?? id).join(", ")} (reservas alteradas durante o envio): ${r2.mensagem}`.slice(0, 300);
    r = { ...r, avisos: r.avisos.length < 100 ? [...r.avisos, nota] : r.avisos, totalAvisos: r.totalAvisos + 1, refeito: r2 };
    await db.update(beds24Envios).set({ avisos: r.avisos }).where(eq(beds24Envios.id, exec.id));
  }
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
