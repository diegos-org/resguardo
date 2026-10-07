"use client";

import { useActionState, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import type { EstadoSenhaProfissional } from "@/limpezas/acoes";

type Props = {
  profissionalId: string;
  nome: string;
  /** Usuário atual (se já tem). */
  login: string | null;
  temSenha: boolean;
  senhaProvisoria: boolean;
  definir: (a: EstadoSenhaProfissional, f: FormData) => Promise<EstadoSenhaProfissional>;
};

/**
 * Usuário e senha provisória da profissional (M6.8), para quem não usa e-mail. A senha aparece uma vez, logo depois de
 * salvar, para copiar e mandar pelo WhatsApp; depois disso nem a empresa a vê (só dá para definir outra).
 */
export function SenhaProfissional({ profissionalId, nome, login, temSenha, senhaProvisoria, definir }: Props) {
  const [estado, enviar, enviando] = useActionState(definir, {});
  const [copiado, setCopiado] = useState(false);
  const mensagem = estado.ok && estado.login && estado.senha ? `Seu acesso à agenda da equipe:\nUsuário: ${estado.login}\nSenha: ${estado.senha}\nEntre em /entrar, em "Entrar com usuário e senha". Depois, troque a senha em "Minha senha".` : "";
  return (
    <form action={enviar} className={styles.linha} style={{ alignItems: "flex-end" }} aria-label={`Usuário e senha de ${nome}`}>
      <input type="hidden" name="id" value={profissionalId} />
      <label style={{ flex: "1 1 180px" }}>
        Usuário (para entrar sem e-mail)
        <input name="login" defaultValue={login ?? ""} placeholder="ex.: maria.limpeza" maxLength={40} autoCapitalize="none" spellCheck={false} required />
      </label>
      <label style={{ flex: "1 1 180px" }}>
        Senha provisória
        <input name="senha" type="text" placeholder="em branco: o sistema cria uma" maxLength={128} autoComplete="off" spellCheck={false} />
      </label>
      <div className={styles.acoes}>
        <BotaoConfirmar
          pergunta={temSenha ? `Definir uma senha nova para ${nome}? A senha antiga deixa de valer e ela precisa entrar de novo.` : `Criar o usuário e a senha de ${nome}?`}
          className={styles.pequeno}
          disabled={enviando}
        >
          {temSenha ? "Definir senha nova" : "Criar usuário e senha"}
        </BotaoConfirmar>
        <span style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
          {login ? `Usuário ${login}${temSenha ? (senhaProvisoria ? ", senha provisória (ainda não trocada)" : ", senha trocada por ela") : ", sem senha"}` : "Sem usuário"}
        </span>
      </div>
      {estado.erro && (
        <p role="alert" className={styles.erro} style={{ flexBasis: "100%", margin: 0 }}>
          {estado.erro}
        </p>
      )}
      {mensagem && (
        <div role="status" className={styles.sucesso} style={{ flexBasis: "100%", display: "grid", gap: 6 }}>
          <span>
            Pronto. Mande para {nome} pelo WhatsApp — <strong>a senha não aparece de novo</strong>:
          </span>
          <code style={{ whiteSpace: "pre-wrap", userSelect: "all" }}>{mensagem}</code>
          <button
            type="button"
            className={styles.pequeno}
            onClick={() => {
              void navigator.clipboard?.writeText(mensagem).then(() => setCopiado(true));
            }}
          >
            {copiado ? "Copiado" : "Copiar mensagem"}
          </button>
        </div>
      )}
    </form>
  );
}
