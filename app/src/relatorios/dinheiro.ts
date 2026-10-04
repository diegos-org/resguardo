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

export type Linha = { texto: string; valor: number; tipo: "normal" | "aviso" | "info" };

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
export function comoChega(partes: readonly ParteDoRelatorio[], mes: MesISO, rodapes: readonly Rodape[], empresa: string): { linhas: Linha[]; quemPagaQuem: string | null } {
  const { fim } = limitesDe(mes);
  const doMes = partes.filter((p) => p.mes === mes);
  const linhas: Linha[] = [];
  // 1. Pago a você direto pelo canal (split), no mês.
  const split = doMes.filter((p) => p.quemRecebe === "split");
  for (const canal of unicos(split.map((p) => p.canal))) {
    const doCanal = split.filter((p) => p.canal === canal);
    const noMes = doCanal.filter((p) => emMes(p.pagamento?.data, mes));
    if (noMes.length) {
      const n = unicos(noMes.map((p) => p.reservaId)).length;
      linhas.push({ texto: `Pago a você direto pelo ${nomeDoCanal(canal, empresa)} em ${nomeDoMes(mes)} (${n} ${plural(n, "reserva", "reservas")}${prazoTexto(noMes)})`, valor: soma(noMes, (p) => p.suaParte), tipo: "normal" });
    }
    for (const p of doCanal.filter((x) => antesDe(x.pagamento?.data, mes))) {
      linhas.push({
        texto: `Já pago pelo ${nomeDoCanal(canal, empresa)} em ${dataCurta(p.pagamento!.data)}: ${p.noitesNoMes} ${plural(p.noitesNoMes, "noite", "noites")} de ${nomeDoMes(mes)} da reserva de ${reservaDe(p)} — está no extrato de ${nomeDoMes(p.pagamento!.data.slice(0, 7))}`,
        valor: p.suaParte,
        tipo: "info",
      });
    }
    for (const p of doCanal.filter((x) => depoisDe(x.pagamento?.data, mes))) {
      linhas.push({ texto: `Pago a você direto pelo ${nomeDoCanal(canal, empresa)} em ${dataCurta(p.pagamento!.data)}, depois do mês: ${p.noitesNoMes} ${plural(p.noitesNoMes, "noite", "noites")} da reserva de ${reservaDe(p)}`, valor: p.suaParte, tipo: "info" });
    }
    for (const p of doCanal.filter((x) => !x.pagamento)) {
      linhas.push({ texto: `Pago a você direto pelo ${nomeDoCanal(canal, empresa)} (sem prazo do canal cadastrado): reserva de ${reservaDe(p)}`, valor: p.suaParte, tipo: "info" });
    }
  }
  // 2. Já repassado no mês (antecipados) e acertado por fora.
  const repassadas = doMes.filter((p) => p.quemRecebe === "empresa" && p.repasse && p.repasse.tipo !== "fechamento");
  const porRepasse = new Map<string, ParteDoRelatorio[]>();
  for (const p of repassadas) porRepasse.set(p.repasse!.id, [...(porRepasse.get(p.repasse!.id) ?? []), p]);
  for (const [, ps] of [...porRepasse.entries()].sort(([, a], [, b]) => a[0].repasse!.data.localeCompare(b[0].repasse!.data))) {
    const r = ps[0].repasse!;
    const reservas = lista(unicos(ps.map((p) => nomeOuHospede(p.hospede))));
    if (r.tipo === "por_fora") linhas.push({ texto: `Acertado por fora, antes do início do sistema (reserva de ${reservas})`, valor: soma(ps, (p) => p.suaParte), tipo: "info" });
    else if (r.situacao === "pago") linhas.push({ texto: `Já repassado em ${dataCurta(r.dataPagamento ?? r.data)} (repasse antecipado: ${reservas}; Pix com comprovante no portal)`, valor: soma(ps, (p) => p.suaParte), tipo: "normal" });
    else if (r.situacao === "a_pagar") linhas.push({ texto: `Repasse antecipado de ${dataCurta(r.data)} a pagar (${reservas})`, valor: soma(ps, (p) => p.suaParte), tipo: "info" });
  }
  // 3. O fechamento: a transferir, transferido, ou o que você deve.
  let quemPagaQuem: string | null = null;
  for (const r of rodapes) {
    const quem = rodapes.length > 1 ? ` — ${r.nome}` : "";
    const v = formatBRL(r.valor);
    switch (r.situacao) {
      case "pago":
        linhas.push({ texto: `Transferido no fechamento, em ${dataBr(r.dataPagamento!)}${quem}`, valor: r.valor, tipo: "normal" });
        quemPagaQuem = `A ${empresa} transferiu ${v} para ${r.nome} em ${dataBr(r.dataPagamento!)}, pela chave Pix cadastrada no portal (comprovante no portal).`;
        break;
      case "fechado":
      case "empresa_deve":
        linhas.push({ texto: `A transferir no fechamento, ${r.situacao === "fechado" ? "mês já fechado" : `previsto para ${dataBr(fim)}`}${quem}`, valor: r.valor, tipo: "normal" });
        quemPagaQuem = `A ${empresa} transfere ${v} para ${r.nome}${r.situacao === "fechado" ? "" : ` em ${dataBr(fim)}`}, pela chave Pix cadastrada no portal.`;
        break;
      case "proprietario_deve":
        linhas.push({ texto: `Você transfere à ${empresa} no fechamento${quem}`, valor: r.valor, tipo: "aviso" });
        quemPagaQuem = `${r.nome} transfere ${v} para a ${empresa} (as despesas do mês passaram da sua parte): chave Pix da empresa no portal.`;
        break;
      case "parcial":
        linhas.push({ texto: `Saldo parcial a acertar no fechamento de ${dataBr(fim)}${r.aFavor === "proprietario" ? " (a seu favor)" : r.aFavor === "empresa" ? ` (a favor da ${empresa})` : ""}${quem}`, valor: r.valor, tipo: "info" });
        break;
      case "no_repasse_posterior":
        linhas.push({ texto: `Saldo deste mês levado pelo repasse de ${nomeDoMes(r.repassePosterior!)}${quem}`, valor: r.valor, tipo: "info" });
        break;
      case "em_conferencia":
        linhas.push({ texto: `Em conferência: o valor do fechamento sai depois que a ${empresa} resolver${quem}`, valor: r.valor, tipo: "aviso" });
        break;
      default:
        break;
    }
  }
  // 4. A liberar (empresa recebe, dinheiro ainda não com ela) e quem recebe a confirmar.
  const aLiberar = doMes.filter((p) => p.quemRecebe !== "split" && p.situacao === "a_liberar");
  for (const p of aLiberar) linhas.push({ texto: `A liberar — ${reservaDe(p)}, ${nomeDoCanal(p.canal, empresa)}: ${p.motivo}`, valor: p.suaParte, tipo: "aviso" });
  if (aLiberar.length && quemPagaQuem) quemPagaQuem += " O valor a liberar entra no próximo repasse assim que o canal pagar.";
  return { linhas, quemPagaQuem };
}

export type LinhaConciliacao = { rotulo: string; reservas: number; bruto: number; taxa: number; quemRecebeu: string; suaParte: number; tipo: "canal" | "subtotal" | "ponte" | "total" };

/**
 * Conciliação "do extrato dos canais ao seu resultado": uma linha por canal pelo que ele pagou no mês (data do
 * pagamento), o subtotal, e a ponte até o resultado por noite do mês: + noites do mês pagas antes, + noites do mês a
 * receber (ou pagas depois), − noites de outros meses pagas neste. O total bate com a competência do mês.
 */
export function conciliacao(partes: readonly ParteDoRelatorio[], mes: MesISO, empresa: string): LinhaConciliacao[] {
  const pagasNoMes = partes.filter((p) => emMes(p.pagamento?.data, mes));
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
  for (const p of doMes.filter((x) => antesDe(x.pagamento?.data, mes))) {
    linhas.push({
      rotulo: `+ ${p.noitesNoMes} ${plural(p.noitesNoMes, "noite", "noites")} de ${nomeDoMes(mes)} ${plural(p.noitesNoMes, "paga", "pagas")} em ${nomeDoMes(p.pagamento!.data.slice(0, 7))} (${reservaDe(p)}, ${nomeDoCanal(p.canal, empresa)}, ${plural(p.noitesNoMes, "paga", "pagas")} em ${dataCurta(p.pagamento!.data)})`,
      ...somaDe([p]),
      quemRecebeu: p.quemRecebe === "split" ? "já na sua conta desde então; entra aqui só para fechar o mês por noite" : `já com a ${empresa} desde então; entra aqui só para fechar o mês por noite`,
      tipo: "ponte",
    });
  }
  for (const p of doMes.filter((x) => !emMes(x.pagamento?.data, mes) && !antesDe(x.pagamento?.data, mes))) {
    const depois = depoisDe(p.pagamento?.data, mes);
    linhas.push({
      rotulo: `+ ${depois ? `${plural(p.noitesNoMes, "paga", "pagas")} em ${dataCurta(p.pagamento!.data)}, depois do mês` : "a receber"} (${reservaDe(p)}, ${nomeDoCanal(p.canal, empresa)}, ${p.noitesNoMes} ${plural(p.noitesNoMes, "noite", "noites")} de ${nomeDoMes(mes)})`,
      ...somaDe([p]),
      quemRecebeu: depois
        ? p.quemRecebe === "split"
          ? `${quemPaga(p.canal, empresa)} pagou a você direto depois do fim do mês`
          : `pagou à ${empresa} depois do fim do mês`
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
