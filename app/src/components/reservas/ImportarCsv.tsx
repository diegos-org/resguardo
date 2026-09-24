"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { EstadoImportacao } from "@/reservas/acoes";
import { LIMITE_BYTES, MODELO_CSV } from "@/reservas/csv-modelo";
import styles from "../formularios.module.css";

const SITUACAO = {
  nova: { texto: "Nova", cor: "#e3efe0" },
  atualiza: { texto: "Atualiza", cor: "#e8eef7" },
  igual: { texto: "Já importada, igual", cor: "#eeeeee" },
  erro: { texto: "Com erro", cor: "#fbeaea" },
};

/** Planilha salva pelo Excel brasileiro costuma vir em Windows-1252; o resto, UTF-8. */
async function lerArquivo(f: File): Promise<string> {
  const bytes = await f.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function ImportarCsv({ acao }: { acao: (a: EstadoImportacao, f: FormData) => Promise<EstadoImportacao> }) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  const [texto, setTexto] = useState("");
  const [nome, setNome] = useState("");
  const [erroArquivo, setErroArquivo] = useState("");
  // Qual texto foi conferido (guardado aqui, não no estado do servidor, para o arquivo ir uma vez só).
  const [conferidoCom, setConferidoCom] = useState<string | null>(null);
  const conferido = conferidoCom === texto && !estado.erroGeral && estado.linhas;
  const validas = estado.linhas?.filter((l) => l.situacao !== "erro").length ?? 0;
  const contagem = (s: keyof typeof SITUACAO) => estado.linhas?.filter((l) => l.situacao === s).length ?? 0;

  return (
    <>
      <div className={styles.form}>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
          Colunas obrigatórias: <strong>imovel</strong> (código, ex.: 403), <strong>origem</strong> (airbnb, booking, site, direta ou outro),{" "}
          <strong>codigo_canal</strong> (o código da reserva no canal), <strong>entrada</strong> e <strong>saida</strong> (DD/MM/AAAA). Opcionais:
          situacao, hospedes, nome, email, telefone, cidade, valor_bruto, taxa_canal, valor_liquido, observacoes. Pode salvar do Excel
          como “CSV (separado por ponto e vírgula)”.{" "}
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + MODELO_CSV)}`} download="modelo-reservas.csv">
            Baixar o modelo
          </a>
          .
        </p>
        <label>
          Arquivo CSV
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setErroArquivo("");
              if (!f) return;
              if (f.size > LIMITE_BYTES) {
                setErroArquivo("Arquivo acima de 900 KB: divida em partes.");
                setTexto("");
                return;
              }
              setNome(f.name);
              setTexto(await lerArquivo(f));
            }}
          />
        </label>
        {erroArquivo && <p className={styles.alerta}>{erroArquivo}</p>}
        <form action={enviar} className={styles.acoes}>
          <input type="hidden" name="texto" value={texto} />
          <button type="submit" name="op" value="conferir" disabled={!texto || enviando} onClick={() => setConferidoCom(texto)}>
            {enviando ? "Aguarde…" : "Conferir (não grava nada)"}
          </button>
          {conferido && validas > 0 && (
            <button type="submit" name="op" value="importar" disabled={enviando}>
              Importar {validas} reserva(s)
            </button>
          )}
        </form>
        {nome && !estado.resultado && <p style={{ margin: 0, fontSize: "0.875rem" }}>Arquivo: {nome}</p>}
      </div>

      {estado.erroGeral && (
        <p role="alert" className={styles.alerta}>
          {estado.erroGeral}
        </p>
      )}

      {estado.resultado && (
        <p role="status" className={styles.sucesso}>
          Importação concluída: {estado.resultado.criadas} nova(s), {estado.resultado.atualizadas} atualizada(s), {estado.resultado.iguais} já estavam iguais
          {estado.resultado.comErro ? `, ${estado.resultado.comErro} com erro (ficaram de fora)` : ""}. <Link href="/painel/reservas">Ver reservas</Link>
        </p>
      )}
      {estado.resultado && estado.resultado.avisosFinanceiro.length > 0 && (
        <div className={styles.alerta}>
          <strong>Financeiro com pendências:</strong> estas reservas entraram, mas o cálculo avisou:
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {estado.resultado.avisosFinanceiro.map((a) => (
              <li key={a.linha}>
                Linha {a.linha}: {a.avisos.join(" ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {estado.resultado && estado.resultado.semRecalculo.length > 0 && (
        <p role="alert" className={styles.alerta}>
          Atenção: {estado.resultado.semRecalculo.length === 1 ? "a reserva da linha" : "as reservas das linhas"} {estado.resultado.semRecalculo.join(", ")}{" "}
          {estado.resultado.semRecalculo.length === 1 ? "foi atualizada" : "foram atualizadas"}, mas já tinha(m) dinheiro movimentado: o financeiro
          ficou como estava. Confira na ficha da reserva e, se precisar, faça um ajuste manual.
        </p>
      )}

      {conferido && estado.linhas && (
        <section aria-label="Conferência" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0 }}>
            {estado.linhas.length} linha(s): {contagem("nova")} nova(s), {contagem("atualiza")} a atualizar, {contagem("igual")} já importada(s) e iguais,{" "}
            {contagem("erro")} com erro. {contagem("erro") > 0 && "As linhas com erro não serão importadas; corrija a planilha e confira de novo."}
          </p>
          {estado.colunasIgnoradas && estado.colunasIgnoradas.length > 0 && (
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>Colunas ignoradas: {estado.colunasIgnoradas.join(", ")}.</p>
          )}
          <div className={styles.rolagem}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Situação</th>
                  <th>Reserva</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {estado.linhas.map((l) => (
                  <tr key={l.numero}>
                    <td>{l.numero}</td>
                    <td>
                      <span className={styles.etiqueta} style={{ background: SITUACAO[l.situacao].cor }}>
                        {SITUACAO[l.situacao].texto}
                      </span>
                    </td>
                    <td>{l.resumo || "—"}</td>
                    <td style={{ fontSize: "0.8125rem" }}>
                      {l.erros.map((e) => (
                        <div key={e} style={{ color: "#7a2020" }}>
                          {e}
                        </div>
                      ))}
                      {l.avisos.map((a) => (
                        <div key={a} style={{ color: "#7a4a00" }}>
                          ⚠ {a}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
