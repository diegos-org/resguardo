"use client";

import { useActionState, useState } from "react";
import type { EstadoConvite } from "@/convites/acoes";
import styles from "../formularios.module.css";

type LinhaConvite = { id: string; email: string; situacao: string; criadoEm: string; expiraEm: string; aceitoEm: string | null };

const NOMES: Record<string, string> = { pendente: "Pendente", aceito: "Aceito", revogado: "Cancelado", vencido: "Vencido" };
const data = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

type Props = {
  proprietarioId: string;
  emailPadrao: string;
  convites: LinhaConvite[];
  convidar: (a: EstadoConvite, f: FormData) => Promise<EstadoConvite>;
  revogar: (f: FormData) => Promise<void>;
};

export function Convites({ proprietarioId, emailPadrao, convites, convidar, revogar }: Props) {
  const [estado, enviar, enviando] = useActionState(convidar, {});
  const [copiado, setCopiado] = useState(false);
  return (
    <section aria-label="Convite para o portal" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.25rem" }}>Acesso ao portal</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
        Gere um convite: o proprietário abre o link e entra com o e-mail convidado. O link vale 7 dias e só pode ser usado uma vez.
      </p>
      <form action={enviar} className={styles.form}>
        <input type="hidden" name="proprietarioId" value={proprietarioId} />
        <div className={styles.linha}>
          <label>
            E-mail do proprietário
            <input type="email" name="email" defaultValue={emailPadrao} required aria-invalid={estado.erro ? true : undefined} />
            {estado.erro && <span className={styles.erro}>{estado.erro}</span>}
          </label>
        </div>
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            {enviando ? "Gerando…" : "Gerar convite"}
          </button>
        </div>
      </form>
      {estado.link && (
        <div role="status" className={styles.sucesso} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span>
            Convite criado para <strong>{estado.email}</strong>.{" "}
            {estado.enviadoPorEmail ? "Mandamos o link por e-mail; você também pode enviar pelo WhatsApp:" : "Envie este link (por WhatsApp, por exemplo):"}
          </span>
          <code style={{ wordBreak: "break-all", fontSize: "0.8125rem" }}>{estado.link}</code>
          <button
            type="button"
            className={styles.pequeno}
            style={{ alignSelf: "flex-start" }}
            onClick={() => navigator.clipboard.writeText(estado.link!).then(() => setCopiado(true))}
          >
            {copiado ? "Copiado!" : "Copiar link"}
          </button>
          <span style={{ fontSize: "0.8125rem" }}>O link aparece só agora. Se perder, gere outro (o anterior é cancelado).</span>
        </div>
      )}
      {convites.length > 0 && (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Criado</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {convites.map((c) => (
                <tr key={c.id}>
                  <td>{c.email}</td>
                  <td>{data(c.criadoEm)}</td>
                  <td>
                    <span className={styles.etiqueta}>
                      {NOMES[c.situacao] ?? c.situacao}
                      {c.situacao === "pendente" && ` até ${data(c.expiraEm)}`}
                      {c.aceitoEm && ` em ${data(c.aceitoEm)}`}
                    </span>
                  </td>
                  <td>
                    {c.situacao === "pendente" && (
                      <form action={revogar}>
                        <input type="hidden" name="proprietarioId" value={proprietarioId} />
                        <input type="hidden" name="conviteId" value={c.id} />
                        <button type="submit" className={styles.pequeno}>
                          Cancelar
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
