"use client";

import { useActionState } from "react";
import type { EstadoCategoria } from "@/despesas/acoes";
import styles from "../formularios.module.css";

type Acao = (a: EstadoCategoria, f: FormData) => Promise<EstadoCategoria>;
type Categoria = { id: string; nome: string; ativa: boolean };

function Linha({ c, editar }: { c: Categoria; editar: Acao }) {
  const [estado, enviar, enviando] = useActionState(editar, {});
  return (
    <tr className={c.ativa ? undefined : styles.inativo}>
      <td>
        <form action={enviar} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="hidden" name="id" value={c.id} />
          <input name="nome" defaultValue={c.nome} aria-label={`Nome da categoria ${c.nome}`} maxLength={60} className={styles.pequeno} style={{ minWidth: 200 }} />
          <button className={styles.pequeno} type="submit" name="op" value="renomear" disabled={enviando}>
            Renomear
          </button>
          {c.ativa ? (
            <button className={styles.pequeno} type="submit" name="op" value="arquivar" disabled={enviando}>
              Arquivar
            </button>
          ) : (
            <button className={styles.pequeno} type="submit" name="op" value="reativar" disabled={enviando}>
              Reativar
            </button>
          )}
          <button
            className={styles.pequeno}
            type="submit"
            name="op"
            value="excluir"
            disabled={enviando}
            onClick={(ev) => {
              if (!confirm(`Excluir a categoria "${c.nome}"? Só é possível se nunca foi usada.`)) ev.preventDefault();
            }}
          >
            Excluir
          </button>
          {estado.erro && <span className={styles.erro}>{estado.erro}</span>}
        </form>
      </td>
      <td>
        <span className={styles.etiqueta}>{c.ativa ? "Ativa" : "Arquivada"}</span>
      </td>
    </tr>
  );
}

export function Categorias({ categorias, criar, editar }: { categorias: Categoria[]; criar: Acao; editar: Acao }) {
  const [estado, enviar, enviando] = useActionState(criar, {});
  return (
    <>
      <form action={enviar} className={styles.form} aria-label="Nova categoria">
        <div className={styles.linha}>
          <label>
            Nova categoria
            <input name="nome" required maxLength={60} aria-invalid={estado.erro ? true : undefined} />
            {estado.erro && <span className={styles.erro}>{estado.erro}</span>}
          </label>
        </div>
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
              <th>Categoria</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {categorias.map((c) => (
              <Linha key={c.id} c={c} editar={editar} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
