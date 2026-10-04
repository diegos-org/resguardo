"use client";

import { useActionState } from "react";
import type { EstadoForm } from "@/configuracoes/acoes";
import { SECOES_COMO_FUNCIONA, type SecoesComoFunciona } from "@/configuracoes/como-funciona";
import styles from "../formularios.module.css";

type Props = {
  /** Versão publicada agora; null = nada publicado (o formulário traz o rascunho sugerido). */
  atual: { numero: number; data: string } | null;
  valores: SecoesComoFunciona;
  salvar: (a: EstadoForm<Record<string, string>>, f: FormData) => Promise<EstadoForm<Record<string, string>>>;
};

const br = (d: string) => d.split("-").reverse().join("/");

/** Texto do "Como funciona" por seção (M5.6). Publicar com texto diferente cria a versão seguinte e pede novo aceite. */
export function FormComoFunciona({ atual, valores, salvar }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  const proxima = (atual?.numero ?? 0) + 1;
  return (
    <form key={JSON.stringify(valores)} action={enviar} className={styles.form} aria-label="Como funciona para o proprietário">
      <input type="hidden" name="versaoBase" value={atual?.numero ?? 0} />
      {!atual ? (
        <p role="note" style={{ margin: 0, fontSize: "0.875rem", padding: "10px 14px", borderLeft: "3px solid var(--scl-dourado)", background: "var(--scl-papel)" }}>
          <strong>Nenhuma versão publicada ainda.</strong> O texto abaixo é um rascunho sugerido a partir das regras que já valem no sistema: revise com calma, ajuste o que quiser e clique em
          &ldquo;Publicar a versão 1&rdquo;. Até lá o portal não mostra o documento nem pede aceite. &ldquo;Contestações&rdquo; ficou em branco de propósito (decisão pendente): seção vazia não
          aparece para o proprietário.
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
          Versão {atual.numero}, publicada em {br(atual.data)}. Mudou o texto? Ao publicar nasce a versão {proxima}, datada de hoje, e todos os proprietários precisam aceitar de novo.
        </p>
      )}
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      {SECOES_COMO_FUNCIONA.map((s) => {
        const erro = estado.erros?.[s.chave];
        return (
          <label key={s.chave}>
            {s.titulo}
            <textarea
              name={s.chave}
              rows={6}
              maxLength={s.limite}
              defaultValue={estado.valores?.[s.chave] ?? valores[s.chave] ?? ""}
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? `erro-${s.chave}` : undefined}
            />
            <span style={{ fontSize: "0.8125rem" }}>
              {s.dica} Até {s.limite} caracteres; linha em branco separa parágrafos; escreva {"{empresa}"} para o nome da empresa.
            </span>
            {erro && (
              <span className={styles.erro} id={`erro-${s.chave}`}>
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
        <button
          type="submit"
          disabled={enviando}
          onClick={(ev) => {
            if (!window.confirm(`Publicar a versão ${proxima} do "Como funciona"? Se o texto mudou, todos os proprietários vão precisar ler e aceitar de novo no portal. Se nada mudou, nenhuma versão nova é criada.`)) ev.preventDefault();
          }}
        >
          {enviando ? "Publicando…" : `Publicar a versão ${proxima}`}
        </button>
      </div>
    </form>
  );
}
