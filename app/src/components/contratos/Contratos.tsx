"use client";

import { useActionState, useEffect, useRef } from "react";
import type { EstadoContrato } from "@/contratos/acoes";
import type { Contrato } from "@/contratos/repositorio";
import { bpParaTexto, COMISSAO_PADRAO_BP, NOMES_TIPO } from "@/contratos/regras";
import styles from "../formularios.module.css";
import { BotaoConfirmar } from "../BotaoConfirmar";

type Acao = (a: EstadoContrato, f: FormData) => Promise<EstadoContrato>;
type Props = { imovelId: string; lista: Contrato[]; hoje: string; criar: Acao; encerrar: Acao; podeEditar: boolean };

const dataBr = (d: string) => d.split("-").reverse().join("/");

function Encerrar({ c, imovelId, acao }: { c: Contrato; imovelId: string; acao: Acao }) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  return (
    <form action={enviar} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="contratoId" value={c.id} />
      <input type="hidden" name="imovelId" value={imovelId} />
      <input type="date" name="fim" required aria-label="Último dia do contrato" min={c.inicio} style={{ font: "inherit", padding: 4 }} />
      <BotaoConfirmar
        pergunta="Encerrar este contrato na data escolhida? Não dá para estender depois, só criar um contrato novo."
        disabled={enviando}
        style={{ font: "inherit", fontSize: "0.875rem", padding: "4px 10px", borderRadius: 6, border: "1px solid #d8d0c0", background: "#fff", cursor: "pointer" }}
      >
        Encerrar
      </BotaoConfirmar>
      {estado.mensagem && <span className={styles.erro}>{estado.mensagem}</span>}
    </form>
  );
}

export function Contratos({ imovelId, lista, hoje, criar, encerrar, podeEditar }: Props) {
  const [estado, enviar, enviando] = useActionState(criar, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok) form.current?.reset();
  }, [estado]);
  const e = estado.erros ?? {};

  return (
    <section aria-label="Contratos de gestão" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.25rem" }}>Contratos de gestão</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
        Cada mudança de percentual é um novo contrato com data de início. Reservas antigas continuam com o contrato da época.
      </p>
      {lista.length === 0 ? (
        <p>Nenhum contrato cadastrado.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Empresa / proprietário</th>
                <th>Vigência</th>
                <th>Situação</th>
                {podeEditar && <th>Encerrar</th>}
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const vigente = c.inicio <= hoje && (c.fim === null || hoje <= c.fim);
                const futuro = c.inicio > hoje;
                return (
                  <tr key={c.id}>
                    <td>{NOMES_TIPO[c.tipo]}</td>
                    <td>{c.comissaoBp === null ? "fórmula a definir" : `${bpParaTexto(c.comissaoBp)} / ${bpParaTexto(10000 - c.comissaoBp)}`}</td>
                    <td>
                      {dataBr(c.inicio)} → {c.fim ? dataBr(c.fim) : "sem fim"}
                    </td>
                    <td>
                      <span className={styles.etiqueta}>{vigente ? "Em vigor" : futuro ? "Futuro" : "Encerrado"}</span>
                    </td>
                    {podeEditar && <td>{(c.fim === null || c.fim >= hoje) && <Encerrar c={c} imovelId={imovelId} acao={encerrar} />}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {podeEditar && (
        <form ref={form} action={enviar} className={styles.form} aria-label="Novo contrato">
          <input type="hidden" name="imovelId" value={imovelId} />
          {e.geral && (
            <p role="alert" className={styles.alerta}>
              {e.geral}
            </p>
          )}
          <div className={styles.linha}>
            <label>
              Tipo
              <select name="tipo" defaultValue="gestao_completa">
                {Object.entries(NOMES_TIPO).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n} {COMISSAO_PADRAO_BP[v as keyof typeof NOMES_TIPO] !== null ? `(${bpParaTexto(COMISSAO_PADRAO_BP[v as keyof typeof NOMES_TIPO])})` : ""}
                  </option>
                ))}
              </select>
              {e.tipo && <span className={styles.erro}>{e.tipo}</span>}
            </label>
            <label>
              % da empresa
              <input name="comissao" inputMode="decimal" placeholder="15" aria-invalid={e.comissao ? true : undefined} />
              {e.comissao && <span className={styles.erro}>{e.comissao}</span>}
            </label>
            <label>
              Início
              <input type="date" name="inicio" required aria-invalid={e.inicio ? true : undefined} />
              {e.inicio && <span className={styles.erro}>{e.inicio}</span>}
            </label>
            <label>
              Fim (opcional)
              <input type="date" name="fim" aria-invalid={e.fim ? true : undefined} />
              {e.fim && <span className={styles.erro}>{e.fim}</span>}
            </label>
          </div>
          <label>
            Observações
            <input name="observacoes" />
          </label>
          <div className={styles.acoes}>
            <button type="submit" disabled={enviando}>
              Adicionar contrato
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
