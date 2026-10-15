"use client";

import { useActionState } from "react";
import type { EstadoForm } from "@/configuracoes/acoes";
import styles from "../formularios.module.css";

/** `nota`: um aviso curto sobre o valor salvo (ex.: o campo "Site", M7.13), abaixo da dica. */
export type Campo = { nome: string; rotulo: string; limite: number; linhas?: number; tipo?: string; dica?: string; nota?: string | null; obrigatorio?: boolean };

/** Formulário simples de campos de texto (empresa, textos do site), com erros por campo. */
export function FormCampos({
  titulo,
  campos,
  valores,
  salvar,
}: {
  titulo: string;
  campos: readonly Campo[];
  valores: Record<string, string>;
  salvar: (a: EstadoForm<Record<string, string>>, f: FormData) => Promise<EstadoForm<Record<string, string>>>;
}) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  return (
    <form key={JSON.stringify(valores)} action={enviar} className={styles.form} aria-label={titulo}>
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      {campos.map((c) => {
        const erro = estado.erros?.[c.nome];
        const props = {
          name: c.nome,
          defaultValue: estado.valores?.[c.nome] ?? valores[c.nome] ?? "",
          maxLength: c.limite,
          required: c.obrigatorio,
          "aria-invalid": erro ? true : undefined,
          "aria-describedby": erro ? `erro-${c.nome}` : undefined,
        };
        return (
          <label key={c.nome}>
            {c.rotulo}
            {c.linhas && c.linhas > 1 ? <textarea rows={c.linhas} {...props} /> : <input type={c.tipo ?? "text"} {...props} />}
            {c.dica && <span style={{ fontSize: "0.8125rem" }}>{c.dica}</span>}
            {c.nota && (
              <span role="note" style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>
                {c.nota}
              </span>
            )}
            {erro && (
              <span className={styles.erro} id={`erro-${c.nome}`}>
                {erro}
              </span>
            )}
          </label>
        );
      })}
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
