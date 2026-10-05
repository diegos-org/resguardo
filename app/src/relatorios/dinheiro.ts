/**
 * O dinheiro do relatório mensal (M5.7), regras puras: "como chega até você" e a conciliação "do extrato dos canais ao
 * seu resultado". O resultado do mês é por noite (competência); o dinheiro segue a **data em que o canal pagou**
 * (M4.12: Airbnb no dia seguinte ao check-in, direto ao proprietário; Booking, site e direta pela data do recebimento
 * registrado). A ponte entre os dois é escrita, nunca suposta: noite do mês paga antes, noite de outro mês paga neste,
 * noite ainda a receber. Nenhuma chave Pix completa: a transferência cita a chave cadastrada no portal.
 */
import type { OrigemReserva } from "@/db/schema";
import { formatBRL } from "@/lib/money";
import type { Rodape } from "@/portal/rodape";
import type { QuemRecebeParte, RepasseDaParte, SituacaoParte } from "@/repasses/extrato";
import type { PagamentoDaReserva } from "@/repasses/inicio";
import { NOMES_ORIGEM } from "@/reservas/regras";
import { limitesDe, type MesISO, nomeDoMes } from "./metricas";

/** A parte do proprietário numa reserva e num mês, com os componentes do livro daquele mês (parte do mês). */
export type ParteDoRelatorio = {
  reservaId: string;
  codigo: string;
  /** Código no canal (vazio quando não há). */
  codigoCanal: string;
  hospede: string;
  canal: OrigemReserva;
  checkin: string;
  checkout: string;
  /** Mês de competência ("AAAA-MM"). */
  mes: MesISO;
  noitesNoMes: number;
  noitesTotal: number;
  bruto: number;
  /** Taxa do canal, positiva (o livro guarda negativa). */
  taxa: number;
  comissao: number;
  suaParte: number;
  quemRecebe: QuemRecebeParte;
  situacao: SituacaoParte;
  motivo: string;
  pagamento: PagamentoDaReserva | null;
  repasse: RepasseDaParte | null;
};

/** De onde vem a linha: o canal pagou direto, um repasse antecipado (ou acerto por fora), o fechamento, ou valor a liberar. */
export type OrigemLinha = "canal" | "antecipado" | "fechamento" | "a_liberar";
/** Qual é o aviso, para a capa completar com o que o proprietário precisa (ou não precisa) fazer. */
export type AvisoDaLinha = "a_liberar" | "voce_transfere" | "em_conferencia" | "sem_prazo_do_canal";
export type Linha = { texto: string; valor: number; tipo: "normal" | "aviso" | "info"; origem: OrigemLinha; aviso?: AvisoDaLinha };

export const dataBr = (d: string) => d.split("-").reverse().join("/");
/** "29/9" (o ano está no título). */
export const dataCurta = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
export const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] ?? "";
const nomeOuHospede = (n: string) => primeiroNome(n) || "hóspede";
export const nomeDoCanal = (c: OrigemReserva, empresa: string) => (c === "site" ? `Site ${empresa}` : c === "direta" ? "Reserva direta" : NOMES_ORIGEM[c]);
/** Quem paga a reserva: o canal, ou o próprio hóspede quando a reserva é direta ou pelo site. */
const quemPaga = (c: OrigemReserva, empresa: string) => (c === "site" || c === "direta" ? "o hóspede" : `o ${nomeDoCanal(c, empresa)}`);
const soma = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
const unicos = <T>(xs: readonly T[]) => [...new Set(xs)];
const lista = (xs: readonly string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}`);
const reservaDe = (p: ParteDoRelatorio) => `${nomeOuHospede(p.hospede)} (${dataCurta(p.checkin)} → ${dataCurta(p.checkout)})`;
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

const emMes = (data: string | undefined | null, mes: MesISO) => Boolean(data && data.slice(0, 7) === mes);
/** A data em que o dinheiro do repasse saiu (o Pix): a do pagamento quando pago; a programada enquanto não. É ela que diz o mês do repasse, na capa e na tabela de repasses. */
export const dataDoPix = (r: { situacao: string; dataPagamento: string | null; data: string }) => (r.situacao === "pago" && r.dataPagamento) || r.data;
/** O canal (ou o hóspede) já pagou: a data do pagamento não passou de hoje — a mesma régua de `classificarParte` ("pago" × "previsto"). Data futura é previsão, não dinheiro. */
const pago = (p: ParteDoRelatorio, hoje: string) => Boolean(p.pagamento && p.pagamento.data <= hoje);
const antesDe = (data: string | undefined | null, mes: MesISO) => Boolean(data && data.slice(0, 7) < mes);
const depoisDe = (data: string | undefined | null, mes: MesISO) => Boolean(data && data.slice(0, 7) > mes);

function prazoTexto(partes: readonly ParteDoRelatorio[]): string {
  const prazos = unicos(partes.map((p) => p.pagamento?.prazo).filter((x): x is number => typeof x === "number"));
  if (prazos.length !== 1) return "";
  return prazos[0] === 0 ? ", no check-in" : prazos[0] === 1 ? ", no dia seguinte a cada check-in" : `, ${prazos[0]} dias depois de cada check-in`;
}

/**
 * "Como chega até você": uma linha por caminho, só os que existem, pela data em que o canal pagou. `rodapes`: o saldo
 * do fechamento de cada proprietário do relatório (um, em geral).
 */
export function comoChega(
  partes: readonly ParteDoRelatorio[],
  mes: MesISO,
  /** A data de hoje (dia em São Paulo): pagamento do canal com data depois dela é previsto, não pago. */
  hoje: string,
  rodapes: readonly Rodape[],
  empresa: string,
  /** Os repasses do mês como gravados (valor do Pix inteiro e reservas incluídas), para a linha do antecipado bater com a tabela de repasses e o comprovante. */
  repassesDoMes: readonly { id: string; valor: number; reservas: readonly string[] }[] = [],
): { linhas: Linha[]; quemPagaQuem: string | null } {
  const { fim } = limitesDe(mes);
  const doMes = partes.filter((p) => p.mes === mes);
  const linhas: Linha[] = [];
  // 1. Pago a você direto pelo canal (split), pela data do pagamento: tudo o que o canal pagou no mês, inclusive as
  //    noites de outro mês de uma reserva que atravessa (o extrato do canal e a conta do proprietário mostram a reserva
  //    inteira); essa parte sai discriminada e entra no resultado do mês dela (ponte na conciliação).
  const suaParte = (p: ParteDoRelatorio) => p.suaParte;
  const porMesECheckin = (a: ParteDoRelatorio, b: ParteDoRelatorio) => a.mes.localeCompare(b.mes) || a.checkin.localeCompare(b.checkin);
  const noitesDe = (p: ParteDoRelatorio) => `${p.noitesNoMes} ${plural(p.noitesNoMes, "noite", "noites")} de ${nomeDoMes(p.mes)} da reserva de ${reservaDe(p)}`;
  /** A parte de outro mês paga junto com as deste (reserva que atravessa): sai discriminada e entra no resultado do mês dela. */
  const pagaJunto = (p: ParteDoRelatorio, origem: OrigemLinha): Linha => ({
    texto: `Desse valor, ${noitesDe(p)}, ${plural(p.noitesNoMes, "paga", "pagas")} junto: ${plural(p.noitesNoMes, "entra", "entram")} no resultado de ${nomeDoMes(p.mes)}`,
    valor: p.suaParte,
    tipo: "info",
    origem,
  });
  const split = partes.filter((p) => p.quemRecebe === "split");
  for (const canal of unicos(split.map((p) => p.canal))) {
    const doCanal = split.filter((p) => p.canal === canal);
    const noMes = doCanal.filter((p) => emMes(p.pagamento?.data, mes) && pago(p, hoje));
    if (noMes.length) {
      const n = unicos(noMes.map((p) => p.reservaId)).length;
      linhas.push({ texto: `Pago a você direto pelo ${nomeDoCanal(canal, empresa)} em ${nomeDoMes(mes)} (${n} ${plural(n, "reserva", "reservas")}${prazoTexto(noMes)})`, valor: soma(noMes, suaParte), tipo: "normal", origem: "canal" });
      for (const p of noMes.filter((x) => x.mes !== mes).sort(porMesECheckin)) linhas.push(pagaJunto(p, "canal"));
    }
    const doCanalDoMes = doCanal.filter((p) => p.mes === mes);
    for (const p of doCanalDoMes.filter((x) => antesDe(x.pagamento?.data, mes) && pago(x, hoje))) {
      linhas.push({ texto: `Já pago pelo ${nomeDoCanal(canal, empresa)} em ${dataCurta(p.pagamento!.data)}: ${noitesDe(p)} — está no extrato de ${nomeDoMes(p.pagamento!.data.slice(0, 7))}`, valor: p.suaParte, tipo: "info", origem: "canal" });
    }
    for (const p of doCanalDoMes.filter((x) => depoisDe(x.pagamento?.data, mes) && pago(x, hoje))) {
      linhas.push({ texto: `Pago a você direto pelo ${nomeDoCanal(canal, empresa)} em ${dataCurta(p.pagamento!.data)}, depois do mês: ${p.noitesNoMes} ${plural(p.noitesNoMes, "noite", "noites")} da reserva de ${reservaDe(p)}`, valor: p.suaParte, tipo: "info", origem: "canal" });
    }
    // Data do canal ainda no futuro (relatório parcial ou de mês futuro): previsão, não dinheiro.
    for (const p of doCanalDoMes.filter((x) => x.pagamento && !pago(x, hoje)).sort((a, b) => a.pagamento!.data.localeCompare(b.pagamento!.data))) {
      linhas.push({ texto: `Previsto para ${dataCurta(p.pagamento!.data)}: o ${nomeDoCanal(canal, empresa)} paga a você direto (${noitesDe(p)})`, valor: p.suaParte, tipo: "info", origem: "canal" });
    }
    for (const p of doCanalDoMes.filter((x) => !x.pagamento)) {
      // Sem prazo do canal cadastrado não há data de pagamento: nunca "pago" (a conciliação põe em "a receber"); aviso.
      linhas.push({ texto: `O ${nomeDoCanal(canal, empresa)} paga a você direto, mas sem data: o prazo do canal não está cadastrado (reserva de ${reservaDe(p)})`, valor: p.suaParte, tipo: "aviso", origem: "canal", aviso: "sem_prazo_do_canal" });
    }
  }
  // 2. Já repassado (antecipados) e acertado por fora. O antecipado é um Pix só: com a data do Pix no mês (a do
  //    pagamento quando pago, a programada enquanto não — a mesma régua da tabela de repasses da página 3), a linha traz
  //    o Pix inteiro — o valor gravado no repasse, que pode incluir noites de outro mês de uma reserva que atravessa e
  //    reservas de outro imóvel do mesmo dono, fora deste relatório, cada parte discriminada em linha própria; o
  //    antecipado pago em outro mês que cobriu noites deste entra como informação. O acerto por fora é só das noites do mês.
  const repassadas = partes.filter((p) => p.quemRecebe === "empresa" && p.repasse && p.repasse.tipo !== "fechamento");
  const porRepasse = new Map<string, ParteDoRelatorio[]>();
  for (const p of repassadas) porRepasse.set(p.repasse!.id, [...(porRepasse.get(p.repasse!.id) ?? []), p]);
  for (const ps of [...porRepasse.values()].sort((a, b) => dataDoPix(a[0].repasse!).localeCompare(dataDoPix(b[0].repasse!)))) {
    const r = ps[0].repasse!;
    const data = dataDoPix(r);
    const deste = ps.filter((p) => p.mes === mes).sort(porMesECheckin);
    if (r.tipo === "por_fora") {
      if (deste.length) linhas.push({ texto: `Acertado por fora, antes do início do sistema (reserva de ${lista(unicos(deste.map((p) => nomeOuHospede(p.hospede))))})`, valor: soma(deste, suaParte), tipo: "info", origem: "antecipado" });
      continue;
    }
    if (r.situacao !== "pago" && r.situacao !== "a_pagar") continue;
    if (emMes(data, mes)) {
      const nomes = unicos(ps.map((p) => nomeOuHospede(p.hospede)));
      const gravado = repassesDoMes.find((x) => x.id === r.id);
      const valor = gravado?.valor ?? soma(ps, suaParte);
      if (r.situacao === "pago") linhas.push({ texto: `Já repassado em ${dataCurta(data)} (repasse antecipado: ${lista(nomes)}; Pix com comprovante no portal)`, valor, tipo: "normal", origem: "antecipado" });
      else linhas.push({ texto: `Repasse antecipado de ${dataCurta(data)} a pagar (${lista(nomes)})`, valor, tipo: "info", origem: "antecipado" });
      for (const p of ps.filter((x) => x.mes !== mes).sort(porMesECheckin)) linhas.push(pagaJunto(p, "antecipado"));
      // O que o repasse pagou além das partes deste relatório (reserva de outro imóvel do dono, ou de um mês fora dos que o relatório carrega).
      const foraDoRelatorio = gravado ? gravado.valor - soma(ps, (p) => p.repasse!.valor) : 0;
      if (foraDoRelatorio > 0) {
        const outras = gravado!.reservas.filter((n) => !nomes.includes(n));
        linhas.push({ texto: `Desse valor, a parte de ${outras.length ? lista(outras) : "outras reservas"}, fora deste relatório (outro imóvel seu ou outro mês): entra no relatório de lá`, valor: foraDoRelatorio, tipo: "info", origem: "antecipado" });
      }
    } else {
      for (const p of deste) {
        linhas.push({
          texto: r.situacao === "pago" ? `Já repassado em ${dataCurta(data)} (repasse antecipado de ${nomeDoMes(data.slice(0, 7))}): ${noitesDe(p)}` : `Repasse antecipado de ${dataCurta(data)} a pagar: ${noitesDe(p)}`,
          valor: p.suaParte,
          tipo: "info",
          origem: "antecipado",
        });
      }
    }
  }
  // 3. O fechamento: a transferir, transferido, ou o que você deve.
  let quemPagaQuem: string | null = null;
  for (const r of rodapes) {
    const quem = rodapes.length > 1 ? ` — ${r.nome}` : "";
    const v = formatBRL(r.valor);
    switch (r.situacao) {
      case "pago":
        linhas.push({ texto: `Transferido no fechamento, em ${dataBr(r.dataPagamento!)}${quem}`, valor: r.valor, tipo: "normal", origem: "fechamento" });
        quemPagaQuem = `A ${empresa} transferiu ${v} para ${r.nome} em ${dataBr(r.dataPagamento!)}, pela chave Pix cadastrada no portal (comprovante no portal).`;
        break;
      case "fechado":
      case "empresa_deve":
        linhas.push({ texto: `A transferir no fechamento, ${r.situacao === "fechado" ? "mês já fechado" : `previsto para ${dataBr(fim)}`}${quem}`, valor: r.valor, tipo: "normal", origem: "fechamento" });
        quemPagaQuem = `A ${empresa} transfere ${v} para ${r.nome}${r.situacao === "fechado" ? "" : ` em ${dataBr(fim)}`}, pela chave Pix cadastrada no portal.`;
        break;
      case "proprietario_deve":
        linhas.push({ texto: `Você transfere à ${empresa} no fechamento${quem}`, valor: r.valor, tipo: "aviso", origem: "fechamento", aviso: "voce_transfere" });
        quemPagaQuem = `${r.nome} transfere ${v} para a ${empresa} (as despesas do mês passaram da sua parte): chave Pix da empresa no portal.`;
        break;
      case "parcial":
        linhas.push({ texto: `Saldo parcial a acertar no fechamento de ${dataBr(fim)}${r.aFavor === "proprietario" ? " (a seu favor)" : r.aFavor === "empresa" ? ` (a favor da ${empresa})` : ""}${quem}`, valor: r.valor, tipo: "info", origem: "fechamento" });
        break;
      case "no_repasse_posterior":
        linhas.push({ texto: `Saldo deste mês levado pelo repasse de ${nomeDoMes(r.repassePosterior!)}${quem}`, valor: r.valor, tipo: "info", origem: "fechamento" });
        break;
      case "em_conferencia":
        linhas.push({ texto: `Em conferência: o valor do fechamento sai depois que a ${empresa} resolver${quem}`, valor: r.valor, tipo: "aviso", origem: "fechamento", aviso: "em_conferencia" });
        break;
      default:
        break;
    }
  }
  // 4. A liberar (empresa recebe, dinheiro ainda não com ela) e quem recebe a confirmar.
  const aLiberar = doMes.filter((p) => p.quemRecebe !== "split" && p.situacao === "a_liberar");
  for (const p of aLiberar) linhas.push({ texto: `A liberar — ${reservaDe(p)}, ${nomeDoCanal(p.canal, empresa)}: ${p.motivo}`, valor: p.suaParte, tipo: "aviso", origem: "a_liberar", aviso: "a_liberar" });
  if (aLiberar.length && quemPagaQuem) quemPagaQuem += " O valor a liberar entra no próximo repasse assim que o canal pagar.";
  return { linhas, quemPagaQuem };
}

export type LinhaConciliacao = { rotulo: string; reservas: number; bruto: number; taxa: number; quemRecebeu: string; suaParte: number; tipo: "canal" | "subtotal" | "ponte" | "total" };

/**
 * Conciliação "do extrato dos canais ao seu resultado": uma linha por canal pelo que ele pagou no mês (data do
 * pagamento), o subtotal, e a ponte até o resultado por noite do mês: + noites do mês pagas antes, + noites do mês a
 * receber (ou pagas depois), − noites de outros meses pagas neste. O total bate com a competência do mês.
 */
export function conciliacao(partes: readonly ParteDoRelatorio[], mes: MesISO, hoje: string, empresa: string): LinhaConciliacao[] {
  const pagasNoMes = partes.filter((p) => emMes(p.pagamento?.data, mes) && pago(p, hoje));
  const linhas: LinhaConciliacao[] = [];
  const somaDe = (ps: readonly ParteDoRelatorio[]) => ({ reservas: unicos(ps.map((p) => p.reservaId)).length, bruto: soma(ps, (p) => p.bruto), taxa: soma(ps, (p) => p.taxa), suaParte: soma(ps, (p) => p.suaParte) });
  for (const canal of unicos(pagasNoMes.map((p) => p.canal))) {
    const ps = pagasNoMes.filter((p) => p.canal === canal);
    const datas = unicos(ps.map((p) => p.pagamento!.data).sort()).map(dataCurta);
    const split = ps.filter((p) => p.quemRecebe === "split");
    const quem = [
      split.length ? `${quemPaga(canal, empresa)} pagou a você direto em ${lista(unicos(split.map((p) => dataCurta(p.pagamento!.data))))}${prazoTexto(split).replace(/^, /, " (")}${prazoTexto(split) ? ")" : ""}` : "",
      ps.some((p) => p.quemRecebe === "empresa") ? `pagou à ${empresa} em ${lista(unicos(ps.filter((p) => p.quemRecebe === "empresa").map((p) => dataCurta(p.pagamento!.data))))}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    linhas.push({ rotulo: nomeDoCanal(canal, empresa), ...somaDe(ps), quemRecebeu: quem || `em ${lista(datas)}`, tipo: "canal" });
  }
  linhas.push({ rotulo: `Pago pelos canais em ${nomeDoMes(mes)}`, ...somaDe(pagasNoMes), quemRecebeu: "", tipo: "subtotal" });
  const doMes = partes.filter((p) => p.mes === mes);
  for (const p of doMes.filter((x) => antesDe(x.pagamento?.data, mes) && pago(x, hoje))) {
    linhas.push({
      rotulo: `+ ${p.noitesNoMes} ${plural(p.noitesNoMes, "noite", "noites")} de ${nomeDoMes(mes)} ${plural(p.noitesNoMes, "paga", "pagas")} em ${nomeDoMes(p.pagamento!.data.slice(0, 7))} (${reservaDe(p)}, ${nomeDoCanal(p.canal, empresa)}, ${plural(p.noitesNoMes, "paga", "pagas")} em ${dataCurta(p.pagamento!.data)})`,
      ...somaDe([p]),
      quemRecebeu: p.quemRecebe === "split" ? "já na sua conta desde então; entra aqui só para fechar o mês por noite" : `já com a ${empresa} desde então; entra aqui só para fechar o mês por noite`,
      tipo: "ponte",
    });
  }
  // O resto do mês: pago depois do mês, previsto (data do canal ainda no futuro) ou a receber.
  for (const p of doMes.filter((x) => !pago(x, hoje) || depoisDe(x.pagamento?.data, mes))) {
    const depois = pago(p, hoje) && depoisDe(p.pagamento?.data, mes);
    const previsto = Boolean(p.pagamento) && !pago(p, hoje);
    linhas.push({
      rotulo: `+ ${depois ? `${plural(p.noitesNoMes, "paga", "pagas")} em ${dataCurta(p.pagamento!.data)}, depois do mês` : previsto ? `${plural(p.noitesNoMes, "prevista", "previstas")} para ${dataCurta(p.pagamento!.data)}` : "a receber"} (${reservaDe(p)}, ${nomeDoCanal(p.canal, empresa)}, ${p.noitesNoMes} ${plural(p.noitesNoMes, "noite", "noites")} de ${nomeDoMes(mes)})`,
      ...somaDe([p]),
      quemRecebeu: depois
        ? p.quemRecebe === "split"
          ? `${quemPaga(p.canal, empresa)} pagou a você direto depois do fim do mês`
          : `pagou à ${empresa} depois do fim do mês`
        : previsto
          ? p.quemRecebe === "split"
            ? `${quemPaga(p.canal, empresa)} paga a você direto em ${dataCurta(p.pagamento!.data)}`
            : `paga à ${empresa} em ${dataCurta(p.pagamento!.data)}; a parte entra no repasse depois`
        : p.quemRecebe === "a_confirmar"
          ? "quem recebe o dinheiro ainda está a confirmar pela empresa"
          : p.quemRecebe === "split"
            ? `${quemPaga(p.canal, empresa)} ainda não pagou (sem prazo do canal cadastrado)`
            : `${quemPaga(p.canal, empresa)} ainda não pagou: a parte fica a liberar e entra no próximo repasse`,
      tipo: "ponte",
    });
  }
  for (const p of pagasNoMes.filter((x) => x.mes !== mes)) {
    linhas.push({
      rotulo: `− ${p.noitesNoMes} ${plural(p.noitesNoMes, "noite", "noites")} de ${nomeDoMes(p.mes)} ${plural(p.noitesNoMes, "paga", "pagas")} em ${nomeDoMes(mes)} (${reservaDe(p)}, ${nomeDoCanal(p.canal, empresa)})`,
      reservas: 1,
      bruto: -p.bruto,
      taxa: -p.taxa,
      suaParte: -p.suaParte,
      quemRecebeu: `conta no resultado de ${nomeDoMes(p.mes)}`,
      tipo: "ponte",
    });
  }
  linhas.push({ rotulo: `Resultado por noite de ${nomeDoMes(mes)}`, ...somaDe(doMes), quemRecebeu: "", tipo: "total" });
  return linhas;
}

/** Confere que a ponte fecha: subtotal + pontes = total (centavos). */
export function conciliacaoFecha(linhas: readonly LinhaConciliacao[]): boolean {
  const sub = linhas.find((l) => l.tipo === "subtotal");
  const total = linhas.find((l) => l.tipo === "total");
  if (!sub || !total) return false;
  const pontes = linhas.filter((l) => l.tipo === "ponte");
  return sub.suaParte + soma(pontes, (l) => l.suaParte) === total.suaParte && sub.bruto + soma(pontes, (l) => l.bruto) === total.bruto && sub.taxa + soma(pontes, (l) => l.taxa) === total.taxa;
}
