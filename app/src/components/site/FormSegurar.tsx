"use client";

import { useActionState } from "react";
import type { EstadoSegurar } from "@/site/acoes";
import styles from "./site.module.css";

type Acao = (a: EstadoSegurar, f: FormData) => Promise<EstadoSegurar>;

/** Contato do visitante para segurar as datas da cotação (M8.1). O servidor decide; aqui só o formulário. */
export function FormSegurar({ codigo, minutos, acao }: { codigo: string; minutos: number; acao: Acao }) {
  const [estado, enviar, enviando] = useActionState(acao, {} as EstadoSegurar);
  const v = estado.valores ?? {};
  const e = estado.erros ?? {};
  const erro = (k: string) => (e[k] ? <span className={styles.erro}>{e[k]}</span> : null);
  return (
    <form action={enviar} className={styles.formulario} aria-label="Segurar as datas">
      <strong>Segurar as datas por {minutos} minutos</strong>
      <p className={styles.miudo} style={{ margin: 0 }}>
        Seus dados vão só para a equipe, para confirmar a reserva com você. Nenhum pagamento é feito aqui.
      </p>
      <input type="hidden" name="codigo" value={codigo} />
      <label>
        Nome
        <input name="nome" required maxLength={120} autoComplete="name" defaultValue={v.nome} aria-invalid={e.nome ? true : undefined} />
        {erro("nome")}
      </label>
      <label>
        E-mail
        <input name="email" type="email" required maxLength={120} autoComplete="email" defaultValue={v.email} aria-invalid={e.email ? true : undefined} />
        {erro("email")}
      </label>
      <label>
        WhatsApp (com DDD)
        <input name="telefone" type="tel" required maxLength={40} autoComplete="tel" defaultValue={v.telefone} aria-invalid={e.telefone ? true : undefined} />
        {erro("telefone")}
      </label>
      {estado.erro && (
        <p role="alert" className={styles.aviso}>
          {estado.erro}
          {estado.motivos?.length ? ` ${estado.motivos.join(" ")}` : ""}
        </p>
      )}
      <button type="submit" className={styles.botao} disabled={enviando}>
        {enviando ? "Segurando…" : "Segurar as datas"}
      </button>
    </form>
  );
}
