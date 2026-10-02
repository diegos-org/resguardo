/**
 * Disponibilidade e cotação reais do site público (M7.2). Uma noite só é "disponível" quando
 * (1) não há reserva nem bloqueio no SCL, (2) a última leitura do Beds24 é recente e informa
 * unidade livre e (3) as regras de venda permitem a estadia. Qualquer lacuna vira
 * "a confirmar" — nunca "disponível" por omissão. O valor usa os mesmos preços por noite que
 * o SCL envia ao Beds24 (motor de calendário: eventos, feriadões, última hora) mais as taxas
 * do cadastro. Nada é gravado: cotação persistida e hold são o M8.1.
 */
import { and, eq } from "drizzle-orm";
import { planejarImovel } from "@/calendario/envio";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { beds24Calendario, imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { listarPeriodos } from "@/imoveis/detalhes";
import { type Cotacao, cotarNoites, diasEntre, somarDias, verificarEstadia } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";
import { dataValida } from "@/reservas/regras";
import type { PedidoConsulta } from "./site";

export type SituacaoDisponibilidade = "disponivel" | "indisponivel" | "a_confirmar" | "invalida";
export type Disponibilidade = {
  situacao: SituacaoDisponibilidade;
  /** Em linguagem simples, para o visitante. */
  motivos: string[];
  noites: number;
  /** Só quando a estadia é possível (disponível ou a confirmar) e há preço em todas as noites; senão null. */
  cotacao: Pick<Cotacao, "diarias" | "limpeza" | "hospedeExtra" | "total"> | null;
  /** Leitura mais antiga do Beds24 entre as noites; null quando alguma noite não tem leitura. */
  leituraEm: Date | null;
};

const dataBr = (d: string) => d.split("-").reverse().join("/");

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
  const regras = await lerRegrasCalendario(db, organizacaoId);
  if (noites > regras.site.maximoNoitesConsulta) return vazio("a_confirmar", [`Para estadias acima de ${regras.site.maximoNoitesConsulta} noites, fale com a equipe.`], noites);
  const [plano, periodos] = await Promise.all([planejarImovel(db, organizacaoId, regras, imovel, agora, { inicio: p.entrada, fim: somarDias(p.saida, -1) }), listarPeriodos(db, organizacaoId, imovel.id)]);
  const motivos = new Set<string>();
  let aConfirmar = false;

  // Regras de venda: mínimo/máximo vêm do motor (já considera semana normal, eventos e sobras);
  // antecedência, horizonte e dias de entrada/saída vêm do cadastro.
  const entrada = plano.linhas[0];
  if (entrada?.minimoEnviar !== null && entrada?.minimoEnviar !== undefined && noites < entrada.minimoEnviar) motivos.add(`Para entrada em ${dataBr(p.entrada)}, o mínimo é de ${entrada.minimoEnviar} ${entrada.minimoEnviar === 1 ? "noite" : "noites"}.`);
  if (entrada && noites > entrada.maximoEnviar) motivos.add(`Máximo de ${entrada.maximoEnviar} noites por estadia.`);
  for (const problema of verificarEstadia({ ...plano.regras, estadiaMinima: null, estadiaMaxima: null }, periodos.map((x) => ({ ...x, estadiaMinima: null })), p.entrada, p.saida, hoje)) motivos.add(problema);

  // Restrições de entrada/saída do calendário Beds24: valem na data de entrada e na de saída,
  // só com leitura dentro da validade (leitura velha vira "a confirmar", como nas noites).
  // Restrição desconhecida (ex.: "exception") nunca vira "disponível".
  const limite = agora.getTime() - regras.site.validadeLeituraHoras * 3_600_000;
  const conhecidas = new Set([null, "none", "noCheckIn", "noCheckOut", "noCheckInOrCheckOut"]);
  const restricao = (o: { bloqueio: string | null; observadoEm: Date } | null | undefined, fecha: readonly string[], motivo: string) => {
    if (!o || o.observadoEm.getTime() < limite) { aConfirmar = true; return; }
    if (fecha.includes(o.bloqueio ?? "")) motivos.add(motivo);
    else if (!conhecidas.has(o.bloqueio) && o.bloqueio !== "blackout") aConfirmar = true;
  };
  restricao(entrada?.observacao, ["noCheckIn", "noCheckInOrCheckOut"], `Entrada não permitida em ${dataBr(p.entrada)}.`);
  const [saidaObs] = await db.select({ bloqueio: beds24Calendario.bloqueio, observadoEm: beds24Calendario.observadoEm }).from(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, organizacaoId), eq(beds24Calendario.imovelId, imovel.id), eq(beds24Calendario.data, p.saida)));
  restricao(saidaObs, ["noCheckOut", "noCheckInOrCheckOut"], `Saída não permitida em ${dataBr(p.saida)}.`);

  // Ocupação e leitura do Beds24, noite a noite.
  let leituraEm: Date | null = null;
  let semLeitura = false;
  // Uma data pode estar ocupada no SCL e no Beds24 ao mesmo tempo (reserva importada): conta uma vez.
  const ocupadas = new Set<string>();
  for (const l of plano.linhas) {
    if (l.livresSeguidas === 0) ocupadas.add(l.data);
    const o = l.observacao;
    if (!o || o.observadoEm.getTime() < limite || o.livres === null) {
      if (!o) semLeitura = true;
      aConfirmar = true;
    } else if (o.livres === 0 || o.bloqueio === "blackout") ocupadas.add(l.data);
    else if (!conhecidas.has(o.bloqueio)) aConfirmar = true;
    if (o && !semLeitura && (!leituraEm || o.observadoEm < leituraEm)) leituraEm = o.observadoEm;
  }
  if (ocupadas.size) {
    const lista = [...ocupadas];
    motivos.add(lista.length === noites ? "Essas datas já estão reservadas." : `Há noites já reservadas nessas datas (${lista.slice(0, 3).map(dataBr).join(", ")}${lista.length > 3 ? "…" : ""}).`);
  }
  if (motivos.size) return { situacao: "indisponivel", motivos: [...motivos], noites, cotacao: null, leituraEm: semLeitura ? null : leituraEm };

  const cot = cotarNoites(plano.regras, plano.linhas.map((l) => ({ data: l.data, valor: l.precoFinalEsperado, fonte: l.fontePreco })), hospedes);
  // Taxa de limpeza não cadastrada não vira zero para o visitante: o total fica a confirmar.
  const total = cot.total !== null && plano.regras.taxaLimpeza !== null ? cot.total : null;
  const avisos: string[] = [];
  if (aConfirmar) avisos.push("Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa.");
  if (total === null) avisos.push("O valor dessas datas é confirmado na conversa.");
  return {
    situacao: aConfirmar ? "a_confirmar" : "disponivel",
    motivos: avisos,
    noites,
    cotacao: { diarias: cot.diarias, limpeza: cot.limpeza, hospedeExtra: cot.hospedeExtra, total },
    leituraEm: semLeitura ? null : leituraEm,
  };
}
