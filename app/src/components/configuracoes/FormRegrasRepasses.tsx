"use client";

import { useActionState } from "react";
import { NOMES_TIPO } from "@/contratos/regras";
import { TIPOS_CONTRATO } from "@/db/schema";
import { DIAS_NA_ORDEM } from "@/lib/datas";
import type { EstadoRegrasRepasses } from "@/repasses/acoes";
import { DIA_FECHAMENTO_MAX, DIA_FECHAMENTO_MIN, diaDoFechamentoAtual, NOMES_DIA_SEMANA, NOMES_PERIODICIDADE, PERIODICIDADES, type RegrasRepasses } from "@/repasses/periodicidade";
import styles from "../formularios.module.css";

type Props = { regras: RegrasRepasses; salvar: (a: EstadoRegrasRepasses, f: FormData) => Promise<EstadoRegrasRepasses> };

const grupo = { border: "1px solid var(--scl-borda)", borderRadius: 8, padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 12, margin: 0 };
const legenda = { fontWeight: 500, padding: "0 6px" };
const nota = { fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 };

/** Configurações → Repasses (M4.10): dia do fechamento (M4.13), dia do semanal, dias do quinzenal e periodicidade padrão por tipo de contrato. */
export function FormRegrasRepasses({ regras, salvar }: Props) {
  const [estado, enviar] = useActionState(salvar, {});
  const v = (k: string, padrao: string) => estado.valores?.[k] ?? padrao;
  const erro = (k: keyof NonNullable<EstadoRegrasRepasses["erros"]>) => (estado.erros?.[k] ? <span className={styles.erro}>{estado.erros[k]}</span> : null);
  return (
    <form key={JSON.stringify(regras)} action={enviar} className={styles.form} aria-label="Repasses por periodicidade">
      {estado.mensagem && <p role="alert" className={styles.alerta}>{estado.mensagem}</p>}
      <fieldset style={grupo}>
        <legend style={legenda}>Dia do fechamento mensal e do relatório</legend>
        <p style={nota}>
          Dia do mês seguinte em que o mês fecha: o repasse mensal sai, o e-mail do relatório é enviado e, para quem recebe quinzenal ou semanal, o fechamento paga tudo o que
          estiver disponível. Padrão dia 2 (o Airbnb paga a reserva com check-in no último dia do mês só no dia 1º). De {DIA_FECHAMENTO_MIN} a {DIA_FECHAMENTO_MAX}. A
          mudança vale a partir do fechamento deste mês (feito no mês seguinte); fechar ou enviar antes, à mão, continua possível em Financeiro → Repasses.
        </p>
        <div className={styles.linha}>
          <label>
            Dia do fechamento
            <input name="diaFechamento" inputMode="numeric" maxLength={1} defaultValue={v("diaFechamento", String(diaDoFechamentoAtual(regras)))} aria-invalid={estado.erros?.diaFechamento ? true : undefined} />
            {erro("diaFechamento")}
          </label>
        </div>
      </fieldset>
      <fieldset style={grupo}>
        <legend style={legenda}>Dias dos repasses</legend>
        <p style={nota}>O mensal é no dia do fechamento (acima). Esse dia também conta para quem recebe quinzenal ou semanal (o fechamento paga tudo o que estiver disponível). &ldquo;Assim que disponível&rdquo; é todo dia, no dia seguinte ao check-in com o dinheiro já na empresa.</p>
        <div className={styles.linha}>
          <label>
            Semanal: dia da semana
            <select name="diaSemanal" defaultValue={v("diaSemanal", String(regras.diaSemanal))} aria-invalid={estado.erros?.diaSemanal ? true : undefined}>
              {DIAS_NA_ORDEM.map((i) => (
                <option key={i} value={i}>
                  {NOMES_DIA_SEMANA[i]}
                </option>
              ))}
            </select>
            {erro("diaSemanal")}
          </label>
          <label>
            Quinzenal: 1º dia do mês
            <input name="diaQuinzenal1" inputMode="numeric" defaultValue={v("diaQuinzenal1", String(regras.diasQuinzenal[0]))} aria-invalid={estado.erros?.diasQuinzenal ? true : undefined} />
          </label>
          <label>
            Quinzenal: 2º dia do mês
            <input name="diaQuinzenal2" inputMode="numeric" defaultValue={v("diaQuinzenal2", String(regras.diasQuinzenal[1]))} aria-invalid={estado.erros?.diasQuinzenal ? true : undefined} />
            {erro("diasQuinzenal")}
          </label>
        </div>
      </fieldset>
      <fieldset style={grupo}>
        <legend style={legenda}>Padrão por tipo de contrato</legend>
        <p style={nota}>Vale para o proprietário que não escolheu como quer receber (ele escolhe no portal; você também pode escolher no cadastro dele). Com imóveis de tipos diferentes, vale o mais frequente.</p>
        <div className={styles.linha}>
          {TIPOS_CONTRATO.map((t) => (
            <label key={t}>
              {NOMES_TIPO[t]}
              <select name={`padrao_${t}`} defaultValue={v(`padrao_${t}`, regras.padraoPorContrato[t])} aria-invalid={estado.erros?.padraoPorContrato ? true : undefined}>
                {PERIODICIDADES.map((p) => (
                  <option key={p} value={p}>
                    {NOMES_PERIODICIDADE[p]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {erro("padraoPorContrato")}
      </fieldset>
      {estado.ok && <p role="status" className={styles.sucesso}>{estado.aviso ?? "Salvo."}</p>}
      <div className={styles.acoes}>
        <button type="submit">Salvar</button>
      </div>
    </form>
  );
}
