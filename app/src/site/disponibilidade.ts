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
import { imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { listarPeriodos } from "@/imoveis/detalhes";
import { type Cotacao, cotarNoites, diasEntre, verificarEstadia } from "@/imoveis/regras-venda";
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
  const limite = agora.getTime() - regras.site.validadeLeituraHoras * 3_600_000;
  const conhecidas = new Set<string | null>(["none", "noCheckIn", "noCheckOut", "noCheckInOrCheckOut"]);
  // Leitura atual: dentro da validade e não anterior ao último envio do SCL para a data (como no motor):
  // depois de uma escrita sem releitura, a leitura anterior já não descreve o Beds24.
  const atual = (l: { observacao: { observadoEm: Date } | null; enviado: { enviadoEm: Date } | null } | undefined) =>
    !!l?.observacao && l.observacao.observadoEm.getTime() >= limite && (!l.enviado || l.observacao.observadoEm.getTime() >= l.enviado.enviadoEm.getTime());
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
    if (l.livresSeguidas === 0) ocupadas.add(l.data);
    const o = l.observacao;
    if (!o || !atual(l)) {
      if (!o) semLeitura = true;
      aConfirmar = true;
    } else if (o.bloqueio === "blackout" || o.livres === 0) ocupadas.add(l.data); // blackout fecha mesmo sem unidades informadas
    else if (o.livres === null || !conhecidas.has(o.bloqueio)) aConfirmar = true;
    maisAntiga(o);
  }
  if (ocupadas.size) {
    const lista = [...ocupadas];
    motivos.add(lista.length === noites ? "Essas datas já estão reservadas." : `Há noites já reservadas nessas datas (${lista.slice(0, 3).map(dataBr).join(", ")}${lista.length > 3 ? "…" : ""}).`);
  }
  if (motivos.size) return { situacao: "indisponivel", motivos: [...motivos], noites, cotacao: null, leituraEm: semLeitura ? null : leituraEm };

  const cot = cotarNoites(plano.regras, linhas.map((l) => ({ data: l.data, valor: l.precoFinalEsperado, fonte: l.fontePreco })), hospedes);
  // Preço zero numa noite é aviso do motor ("conferir"), não diária grátis; taxa de limpeza não
  // cadastrada também não vira zero para o visitante. Nos dois casos o valor fica a confirmar.
  const comValor = linhas.every((l) => l.precoFinalEsperado !== null && l.precoFinalEsperado > 0);
  const diarias = comValor ? cot.diarias : null;
  const total = comValor && cot.total !== null && plano.regras.taxaLimpeza !== null ? cot.total : null;
  const avisos: string[] = [];
  if (aConfirmar) avisos.push("Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa.");
  if (total === null) avisos.push("O valor dessas datas é confirmado na conversa.");
  return {
    situacao: aConfirmar ? "a_confirmar" : "disponivel",
    motivos: avisos,
    noites,
    cotacao: { diarias, limpeza: cot.limpeza, hospedeExtra: cot.hospedeExtra, total },
    leituraEm: semLeitura ? null : leituraEm,
  };
}
