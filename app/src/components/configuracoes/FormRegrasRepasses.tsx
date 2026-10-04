"use client";

import { useActionState } from "react";
import { NOMES_TIPO } from "@/contratos/regras";
import { TIPOS_CONTRATO } from "@/db/schema";
import type { EstadoRegrasRepasses } from "@/repasses/acoes";
import { NOMES_DIA_SEMANA, NOMES_PERIODICIDADE, PERIODICIDADES, type RegrasRepasses } from "@/repasses/periodicidade";
import styles from "../formularios.module.css";

type Props = { regras: RegrasRepasses; salvar: (a: EstadoRegrasRepasses, f: FormData) => Promise<EstadoRegrasRepasses> };

const grupo = { border: "1px solid var(--scl-areia)", borderRadius: 8, padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 12, margin: 0 };
const legenda = { fontWeight: 500, padding: "0 6px" };
const nota = { fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 };

/** Configurações → Repasses (M4.10): dia do semanal, dias do quinzenal e periodicidade padrão por tipo de contrato. */
export function FormRegrasRepasses({ regras, salvar }: Props) {
  const [estado, enviar] = useActionState(salvar, {});
  const v = (k: string, padrao: string) => estado.valores?.[k] ?? padrao;
  const erro = (k: keyof NonNullable<EstadoRegrasRepasses["erros"]>) => (estado.erros?.[k] ? <span className={styles.erro}>{estado.erros[k]}</span> : null);
  return (
    <form key={JSON.stringify(regras)} action={enviar} className={styles.form} aria-label="Repasses por periodicidade">
      {estado.mensagem && <p role="alert" className={styles.alerta}>{estado.mensagem}</p>}
      <fieldset style={grupo}>
        <legend style={legenda}>Dias dos repasses</legend>
        <p style={nota}>O mensal é sempre no dia 1º, junto com o fechamento do mês. O dia 1º também conta para quem recebe quinzenal ou semanal (o fechamento paga tudo o que estiver disponível). &ldquo;Assim que disponível&rdquo; é todo dia, no dia seguinte ao check-in com o dinheiro já na empresa.</p>
        <div className={styles.linha}>
          <label>
            Semanal: dia da semana
            <select name="diaSemanal" defaultValue={v("diaSemanal", String(regras.diaSemanal))} aria-invalid={estado.erros?.diaSemanal ? true : undefined}>
              {NOMES_DIA_SEMANA.map((n, i) => (
                <option key={n} value={i}>
                  {n}
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
