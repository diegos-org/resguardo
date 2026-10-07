"use client";

import { useActionState } from "react";
import styles from "@/components/portal/portal.module.css";
import type { EstadoMinhaSenha } from "@/equipe/acoes";
import { SENHA_MINIMA } from "@/acesso/senha-regras";

type Props = {
  /** Já tem senha (aí pede a atual). */
  temSenha: boolean;
  provisoria: boolean;
  trocar: (a: EstadoMinhaSenha, f: FormData) => Promise<EstadoMinhaSenha>;
};

/** Criar ou trocar a própria senha (M6.8). Quem entrou pelo código ou pelo Google pode criar uma para entrar sem e-mail. */
export function MinhaSenha({ temSenha, provisoria, trocar }: Props) {
  const [estado, enviar, enviando] = useActionState(trocar, {});
  return (
    <details className={styles.caixa} open={provisoria && !estado.ok}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>{temSenha ? "Minha senha" : "Criar uma senha"}</summary>
      {provisoria && !estado.ok && <p className={styles.miudo}>Sua senha foi criada pela empresa. Troque por uma que só você saiba.</p>}
      <form action={enviar} style={{ display: "grid", gap: 12, marginTop: 12 }} aria-label={temSenha ? "Trocar minha senha" : "Criar minha senha"}>
        {temSenha && (
          <label className={styles.campo}>
            Senha atual
            <input name="atual" type="password" autoComplete="current-password" required maxLength={128} />
          </label>
        )}
        <label className={styles.campo}>
          Senha nova (pelo menos {SENHA_MINIMA} caracteres)
          <input name="nova" type="password" autoComplete="new-password" required minLength={SENHA_MINIMA} maxLength={128} />
        </label>
        <label className={styles.campo}>
          Repita a senha nova
          <input name="repetir" type="password" autoComplete="new-password" required minLength={SENHA_MINIMA} maxLength={128} />
        </label>
        {estado.erro && (
          <p role="alert" className={styles.alerta}>
            {estado.erro}
          </p>
        )}
        {estado.ok && (
          <p role="status" className={styles.sucesso}>
            Senha salva. Da próxima vez, entre com o seu usuário (ou e-mail) e esta senha.
          </p>
        )}
        <button type="submit" className={styles.botao} disabled={enviando}>
          Salvar senha
        </button>
      </form>
    </details>
  );
}
