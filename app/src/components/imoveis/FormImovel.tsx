"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { EstadoFormImovel } from "@/imoveis/acoes";
import { type DadosImovel, LIMITE_FRASE } from "@/imoveis/validacao";
import styles from "../formularios.module.css";

type Props = {
  acao: (anterior: EstadoFormImovel, form: FormData) => Promise<EstadoFormImovel>;
  id?: string;
  inicial?: Partial<DadosImovel>;
};

export function FormImovel({ acao, id, inicial = {} }: Props) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  const erro = (campo: keyof DadosImovel) =>
    estado.erros?.[campo] ? (
      <span className={styles.erro} id={`erro-${campo}`}>
        {estado.erros[campo]}
      </span>
    ) : null;
  const invalido = (campo: keyof DadosImovel) =>
    estado.erros?.[campo] ? { "aria-invalid": true, "aria-describedby": `erro-${campo}` } : {};

  return (
    <form action={enviar} className={styles.form} aria-label="Dados do imóvel">
      {id && <input type="hidden" name="id" value={id} />}
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      <div className={styles.linha}>
        <label>
          Código
          <input name="codigo" defaultValue={inicial.codigo} required maxLength={20} placeholder="ex.: 403" {...invalido("codigo")} />
          {erro("codigo")}
        </label>
        <label className={styles.largo}>
          Nome comercial
          <input name="nome" defaultValue={inicial.nome} required maxLength={100} placeholder="ex.: Studio Leblon" {...invalido("nome")} />
          {erro("nome")}
        </label>
      </div>
      <div className={styles.linha}>
        <label>
          Bairro
          <input name="bairro" defaultValue={inicial.bairro} />
        </label>
        <label>
          Cidade
          <input name="cidade" defaultValue={inicial.cidade ?? "Rio de Janeiro"} />
        </label>
        <label>
          Fuso horário
          <input name="fuso" defaultValue={inicial.fuso ?? "America/Sao_Paulo"} {...invalido("fuso")} />
          {erro("fuso")}
        </label>
      </div>
      <label>
        Endereço
        <input name="endereco" defaultValue={inicial.endereco} />
      </label>
      <div className={styles.linha}>
        {(["capacidade", "quartos", "banheiros"] as const).map((campo) => (
          <label key={campo}>
            {campo === "capacidade" ? "Capacidade (hóspedes)" : campo === "quartos" ? "Quartos" : "Banheiros"}
            <input name={campo} type="number" min={0} max={50} inputMode="numeric" defaultValue={inicial[campo] ?? ""} {...invalido(campo)} />
            {erro(campo)}
          </label>
        ))}
      </div>
      <label>
        Frase de abertura (site)
        <input name="frase" defaultValue={inicial.frase} maxLength={LIMITE_FRASE} {...invalido("frase")} />
        {/* Dentro do rótulo, como a dica dos campos de Configurações (FormCampos). */}
        <span style={{ fontSize: "0.8125rem" }}>
          Abre a página da casa no site, em letra grande, acima da descrição; vai também para o cartão da vitrine e para a
          prévia do link. Até {LIMITE_FRASE} caracteres, numa linha só. Em branco, nada aparece e o cartão usa a primeira frase
          da descrição.
        </span>
        {erro("frase")}
      </label>
      <label>
        Descrição
        <textarea name="descricao" rows={4} defaultValue={inicial.descricao} {...invalido("descricao")} />
        {erro("descricao")}
      </label>
      <div className={styles.linha}>
        <label className={styles.check}>
          <input type="checkbox" name="publico" defaultChecked={inicial.publico ?? false} />
          Aparece no site público
        </label>
        <label className={styles.check}>
          <input type="checkbox" name="ativo" defaultChecked={inicial.ativo ?? true} />
          Em operação
        </label>
      </div>
      <div className={styles.acoes}>
        <button type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar"}
        </button>
        <Link href="/painel/imoveis">Cancelar</Link>
      </div>
    </form>
  );
}
