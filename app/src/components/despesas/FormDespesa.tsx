"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { EstadoFormDespesa } from "@/despesas/acoes";
import styles from "../formularios.module.css";

type Props = {
  acao: (a: EstadoFormDespesa, f: FormData) => Promise<EstadoFormDespesa>;
  imoveis: { id: string; codigo: string; nome: string }[];
  proprietarios: { id: string; nome: string }[];
  categorias: { id: string; nome: string }[];
  hoje: string;
};

export function FormDespesa({ acao, imoveis, proprietarios, categorias, hoje }: Props) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  const [responsavel, setResponsavel] = useState<"empresa" | "proprietario">("empresa");
  const [paga, setPaga] = useState(false);
  const e = estado.erros ?? {};
  const erro = (c: keyof typeof e) => (e[c] ? <span className={styles.erro}>{e[c]}</span> : null);
  const inv = (c: keyof typeof e) => (e[c] ? { "aria-invalid": true } : {});
  const doProprietario = responsavel === "proprietario";

  return (
    <form action={enviar} className={styles.form} aria-label="Nova despesa">
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <legend style={{ fontSize: "0.875rem", marginBottom: 4 }}>De quem é a despesa?</legend>
        <label className={styles.check}>
          <input type="radio" name="responsavel" value="empresa" checked={!doProprietario} onChange={() => setResponsavel("empresa")} />
          Da empresa (custo da SCL)
        </label>
        <label className={styles.check}>
          <input type="radio" name="responsavel" value="proprietario" checked={doProprietario} onChange={() => setResponsavel("proprietario")} />
          Do proprietário (cobrar dele)
        </label>
        {erro("responsavel")}
      </fieldset>
      <div className={styles.linha}>
        <label>
          Categoria
          <select name="categoriaId" defaultValue="" required {...inv("categoriaId")}>
            <option value="" disabled>
              Escolha…
            </option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          {erro("categoriaId")}
        </label>
        <label>
          Valor (R$)
          <input name="valor" inputMode="decimal" placeholder="1.234,56" required {...inv("valor")} />
          {erro("valor")}
        </label>
        <label>
          Data
          <input type="date" name="data" defaultValue={hoje} required {...inv("data")} />
          {erro("data")}
        </label>
      </div>
      <label>
        Descrição
        <input name="descricao" required maxLength={300} placeholder="ex.: Conserto do ar-condicionado da sala" {...inv("descricao")} />
        {erro("descricao")}
      </label>
      <div className={styles.linha}>
        <label>
          Imóvel {doProprietario ? "" : "(opcional)"}
          <select name="imovelId" defaultValue="" {...inv("imovelId")}>
            <option value="">{doProprietario ? "Escolha…" : "Geral da empresa"}</option>
            {imoveis.map((i) => (
              <option key={i.id} value={i.id}>
                {i.codigo} · {i.nome}
              </option>
            ))}
          </select>
          {erro("imovelId")}
        </label>
        {doProprietario && (
          <>
            <label>
              Proprietário
              <select name="proprietarioId" defaultValue="" {...inv("proprietarioId")}>
                <option value="">O do imóvel (se for só um)</option>
                {proprietarios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
              {erro("proprietarioId")}
            </label>
            <label>
              Quem pagou?
              <select name="pagoPor" defaultValue="empresa">
                <option value="empresa">A empresa (proprietário fica devendo)</option>
                <option value="proprietario">O próprio proprietário (só registro)</option>
              </select>
            </label>
          </>
        )}
      </div>
      <div className={styles.linha}>
        <label>
          Fornecedor / recebedor
          <input name="fornecedor" maxLength={200} {...inv("fornecedor")} />
          {erro("fornecedor")}
        </label>
        <label>
          Comprovante (link ou referência, opcional)
          <input name="comprovante" maxLength={500} placeholder="ex.: link do recibo no Drive, nº da nota" {...inv("comprovante")} />
          {erro("comprovante")}
        </label>
      </div>
      <div className={styles.linha}>
        <label className={styles.check}>
          <input type="checkbox" name="paga" value="1" checked={paga} onChange={(ev) => setPaga(ev.target.checked)} />
          Já foi paga
        </label>
        {paga && (
          <label>
            Data do pagamento
            <input type="date" name="dataPagamento" defaultValue={hoje} {...inv("dataPagamento")} />
            {erro("dataPagamento")}
          </label>
        )}
      </div>
      <div className={styles.acoes}>
        <button type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar despesa"}
        </button>
        <Link href="/painel/despesas">Cancelar</Link>
      </div>
    </form>
  );
}
