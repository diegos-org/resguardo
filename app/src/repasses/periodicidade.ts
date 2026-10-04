/**
 * Periodicidade dos repasses ao proprietário (M4.10). Puro: sem banco, roda também no navegador.
 *
 * O proprietário escolhe como quer receber; sem escolha vale o padrão do tipo de contrato dos
 * imóveis dele, definido em Configurações → Repasses (uma regra, um lugar). O mensal (dia 1º, o
 * fechamento do M4.9) é o padrão e o intervalo máximo; as outras opções geram repasses
 * antecipados com o que já está disponível, e o fechamento do dia 1º continua existindo para
 * todos — por isso o dia 1º conta como dia de repasse em qualquer periodicidade.
 */
import type { TipoContrato } from "@/db/schema";
import { diaDaSemana, somarDias } from "@/imoveis/regras-venda";

export const PERIODICIDADES = ["mensal", "quinzenal", "semanal", "disponivel"] as const;
export type PeriodicidadeRepasse = (typeof PERIODICIDADES)[number];

export const NOMES_PERIODICIDADE: Record<PeriodicidadeRepasse, string> = {
  mensal: "Mensal, no dia 1º (padrão)",
  quinzenal: "Quinzenal",
  semanal: "Semanal",
  disponivel: "Assim que disponível",
};

export const NOMES_DIA_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"] as const;

export const periodicidadeValida = (v: unknown): v is PeriodicidadeRepasse => typeof v === "string" && (PERIODICIDADES as readonly string[]).includes(v);

/** Regras editáveis no painel (chave de configuração `repasses_regras`). */
export type RegrasRepasses = {
  /** Dia da semana do repasse semanal (0 = domingo … 6 = sábado). */
  diaSemanal: number;
  /** Os dois dias do mês do repasse quinzenal, em ordem crescente (1–28). */
  diasQuinzenal: [number, number];
  /** Periodicidade padrão por tipo de contrato, para quem não escolheu. */
  padraoPorContrato: Record<TipoContrato, PeriodicidadeRepasse>;
};

export const REGRAS_REPASSES_PADRAO: RegrasRepasses = {
  diaSemanal: 1,
  diasQuinzenal: [1, 16],
  padraoPorContrato: { gestao_completa: "mensal", gestao_online: "mensal", marketplace: "mensal" },
};

const TIPOS_CONTRATO: readonly TipoContrato[] = ["gestao_completa", "gestao_online", "marketplace"];
const diaDoMesValido = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 28;

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
  return { diaSemanal, diasQuinzenal, padraoPorContrato };
}

export type ErrosFormRegras = Partial<Record<"diaSemanal" | "diasQuinzenal" | "padraoPorContrato", string>>;

/** Valida o formulário do painel (textos). */
export function validarFormRegras(form: Record<string, string>): { ok: true; regras: RegrasRepasses } | { ok: false; erros: ErrosFormRegras } {
  const erros: ErrosFormRegras = {};
  const diaSemanal = Number(form.diaSemanal);
  if (!Number.isInteger(diaSemanal) || diaSemanal < 0 || diaSemanal > 6) erros.diaSemanal = "Escolha o dia da semana.";
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
  return { ok: true, regras: { diaSemanal, diasQuinzenal: d1 < d2 ? [d1, d2] : [d2, d1], padraoPorContrato } };
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

/** A data é dia de repasse nessa periodicidade? O dia 1º (fechamento) conta em todas. */
export function ehDiaDeRepasse(data: string, p: PeriodicidadeRepasse, regras: RegrasRepasses): boolean {
  const dia = diaDoMes(data);
  if (dia === 1) return true;
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
 * A rotina diária gera repasse antecipado nesta data? Nunca no dia 1º (o fechamento é o único
 * repasse do dia) e nunca no mensal.
 */
export function geraAntecipadoEm(data: string, p: PeriodicidadeRepasse, regras: RegrasRepasses): boolean {
  return p !== "mensal" && diaDoMes(data) !== 1 && ehDiaDeRepasse(data, p, regras);
}

/** Próximo dia de repasse estritamente depois de `hoje` (o repasse do dia reúne o disponível até o dia anterior). */
export function proximaDataDeRepasse(hoje: string, p: PeriodicidadeRepasse, regras: RegrasRepasses): string {
  let d = somarDias(hoje, 1);
  for (let n = 0; n < 40; n++, d = somarDias(d, 1)) if (ehDiaDeRepasse(d, p, regras)) return d;
  return d;
}

/** Texto curto da periodicidade com os dias, para o portal e o painel. */
export function descreverPeriodicidade(p: PeriodicidadeRepasse, regras: RegrasRepasses): string {
  switch (p) {
    case "mensal":
      return "mensal, no dia 1º, junto com o fechamento do mês";
    case "quinzenal":
      return `quinzenal, nos dias ${regras.diasQuinzenal[0]} e ${regras.diasQuinzenal[1]} (no dia 1º, junto com o fechamento)`;
    case "semanal":
      return `semanal, toda ${NOMES_DIA_SEMANA[regras.diaSemanal]} (e no dia 1º, junto com o fechamento)`;
    case "disponivel":
      return "assim que disponível: no dia seguinte ao check-in, com o dinheiro já com a empresa";
  }
}
