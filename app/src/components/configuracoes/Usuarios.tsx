"use client";

import { useActionState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import type { EstadoForm } from "@/configuracoes/acoes";
import styles from "../formularios.module.css";

type Acao = (a: EstadoForm, f: FormData) => Promise<EstadoForm>;
type Usuario = { id: string; nome: string; email: string; papel: string; ativo: boolean; eu: boolean };

const PAPEIS = { admin: "Administrador", operacao: "Operação" };

function Linha({ u, alterar }: { u: Usuario; alterar: Acao }) {
  const [estado, enviar, enviando] = useActionState(alterar, {});
  return (
    <tr className={u.ativo ? undefined : styles.inativo}>
      <td>
        <form action={enviar} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="hidden" name="id" value={u.id} />
          <input name="nome" defaultValue={u.nome} aria-label={`Nome de ${u.email}`} maxLength={80} className={styles.pequeno} style={{ minWidth: 160 }} />
          <span style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>{u.email}</span>
          <select name="papel" defaultValue={u.papel} aria-label={`Papel de ${u.email}`} className={styles.pequeno} disabled={u.eu}>
            {Object.entries(PAPEIS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
          {u.eu && <input type="hidden" name="papel" value={u.papel} />}
          <button className={styles.pequeno} type="submit" name="op" value="salvar" disabled={enviando}>
            Salvar
          </button>
          {!u.eu &&
            (u.ativo ? (
              <BotaoConfirmar className={styles.pequeno} name="op" value="desativar" disabled={enviando} pergunta={`Desativar o acesso de ${u.email}? A pessoa deixa de entrar na hora.`}>
                Desativar
              </BotaoConfirmar>
            ) : (
              <button className={styles.pequeno} type="submit" name="op" value="reativar" disabled={enviando}>
                Reativar
              </button>
            ))}
          {u.eu && <span className={styles.etiqueta}>você</span>}
          {estado.mensagem && <span className={styles.erro}>{estado.mensagem}</span>}
        </form>
      </td>
      <td>
        <span className={styles.etiqueta}>{u.ativo ? "Ativo" : "Desativado"}</span>
      </td>
    </tr>
  );
}

export function Usuarios({ lista, criar, alterar }: { lista: Usuario[]; criar: Acao; alterar: Acao }) {
  const [estado, enviar, enviando] = useActionState(criar, {});
  return (
    <>
      <form action={enviar} className={styles.form} aria-label="Novo usuário da equipe">
        <div className={styles.linha}>
          <label>
            Nome
            <input name="nome" required maxLength={80} defaultValue={estado.valores?.nome} />
          </label>
          <label className={styles.largo}>
            E-mail
            <input name="email" type="email" required maxLength={200} defaultValue={estado.valores?.email} />
          </label>
          <label>
            Papel
            <select name="papel" defaultValue={estado.valores?.papel ?? "operacao"}>
              {Object.entries(PAPEIS).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        {estado.mensagem && (
          <p role="alert" className={styles.alerta}>
            {estado.mensagem}
          </p>
        )}
        {estado.ok && (
          <p role="status" className={styles.sucesso}>
            Usuário criado. Ele entra em /entrar com o código por e-mail ou com a conta Google desse e-mail.
          </p>
        )}
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            Adicionar
          </button>
        </div>
      </form>
      <div className={styles.rolagem}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((u) => (
              <Linha key={`${u.id}:${u.papel}:${u.ativo}:${u.nome}`} u={u} alterar={alterar} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
