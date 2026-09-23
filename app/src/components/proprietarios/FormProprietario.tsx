"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { EstadoForm } from "@/proprietarios/acoes";
import type { DadosProprietario } from "@/proprietarios/validacao";
import styles from "../formularios.module.css";

type Props = {
  acao: (a: EstadoForm<DadosProprietario>, f: FormData) => Promise<EstadoForm<DadosProprietario>>;
  imoveis: { id: string; codigo: string; nome: string }[];
  id?: string;
  inicial?: Partial<DadosProprietario> & { imovelIds?: string[] };
};

export function FormProprietario({ acao, imoveis, id, inicial = {} }: Props) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  const e = estado.erros ?? {};
  const campo = (nome: keyof DadosProprietario, rotulo: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>
      {rotulo}
      <input
        name={nome}
        defaultValue={(inicial[nome] as string | undefined) ?? ""}
        aria-invalid={e[nome] ? true : undefined}
        aria-describedby={e[nome] ? `erro-${nome}` : undefined}
        {...extra}
      />
      {e[nome] && (
        <span className={styles.erro} id={`erro-${nome}`}>
          {e[nome]}
        </span>
      )}
    </label>
  );

  return (
    <form action={enviar} className={styles.form} aria-label="Dados do proprietário">
      {id && <input type="hidden" name="id" value={id} />}
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      <div className={styles.linha}>
        <label>
          Tipo
          <select name="tipo" defaultValue={inicial.tipo ?? "fisica"}>
            <option value="fisica">Pessoa física</option>
            <option value="juridica">Pessoa jurídica</option>
          </select>
        </label>
        <span className={styles.largo} style={{ display: "flex" }}>
          {campo("nome", "Nome completo / razão social", { required: true, maxLength: 150 })}
        </span>
      </div>
      <div className={styles.linha}>
        {campo("documento", "CPF / CNPJ", { inputMode: "numeric" })}
        {campo("email", "E-mail", { type: "email" })}
        {campo("telefone", "Telefone", { type: "tel" })}
      </div>
      {campo("endereco", "Endereço")}
      {campo("chavePix", "Chave Pix (para repasses)", { maxLength: 140 })}
      <label>
        Observações
        <textarea name="observacoes" rows={3} defaultValue={inicial.observacoes} />
      </label>
      <fieldset style={{ border: 0 }}>
        <legend style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", marginBottom: 6 }}>Imóveis deste proprietário</legend>
        {imoveis.length === 0 && <span style={{ fontSize: "0.875rem" }}>Cadastre os imóveis primeiro.</span>}
        <div className={styles.linha}>
          {imoveis.map((i) => (
            <label key={i.id} className={styles.check}>
              <input type="checkbox" name="imovel" value={i.id} defaultChecked={inicial.imovelIds?.includes(i.id)} />
              {i.codigo} · {i.nome}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={styles.check}>
        <input type="checkbox" name="ativo" defaultChecked={inicial.ativo ?? true} />
        Cliente ativo
      </label>
      <div className={styles.acoes}>
        <button type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar"}
        </button>
        <Link href="/painel/proprietarios">Voltar</Link>
      </div>
    </form>
  );
}
