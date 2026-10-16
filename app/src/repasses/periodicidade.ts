/**
 * Periodicidade dos repasses ao proprietário (M4.10). Puro: sem banco, roda também no navegador.
 *
 * O proprietário escolhe como quer receber; sem escolha vale o padrão do tipo de contrato dos
 * imóveis dele, definido em Configurações → Repasses (uma regra, um lugar). O mensal (no dia do
 * fechamento, o fechamento do M4.9) é o padrão e o intervalo máximo; as outras opções geram repasses
 * antecipados com o que já está disponível, e o fechamento continua existindo para todos — por isso
 * o dia do fechamento conta como dia de repasse em qualquer periodicidade.
 *
 * Dia do fechamento (M4.13, decisão de Diego em 5/10/2026): o fechamento mensal, o repasse mensal e o
 * e-mail do relatório saem no **dia 2** do mês seguinte por padrão (o Airbnb paga a reserva com
 * check-in no último dia do mês só no dia 1º), editável de 1 a 5 em Configurações → Repasses. A regra
 * é versionada por mês de competência: a mudança vale do fechamento do mês corrente em diante (feito
 * no mês seguinte); o que já foi fechado não muda. Fechar ou enviar antes, à mão, continua possível.
 */
import type { TipoContrato } from "@/db/schema";
import { somarDias } from "@/imoveis/regras-venda";
import { diaDaSemana, NOMES_DIA_SEMANA } from "@/lib/datas";

export const PERIODICIDADES = ["mensal", "quinzenal", "semanal", "disponivel"] as const;
export type PeriodicidadeRepasse = (typeof PERIODICIDADES)[number];

export const NOMES_PERIODICIDADE: Record<PeriodicidadeRepasse, string> = {
  mensal: "Mensal, no dia do fechamento (padrão)",
  quinzenal: "Quinzenal",
  semanal: "Semanal",
  disponivel: "Assim que disponível",
};

/** Os nomes inteiros dos dias (0 = domingo), de lib/datas.ts: a lista de Configurações, Repasses e a frase do semanal. */
export { NOMES_DIA_SEMANA };

export const periodicidadeValida = (v: unknown): v is PeriodicidadeRepasse => typeof v === "string" && (PERIODICIDADES as readonly string[]).includes(v);

/** Dia do fechamento (M4.13) a valer para os meses de competência a partir de `desde` ("AAAA-MM"). */
export type VersaoDiaFechamento = { dia: number; desde: string };
export const DIA_FECHAMENTO_MIN = 1;
export const DIA_FECHAMENTO_MAX = 5;
/** Sem versão gravada: dia 2 (decisão de Diego em 5/10/2026). */
export const DIA_FECHAMENTO_PADRAO = 2;

/** Regras editáveis no painel (chave de configuração `repasses_regras`). */
export type RegrasRepasses = {
  /** Dia da semana do repasse semanal (0 = domingo … 6 = sábado). */
  diaSemanal: number;
  /** Os dois dias do mês do repasse quinzenal, em ordem crescente (1–28). */
  diasQuinzenal: [number, number];
  /** Periodicidade padrão por tipo de contrato, para quem não escolheu. */
  padraoPorContrato: Record<TipoContrato, PeriodicidadeRepasse>;
  /** Versões do dia do fechamento, da mais antiga para a mais nova (vazio = padrão). */
  fechamento: VersaoDiaFechamento[];
};

export const REGRAS_REPASSES_PADRAO: RegrasRepasses = {
  diaSemanal: 1,
  diasQuinzenal: [1, 16],
  padraoPorContrato: { gestao_completa: "mensal", gestao_online: "mensal", marketplace: "mensal" },
  fechamento: [],
};

const TIPOS_CONTRATO: readonly TipoContrato[] = ["gestao_completa", "gestao_online", "marketplace"];
const diaDoMesValido = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 28;
export const diaDeFechamentoValido = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= DIA_FECHAMENTO_MIN && v <= DIA_FECHAMENTO_MAX;
const MES_ISO = /^\d{4}-(0[1-9]|1[0-2])$/;

const mesSeguinte = (mes: string): string => {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
};
const mesAnteriorDe = (data: string): string => {
  const [a, m] = data.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};

/** Dia do fechamento do mês de competência `mes` ("AAAA-MM"): a versão mais nova com `desde` até esse mês; sem versão, o padrão. */
export function diaDoFechamento(regras: Pick<RegrasRepasses, "fechamento">, mes: string): number {
  let dia = DIA_FECHAMENTO_PADRAO;
  for (const v of regras.fechamento) if (v.desde <= mes) dia = v.dia;
  return dia;
}

/** O dia que vale hoje em diante (a versão mais nova), para textos e formulário. */
export const diaDoFechamentoAtual = (regras: Pick<RegrasRepasses, "fechamento">): number => regras.fechamento.at(-1)?.dia ?? DIA_FECHAMENTO_PADRAO;

/** Data em que o mês `mes` é fechado (dia do fechamento no mês seguinte), "AAAA-MM-DD". */
export const dataDoFechamento = (regras: Pick<RegrasRepasses, "fechamento">, mes: string): string => `${mesSeguinte(mes)}-${String(diaDoFechamento(regras, mes)).padStart(2, "0")}`;

/** A data é o dia do fechamento (do mês anterior a ela)? */
export const ehDiaDeFechamento = (data: string, regras: Pick<RegrasRepasses, "fechamento">): boolean => data === dataDoFechamento(regras, mesAnteriorDe(data));

/**
 * O próximo fechamento a partir de `hoje`: o do mês anterior, se o dia dele ainda não passou (hoje inclusive); senão o
 * do mês corrente. É o dia que as telas mostram — uma mudança feita hoje vale do fechamento do mês corrente em diante,
 * então o mês anterior ainda aberto fecha no dia que já valia, e é esse que o texto e a próxima data precisam dizer.
 */
export function proximoFechamento(regras: Pick<RegrasRepasses, "fechamento">, hoje: string): { mes: string; data: string; dia: number } {
  const anterior = mesAnteriorDe(hoje);
  const mes = hoje <= dataDoFechamento(regras, anterior) ? anterior : hoje.slice(0, 7);
  return { mes, data: dataDoFechamento(regras, mes), dia: diaDoFechamento(regras, mes) };
}

/**
 * Versões com o dia `dia` valendo a partir do mês `desde` (o mês de hoje: o fechamento dele, feito no mês
 * seguinte, já sai no dia novo; o mês anterior, se ainda não fechou, segue como estava). Dia igual ao que já
 * valeria não cria versão; versão do mesmo mês é substituída.
 */
export function comDiaDeFechamento(versoes: readonly VersaoDiaFechamento[], dia: number, desde: string): VersaoDiaFechamento[] {
  const semEste = versoes.filter((v) => v.desde !== desde);
  if (diaDoFechamento({ fechamento: semEste }, desde) === dia) return semEste;
  return [...semEste, { dia, desde }].sort((a, b) => a.desde.localeCompare(b.desde));
}

/** Leitura tolerante do JSON gravado: o que faltar ou estiver inválido volta ao padrão. */
export function regrasDeJson(v: Record<string, unknown> | null): RegrasRepasses {
  const P = REGRAS_REPASSES_PADRAO;
  if (!v) return { ...P, diasQuinzenal: [...P.diasQuinzenal], padraoPorContrato: { ...P.padraoPorContrato } };
  const diaSemanal = typeof v.diaSemanal === "number" && Number.isInteger(v.diaSemanal) && v.diaSemanal >= 0 && v.diaSemanal <= 6 ? v.diaSemanal : P.diaSemanal;
  const q = Array.isArray(v.diasQuinzenal) ? v.diasQuinzenal : [];
  const diasQuinzenal: [number, number] = diaDoMesValido(q[0]) && diaDoMesValido(q[1]) && q[0] < q[1] ? [q[0], q[1]] : [...P.diasQuinzenal];
  const padrao = (typeof v.padraoPorContrato === "object" && v.padraoPorContrato !== null ? v.padraoPorContrato : {}) as Record<string, unknown>;
  const padraoPorContrato = { ...P.padraoPorContrato };
  for (const t of TIPOS_CONTRATO) if (periodicidadeValida(padrao[t])) padraoPorContrato[t] = padrao[t];
  const fechamento = (Array.isArray(v.fechamento) ? v.fechamento : [])
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .filter((x): x is { dia: number; desde: string } => diaDeFechamentoValido(x.dia) && typeof x.desde === "string" && MES_ISO.test(x.desde))
    .map((x) => ({ dia: x.dia, desde: x.desde }))
    .sort((a, b) => a.desde.localeCompare(b.desde));
  return { diaSemanal, diasQuinzenal, padraoPorContrato, fechamento };
}

export type ErrosFormRegras = Partial<Record<"diaSemanal" | "diasQuinzenal" | "padraoPorContrato" | "diaFechamento", string>>;

/**
 * Valida o formulário do painel (textos). `diaFechamento` sai separado: as versões são montadas na gravação
 * (`comDiaDeFechamento`, com o mês de hoje); `regras.fechamento` volta vazio aqui.
 */
export function validarFormRegras(form: Record<string, string>): { ok: true; regras: RegrasRepasses; diaFechamento: number } | { ok: false; erros: ErrosFormRegras } {
  const erros: ErrosFormRegras = {};
  const diaSemanal = Number(form.diaSemanal);
  if (!Number.isInteger(diaSemanal) || diaSemanal < 0 || diaSemanal > 6) erros.diaSemanal = "Escolha o dia da semana.";
  const diaFechamento = Number(form.diaFechamento);
  if (!diaDeFechamentoValido(diaFechamento)) erros.diaFechamento = `O dia do fechamento vai de ${DIA_FECHAMENTO_MIN} a ${DIA_FECHAMENTO_MAX}.`;
  const d1 = Number(form.diaQuinzenal1);
  const d2 = Number(form.diaQuinzenal2);
  if (!diaDoMesValido(d1) || !diaDoMesValido(d2)) erros.diasQuinzenal = "Os dois dias do quinzenal vão de 1 a 28.";
  else if (d1 === d2) erros.diasQuinzenal = "Os dois dias do quinzenal precisam ser diferentes.";
  const padraoPorContrato = { ...REGRAS_REPASSES_PADRAO.padraoPorContrato };
  for (const t of TIPOS_CONTRATO) {
    const v = form[`padrao_${t}`];
    if (!periodicidadeValida(v)) erros.padraoPorContrato = "Escolha uma periodicidade para cada tipo de contrato.";
    else padraoPorContrato[t] = v;
  }
  if (Object.keys(erros).length) return { ok: false, erros };
  return { ok: true, regras: { diaSemanal, diasQuinzenal: d1 < d2 ? [d1, d2] : [d2, d1], padraoPorContrato, fechamento: [] }, diaFechamento };
}

/** Quanto menor, mais frequente. */
const FREQUENCIA: Record<PeriodicidadeRepasse, number> = { disponivel: 0, semanal: 1, quinzenal: 2, mensal: 3 };

/**
 * Periodicidade que vale para o proprietário: a escolha dele; sem escolha, o padrão do tipo de
 * contrato dos imóveis dele — com tipos diferentes, vale o mais frequente (a favor do
 * proprietário); sem contrato nenhum, mensal.
 */
export function periodicidadeEfetiva(escolha: PeriodicidadeRepasse | null | undefined, tiposContrato: readonly TipoContrato[], regras: RegrasRepasses): PeriodicidadeRepasse {
  if (escolha && periodicidadeValida(escolha)) return escolha;
  let melhor: PeriodicidadeRepasse = "mensal";
  for (const t of tiposContrato) {
    const p = regras.padraoPorContrato[t] ?? "mensal";
    if (FREQUENCIA[p] < FREQUENCIA[melhor]) melhor = p;
  }
  return melhor;
}

const diaDoMes = (data: string) => Number(data.slice(8, 10));

/** A data é dia de repasse nessa periodicidade? O dia do fechamento conta em todas. */
export function ehDiaDeRepasse(data: string, p: PeriodicidadeRepasse, regras: RegrasRepasses): boolean {
  const dia = diaDoMes(data);
  if (ehDiaDeFechamento(data, regras)) return true;
  switch (p) {
    case "mensal":
      return false;
    case "quinzenal":
      return regras.diasQuinzenal.includes(dia);
    case "semanal":
      return diaDaSemana(data) === regras.diaSemanal;
    case "disponivel":
      return true;
  }
}

/**
 * A rotina diária gera repasse antecipado nesta data? Nunca no dia do fechamento (o fechamento é o único
 * repasse do dia) e nunca no mensal.
 */
export function geraAntecipadoEm(data: string, p: PeriodicidadeRepasse, regras: RegrasRepasses): boolean {
  return p !== "mensal" && !ehDiaDeFechamento(data, regras) && ehDiaDeRepasse(data, p, regras);
}

/** Próximo dia de repasse estritamente depois de `hoje` (o repasse do dia reúne o disponível até o dia anterior). */
export function proximaDataDeRepasse(hoje: string, p: PeriodicidadeRepasse, regras: RegrasRepasses): string {
  let d = somarDias(hoje, 1);
  for (let n = 0; n < 40; n++, d = somarDias(d, 1)) if (ehDiaDeRepasse(d, p, regras)) return d;
  return d;
}

/** Texto curto da periodicidade com os dias, para o portal e o painel; o dia do fechamento é o do próximo fechamento a partir de `hoje`. */
export function descreverPeriodicidade(p: PeriodicidadeRepasse, regras: RegrasRepasses, hoje: string): string {
  const dia = proximoFechamento(regras, hoje).dia;
  switch (p) {
    case "mensal":
      return `mensal, no dia ${dia}, junto com o fechamento do mês`;
    case "quinzenal":
      return `quinzenal, nos dias ${regras.diasQuinzenal[0]} e ${regras.diasQuinzenal[1]} (e no dia ${dia}, junto com o fechamento)`;
    case "semanal":
      // "todo domingo" e "todo sábado"; "toda" nos dias que terminam em "-feira".
      return `semanal, ${regras.diaSemanal === 0 || regras.diaSemanal === 6 ? "todo" : "toda"} ${NOMES_DIA_SEMANA[regras.diaSemanal]} (e no dia ${dia}, junto com o fechamento)`;
    case "disponivel":
      return "assim que disponível: no dia seguinte ao check-in, com o dinheiro já com a empresa";
  }
}
