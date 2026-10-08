"use client";

import { useActionState } from "react";
import type { EstadoForm } from "@/configuracoes/acoes";
import { type ErrosMercado, LINHAS_MERCADO } from "@/configuracoes/pagina-proprietarios";
import styles from "../formularios.module.css";

const nota = { fontSize: "0.8125rem", color: "var(--scl-texto-2)", margin: 0 } as const;

/**
 * Faixa de mercado da página para proprietários (M7.7): até seis linhas por tipo de imóvel, com o mês e a fonte dos
 * números. Linha vazia é ignorada; sem linhas, a seção não aparece no site.
 */
export function FormMercado({ valores, salvar }: { valores: Record<string, string>; salvar: (a: EstadoForm<ErrosMercado>, f: FormData) => Promise<EstadoForm<ErrosMercado>> }) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  const campo = (nome: string, rotulo: string, extra: { inputMode?: "decimal" | "text"; type?: string; maxLength?: number } = {}) => {
    const erro = estado.erros?.[nome];
    return (
      <label>
        {rotulo}
        <input
          name={nome}
          type={extra.type ?? "text"}
          inputMode={extra.inputMode}
          maxLength={extra.maxLength}
          defaultValue={estado.valores?.[nome] ?? valores[nome] ?? ""}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `erro-${nome}` : undefined}
        />
        {erro && (
          <span className={styles.erro} id={`erro-${nome}`}>
            {erro}
          </span>
        )}
      </label>
    );
  };
  return (
    <form key={JSON.stringify(valores)} action={enviar} className={styles.form} aria-label="Faixa de mercado">
      <h2 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 500 }}>Faixa de mercado</h2>
      <p style={nota}>
        Números de referência por tipo de imóvel. Use só dados reais que você conferiu (por exemplo, as reservas dos imóveis que administramos), e diga o mês e
        de onde vêm. A página mostra sempre que é uma estimativa, sem garantia. Sem nenhuma linha, a seção não aparece.
      </p>
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      <div className={styles.linha}>
        {campo("referencia", "Mês dos números", { type: "month" })}
        {campo("fonte", "De onde vêm os números", { maxLength: 160 })}
      </div>
      {Array.from({ length: LINHAS_MERCADO }, (_, i) => (
        <fieldset key={i} className={styles.linha} style={{ border: 0, padding: 0, margin: 0 }} aria-label={`Linha ${i + 1}`}>
          {campo(`tipo_${i}`, "Tipo de imóvel", { maxLength: 40 })}
          {campo(`diaria_${i}`, "Diária média (R$)", { inputMode: "decimal" })}
          {campo(`ocupacao_${i}`, "Ocupação (%)", { inputMode: "decimal" })}
          {campo(`liquido_${i}`, "Líquido por mês (R$, opcional)", { inputMode: "decimal" })}
        </fieldset>
      ))}
      {estado.ok && (
        <p role="status" className={styles.sucesso}>
          {estado.aviso ?? "Salvo."}
        </p>
      )}
      <div className={styles.acoes}>
        <button type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
