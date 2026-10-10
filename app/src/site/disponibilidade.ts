/**
 * Disponibilidade e cotação reais do site público (M7.2). Uma noite só é "disponível" quando
 * (1) não há reserva nem bloqueio no SCL, (2) a última leitura do Beds24 é recente e informa
 * unidade livre e (3) as regras de venda permitem a estadia. Qualquer lacuna vira
 * "a confirmar" — nunca "disponível" por omissão. O valor usa os mesmos preços por noite que
 * o SCL envia ao Beds24 (motor de calendário: eventos, feriadões, última hora) mais as taxas
 * do cadastro — esse é o valor cheio. Sobre ele entra o desconto único do site (M12.1, a parte do
 * hóspede do modelo B, em Configurações → Marketplace), igual para qualquer contrato. Nada é
 * gravado: cotação persistida e hold são o M8.1.
 */
import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { planejarImovel } from "@/calendario/envio";
import type { LinhaPlano, ObservacaoPlano } from "@/calendario/motor";
import { lerRegrasCalendario, type RegrasCalendario } from "@/calendario/regras-config";
import { bloqueios, cotacoes, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { listarPeriodos } from "@/imoveis/detalhes";
import { type Cotacao, cotarNoites, diasEntre, verificarEstadia } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";
import { descontoDoSite } from "@/marketplace/precos";
import { lerPrecosMarketplace } from "@/marketplace/precos-config";
import { cotacaoEmCarencia } from "@/pagamentos/andamento";
import { dataValida, ESTADOS_OCUPANTES } from "@/reservas/regras";
import type { PedidoConsulta } from "./site";

export type SituacaoDisponibilidade = "disponivel" | "indisponivel" | "a_confirmar" | "invalida";
export type Disponibilidade = {
  situacao: SituacaoDisponibilidade;
  /** Em linguagem simples, para o visitante. */
  motivos: string[];
  noites: number;
  /** Só quando a estadia é possível (disponível ou a confirmar) e há preço em todas as noites; senão null. */
  cotacao: CotacaoSite | null;
  /** Leitura mais antiga do Beds24 entre as noites; null quando alguma noite não tem leitura. */
  leituraEm: Date | null;
};

/** Valor por partes como o site mostra. `valorCheio` = diárias + limpeza + hóspede extra; `total` = valor cheio − desconto. */
export type CotacaoSite = Pick<Cotacao, "diarias" | "limpeza" | "hospedeExtra"> & {
  valorCheio: number | null;
  /** Desconto único do site (M12.1), em centavos; zero quando não há margem ou o valor está a confirmar. */
  desconto: number;
  total: number | null;
};

const dataBr = (d: string) => d.split("-").reverse().join("/");

/**
 * Critério de noite ocupada do site, num lugar só (a consulta e o calendário do site usam o mesmo). Leitura do
 * Beds24 "atual": dentro da validade do site e não anterior ao último envio do SCL para a data (como no motor):
 * depois de uma escrita sem releitura, a leitura anterior já não descreve o Beds24.
 */
type NoiteLida = { observacao: { observadoEm: Date } | null; enviado: { enviadoEm: Date } | null };
/** Hora (ms) da leitura mais antiga que ainda vale, pela validade em Configurações → Calendário. */
export const limiteDaLeitura = (regras: Pick<RegrasCalendario, "site">, agora: Date) => agora.getTime() - regras.site.validadeLeituraHoras * 3_600_000;
export const leituraAtual = (l: NoiteLida | undefined, limite: number) =>
  !!l?.observacao && l.observacao.observadoEm.getTime() >= limite && (!l.enviado || l.observacao.observadoEm.getTime() >= l.enviado.enviadoEm.getTime());
/** Leitura que fecha a noite: blackout (mesmo sem unidades informadas) ou nenhuma unidade livre. */
export const fechadaNaLeitura = (o: Pick<ObservacaoPlano, "bloqueio" | "livres">) => o.bloqueio === "blackout" || o.livres === 0;
/** Noite certamente ocupada: reserva ou bloqueio no SCL, ou leitura atual que fecha a noite. Sem leitura atual, só o SCL decide. */
export const noiteOcupada = (l: Pick<LinhaPlano, "livresSeguidas" | "observacao" | "enviado">, limite: number) =>
  l.livresSeguidas === 0 || (leituraAtual(l, limite) && fechadaNaLeitura(l.observacao!));

export async function consultarDisponibilidade(db: Db, organizacaoId: string, p: PedidoConsulta, agora = new Date()): Promise<Disponibilidade> {
  const vazio = (situacao: SituacaoDisponibilidade, motivos: string[], noites = 0): Disponibilidade => ({ situacao, motivos, noites, cotacao: null, leituraEm: null });
  const [imovel] = /^[\w-]{1,40}$/.test(p.imovel)
    ? await db.select({ id: imoveis.id, fuso: imoveis.fuso, capacidade: imoveis.capacidade }).from(imoveis).where(and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.codigo, p.imovel), eq(imoveis.publico, true), eq(imoveis.ativo, true)))
    : [];
  if (!imovel) return vazio("invalida", ["Escolha um apartamento."]);
  const hoje = hojeISO(imovel.fuso, agora);
  const erros: string[] = [];
  if (!dataValida(p.entrada)) erros.push("Informe a data de entrada.");
  else if (p.entrada < hoje) erros.push("A entrada não pode ser antes de hoje.");
  if (!dataValida(p.saida)) erros.push("Informe a data de saída.");
  else if (dataValida(p.entrada) && p.saida <= p.entrada) erros.push("A saída precisa ser depois da entrada.");
  const hospedes = /^\d+$/.test(p.hospedes) ? Number(p.hospedes) : NaN;
  if (!Number.isInteger(hospedes) || hospedes < 1) erros.push("Informe quantas pessoas.");
  else if (imovel.capacidade && hospedes > imovel.capacidade) erros.push(`Este apartamento recebe até ${imovel.capacidade} pessoas.`);
  if (erros.length) return vazio("invalida", erros);

  const noites = diasEntre(p.entrada, p.saida);
  const [regras, precos] = await Promise.all([lerRegrasCalendario(db, organizacaoId), lerPrecosMarketplace(db, organizacaoId)]);
  if (noites > regras.site.maximoNoitesConsulta) return vazio("a_confirmar", [`Para estadias acima de ${regras.site.maximoNoitesConsulta} noites, fale com a equipe.`], noites);
  // O plano cobre as noites e o dia de saída: a restrição de saída e o último envio do SCL daquela data
  // vêm do mesmo lugar que os das noites.
  const [plano, periodos] = await Promise.all([planejarImovel(db, organizacaoId, regras, imovel, agora, { inicio: p.entrada, fim: p.saida }), listarPeriodos(db, organizacaoId, imovel.id)]);
  const linhas = plano.linhas.slice(0, noites);
  const saida = plano.linhas[noites];
  const motivos = new Set<string>();
  let aConfirmar = false;

  // Regras de venda: mínimo/máximo vêm do motor (já considera semana normal, eventos e sobras);
  // antecedência, horizonte e dias de entrada/saída vêm do cadastro.
  const entrada = linhas[0];
  // Mínimo de negócio: o do motor (semana normal, eventos, sobras). Se a regra supera o máximo, o motor
  // manda o máximo ao Beds24 e avisa no painel; para o site vale a regra original, e a estadia fica
  // impossível até o cadastro ser corrigido — nunca "disponível" por causa do ajuste de envio.
  const minimo = entrada ? (entrada.minimoRegra !== null && entrada.minimoRegra > entrada.maximoEnviar ? entrada.minimoRegra : entrada.minimoEnviar) : null;
  if (minimo !== null && noites < minimo) motivos.add(`Para entrada em ${dataBr(p.entrada)}, o mínimo é de ${minimo} ${minimo === 1 ? "noite" : "noites"}.`);
  if (entrada && noites > entrada.maximoEnviar) motivos.add(`Máximo de ${entrada.maximoEnviar} noites por estadia.`);
  for (const problema of verificarEstadia({ ...plano.regras, estadiaMinima: null, estadiaMaxima: null }, periodos.map((x) => ({ ...x, estadiaMinima: null })), p.entrada, p.saida, hoje)) motivos.add(problema);

  // Restrições de entrada/saída do calendário Beds24: valem na data de entrada e na de saída,
  // só com leitura atual (leitura velha vira "a confirmar", como nas noites).
  // Restrição desconhecida (ex.: "exception") ou não informada na leitura (null) nunca vira "disponível".
  const limite = limiteDaLeitura(regras, agora);
  const conhecidas = new Set<string | null>(["none", "noCheckIn", "noCheckOut", "noCheckInOrCheckOut"]);
  const atual = (l: NoiteLida | undefined) => leituraAtual(l, limite);
  const restricao = (l: { observacao: { bloqueio: string | null; observadoEm: Date } | null; enviado: { enviadoEm: Date } | null } | undefined, fecha: readonly string[], motivo: string) => {
    if (!atual(l)) { aConfirmar = true; return; }
    const bloqueio = l!.observacao!.bloqueio;
    if (fecha.includes(bloqueio ?? "")) motivos.add(motivo);
    else if (!conhecidas.has(bloqueio) && bloqueio !== "blackout") aConfirmar = true;
  };
  restricao(entrada, ["noCheckIn", "noCheckInOrCheckOut"], `Entrada não permitida em ${dataBr(p.entrada)}.`);
  restricao(saida, ["noCheckOut", "noCheckInOrCheckOut"], `Saída não permitida em ${dataBr(p.saida)}.`);

  // Ocupação e leitura do Beds24, noite a noite. "Agenda conferida em" é a leitura mais antiga que
  // participou da decisão: as noites e o dia de saída (a restrição de saída também conta). Sem leitura
  // de qualquer um deles, não há hora a mostrar.
  let leituraEm: Date | null = null;
  let semLeitura = !saida?.observacao;
  const maisAntiga = (o: { observadoEm: Date } | null | undefined) => { if (o && (!leituraEm || o.observadoEm < leituraEm)) leituraEm = o.observadoEm; };
  maisAntiga(saida?.observacao);
  // Uma data pode estar ocupada no SCL e no Beds24 ao mesmo tempo (reserva importada): conta uma vez.
  const ocupadas = new Set<string>();
  for (const l of linhas) {
    if (noiteOcupada(l, limite)) ocupadas.add(l.data);
    const o = l.observacao;
    if (!o || !atual(l)) {
      if (!o) semLeitura = true;
      aConfirmar = true;
    } else if (!fechadaNaLeitura(o) && (o.livres === null || !conhecidas.has(o.bloqueio))) aConfirmar = true;
    maisAntiga(o);
  }
  if (ocupadas.size) {
    const lista = [...ocupadas];
    motivos.add(lista.length === noites ? "Essas datas já estão reservadas." : `Há noites já reservadas nessas datas (${lista.slice(0, 3).map(dataBr).join(", ")}${lista.length > 3 ? "…" : ""}).`);
  }
  if (motivos.size) return { situacao: "indisponivel", motivos: [...motivos], noites, cotacao: null, leituraEm: semLeitura ? null : leituraEm };

  // Fonte de preços do imóvel (M3.9): com preços do Beds24, só vale o preço de uma leitura atual (dentro da
  // validade e posterior ao último envio); leitura velha ou sem preço deixa a noite sem valor — nunca o
  // cadastro como palpite. Nas outras fontes vale o preço final esperado do motor.
  const precoDaNoite = (l: (typeof linhas)[number]) => (plano.fontePrecos === "beds24" ? (atual(l) ? (l.observacao?.preco ?? null) : null) : l.precoFinalEsperado);
  const precosNoites = linhas.map((l) => ({ data: l.data, valor: precoDaNoite(l), fonte: l.fontePreco }));
  const cot = cotarNoites(plano.regras, precosNoites, hospedes);
  // Preço zero numa noite é aviso do motor ("conferir"), não diária grátis; taxa de limpeza não
  // cadastrada também não vira zero para o visitante. Nos dois casos o valor fica a confirmar.
  const comValor = precosNoites.every((p) => p.valor !== null && p.valor > 0);
  // Preços do Beds24 sem leitura atual (ou sem preço na leitura): a data não é vendida pelo site, fica a confirmar (M3.9).
  const semPrecoNaFonte = plano.fontePrecos === "beds24" && !comValor;
  const diarias = comValor ? cot.diarias : null;
  const valorCheio = comValor && cot.total !== null && plano.regras.taxaLimpeza !== null ? cot.total : null;
  // Desconto único do site (M12.1): a parte do hóspede da margem do modelo B, calculada sobre o valor cheio.
  // Sem valor cheio não há desconto a mostrar; sem margem (taxa do pagamento ≥ taxa da OTA) o desconto é zero.
  const desconto = valorCheio === null ? 0 : descontoDoSite(valorCheio, precos);
  const total = valorCheio === null ? null : valorCheio - desconto;
  const avisos: string[] = [];
  if (aConfirmar) avisos.push("Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa.");
  // Capacidade não cadastrada: não dá para saber se as pessoas cabem, então nada é confirmado por omissão.
  const semCapacidade = !imovel.capacidade;
  if (semCapacidade) avisos.push("A capacidade deste apartamento ainda não foi cadastrada: confirmamos na conversa se o número de pessoas cabe.");
  if (total === null) avisos.push(semPrecoNaFonte ? "O preço dessas datas ainda não foi confirmado: confirmamos na conversa." : "O valor dessas datas é confirmado na conversa.");
  return {
    situacao: aConfirmar || semCapacidade || semPrecoNaFonte ? "a_confirmar" : "disponivel",
    motivos: avisos,
    noites,
    cotacao: { diarias, limpeza: cot.limpeza, hospedeExtra: cot.hospedeExtra, valorCheio, desconto, total },
    leituraEm: semLeitura ? null : leituraEm,
  };
}

/** Conflito vindo da leitura do calendário externo (e não de uma reserva ou bloqueio do SCL). */
export const CONFLITO_AGENDA_EXTERNA = "agenda_externa";
export type NoitesLivres = { livres: true } | { livres: false; motivo: "ocupada" | "sem_leitura"; conflito: string | null };

/**
 * Só ocupação (M8.2a), sem regras de venda, preço nem publicação: as noites [checkin, checkout) estão livres no
 * SCL — nenhuma reserva que ocupa (confirmada, pendente, pedido) nem bloqueio, fora `excetoReservaId` — e, com
 * `exigirLeituraAtual`, também livres na leitura atual do Beds24 (sem leitura atual = não dá para conferir).
 * Pedido do site já vencido (prazo e carência passados, sem pagamento que segure as datas) não ocupa: a
 * conferência do pagamento nunca vence holds de outras cotações, só os ignora. `conflito` = código da reserva
 * que ocupa ("bloqueio", ou `CONFLITO_AGENDA_EXTERNA` quando é a leitura do canal que fecha a noite).
 */
export async function noitesLivres(
  db: Db,
  organizacaoId: string,
  imovelId: string,
  checkin: string,
  checkout: string,
  o: { excetoReservaId?: string | null; exigirLeituraAtual?: boolean; agora?: Date } = {},
): Promise<NoitesLivres> {
  const agora = o.agora ?? new Date();
  const [imovel] = await db.select({ id: imoveis.id, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.id, imovelId), eq(imoveis.organizacaoId, organizacaoId)));
  if (!imovel || !dataValida(checkin) || !dataValida(checkout) || checkout <= checkin) return { livres: false, motivo: "sem_leitura", conflito: null };
  const outras = await db
    .select({ id: reservas.id, codigo: reservas.codigo, estado: reservas.estado, fonte: reservas.fonte, cotacaoId: cotacoes.id, cotacaoEstado: cotacoes.estado, holdAte: cotacoes.holdAte })
    .from(reservas)
    .leftJoin(cotacoes, eq(cotacoes.reservaId, reservas.id))
    .where(
      and(
        eq(reservas.organizacaoId, organizacaoId),
        eq(reservas.imovelId, imovelId),
        lt(reservas.checkin, checkout),
        gt(reservas.checkout, checkin),
        inArray(reservas.estado, [...ESTADOS_OCUPANTES]),
        o.excetoReservaId ? ne(reservas.id, o.excetoReservaId) : undefined,
      ),
    )
    .orderBy(reservas.checkin);
  for (const r of outras) {
    // Pedido do site cujo prazo (e a carência de um pagamento em andamento) já passou: vence sozinho, não ocupa.
    if (r.estado === "pedido" && r.fonte === "site" && r.cotacaoId && r.cotacaoEstado === "segurada" && r.holdAte && r.holdAte.getTime() <= agora.getTime()) {
      if (!(await cotacaoEmCarencia(db, r.cotacaoId, r.holdAte, agora))) continue;
    }
    return { livres: false, motivo: "ocupada", conflito: r.codigo };
  }
  const [bloqueio] = await db
    .select({ id: bloqueios.id })
    .from(bloqueios)
    .where(and(eq(bloqueios.organizacaoId, organizacaoId), eq(bloqueios.imovelId, imovelId), lt(bloqueios.inicio, checkout), gt(bloqueios.fim, checkin)))
    .limit(1);
  if (bloqueio) return { livres: false, motivo: "ocupada", conflito: "bloqueio" };
  if (!o.exigirLeituraAtual) return { livres: true };
  // Leitura atual do Beds24 noite a noite (a mesma régua do site); só o lado do Beds24: o do SCL já foi conferido acima.
  const regras = await lerRegrasCalendario(db, organizacaoId);
  const plano = await planejarImovel(db, organizacaoId, regras, imovel, agora, { inicio: checkin, fim: checkout });
  const porData = new Map(plano.linhas.map((l) => [l.data, l]));
  const limite = limiteDaLeitura(regras, agora);
  for (let t = Date.parse(`${checkin}T00:00:00Z`); t < Date.parse(`${checkout}T00:00:00Z`); t += 86_400_000) {
    const l = porData.get(new Date(t).toISOString().slice(0, 10));
    if (!l || !leituraAtual(l, limite)) return { livres: false, motivo: "sem_leitura", conflito: null };
    if (fechadaNaLeitura(l.observacao!)) return { livres: false, motivo: "ocupada", conflito: CONFLITO_AGENDA_EXTERNA };
    if (l.observacao!.livres === null) return { livres: false, motivo: "sem_leitura", conflito: null };
  }
  return { livres: true };
}
