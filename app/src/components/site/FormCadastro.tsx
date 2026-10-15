"use client";

import { useActionState, useState } from "react";
import type { EstadoCadastro } from "@/marketplace/acoes";
import { CAMPO_AUTORIZACAO, type TextoAutorizacao, textoDaAutorizacao } from "@/proprietarios/autorizacao";
import styles from "./site.module.css";

type Acao = (a: EstadoCadastro, f: FormData) => Promise<EstadoCadastro>;

/**
 * Formulário público do cadastro marketplace (M12.3). Depois de um erro, volta com o que foi digitado. O texto da caixa
 * de autorização vem de `proprietarios/autorizacao` (M7.14), o mesmo que o servidor grava; o campo escondido leva só a
 * marca desse texto. Se ele mudou depois que a página abriu, o servidor devolve o texto novo, que continua na tela nos
 * erros seguintes (eles não trazem o texto de novo).
 */
export function FormCadastro({ enviar, empresa }: { enviar: Acao; empresa: string }) {
  const [estado, acao, enviando] = useActionState(enviar, {});
  const v = (k: string, padrao = "") => estado.valores?.[k] ?? padrao;
  const [doServidor, setDoServidor] = useState<TextoAutorizacao | undefined>(estado.autorizacao);
  if (estado.autorizacao && estado.autorizacao.marca !== doServidor?.marca) setDoServidor(estado.autorizacao);
  const autorizacao = estado.autorizacao ?? doServidor ?? textoDaAutorizacao("cadastro", empresa);
  const [anuncio, setAnuncio] = useState(v("anuncio"));
  const erro = (k: keyof NonNullable<EstadoCadastro["erros"]>) =>
    estado.erros?.[k] ? (
      <span className={styles.erro} id={`erro-${k}`}>
        {estado.erros[k]}
      </span>
    ) : null;
  return (
    <form action={acao} className={styles.formulario} aria-label="Cadastro do imóvel" key={JSON.stringify(estado.valores ?? {})}>
      <strong>Você</strong>
      <label>
        Nome completo ou razão social
        <input name="nome" required maxLength={150} defaultValue={v("nome")} autoComplete="name" />
        {erro("nome")}
      </label>
      <div className={styles.linha}>
        <label>
          Pessoa
          <select name="tipo" defaultValue={v("tipo", "fisica")}>
            <option value="fisica">Física</option>
            <option value="juridica">Empresa</option>
          </select>
        </label>
        <label>
          Telefone (com DDD)
          <input name="telefone" required inputMode="tel" autoComplete="tel" maxLength={20} defaultValue={v("telefone")} />
          {erro("telefone")}
        </label>
      </div>

      <strong>O imóvel</strong>
      <label>
        Nome do imóvel
        <input name="imovel_nome" required maxLength={100} placeholder="ex.: Apartamento em Ipanema" defaultValue={v("imovel_nome")} />
        {erro("imovel_nome")}
      </label>
      <div className={styles.linha}>
        <label>
          Bairro
          <input name="imovel_bairro" required maxLength={80} defaultValue={v("imovel_bairro")} />
          {erro("imovel_bairro")}
        </label>
        <label>
          Cidade
          <input name="imovel_cidade" required maxLength={80} defaultValue={v("imovel_cidade", "Rio de Janeiro")} />
          {erro("imovel_cidade")}
        </label>
      </div>
      <label>
        Endereço (fica só com a nossa equipe)
        <input name="imovel_endereco" required maxLength={200} defaultValue={v("imovel_endereco")} autoComplete="street-address" />
        {erro("imovel_endereco")}
      </label>
      <div className={styles.linha}>
        <label>
          Pessoas
          <input name="imovel_capacidade" type="number" min={1} max={50} required defaultValue={v("imovel_capacidade")} />
          {erro("imovel_capacidade")}
        </label>
        <label>
          Quartos
          <input name="imovel_quartos" type="number" min={0} max={20} defaultValue={v("imovel_quartos")} />
          {erro("imovel_quartos")}
        </label>
        <label>
          Banheiros
          <input name="imovel_banheiros" type="number" min={0} max={20} defaultValue={v("imovel_banheiros")} />
          {erro("imovel_banheiros")}
        </label>
      </div>
      <label>
        Conte um pouco sobre o imóvel (opcional)
        <textarea name="imovel_descricao" rows={4} maxLength={2000} defaultValue={v("imovel_descricao")} />
        {erro("imovel_descricao")}
      </label>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 10 }}>
        <legend>
          <strong>Anúncio</strong>
        </legend>
        <label className={styles.opcao}>
          <input type="radio" name="anuncio" value="ja_anuncio" defaultChecked={anuncio === "ja_anuncio"} onChange={() => setAnuncio("ja_anuncio")} /> Já
          anuncio em outra plataforma (Airbnb, Booking…)
        </label>
        <label className={styles.opcao}>
          <input type="radio" name="anuncio" value="novo" defaultChecked={anuncio === "novo"} onChange={() => setAnuncio("novo")} /> Quero um anúncio novo
        </label>
        {erro("anuncio")}
      </fieldset>
      {anuncio === "ja_anuncio" && (
        <label>
          Link(s) do anúncio (até 3, um por linha)
          <textarea name="links" rows={3} maxLength={1000} placeholder="https://www.airbnb.com.br/rooms/…" defaultValue={v("links")} />
          {erro("links")}
        </label>
      )}

      <input type="hidden" name={CAMPO_AUTORIZACAO} value={autorizacao.marca} />
      <label className={styles.opcao}>
        <input type="checkbox" name="consentimento" defaultChecked={v("consentimento") === "on"} /> {autorizacao.texto}
        {erro("consentimento")}
      </label>
      {estado.mensagem && (
        <p role="alert" className={styles.erro}>
          {estado.mensagem}
        </p>
      )}
      <button type="submit" className={styles.botao} disabled={enviando}>
        Enviar para análise
      </button>
    </form>
  );
}
