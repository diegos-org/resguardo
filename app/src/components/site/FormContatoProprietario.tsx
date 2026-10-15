"use client";

import { type CSSProperties, useActionState, useState } from "react";
import { CAMPO_AUTORIZACAO, type TextoAutorizacao } from "@/proprietarios/autorizacao";
import type { CampoPedidoContato } from "@/proprietarios/pedidos-contato";
import { pedirContatoProprietarioAcao } from "@/site/acoes-contato";
import styles from "./site.module.css";

/** Campo-isca: fora da tela, fora do Tab e escondido de leitores de tela; só robô preenche. */
const ISCA: CSSProperties = { position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" };

/**
 * "Pedir contato para a gestão completa" (página Anuncie seu imóvel, M7.7). Vai para a equipe no painel; não cria
 * conta nem publica nada. Depois de um erro, volta com o que foi digitado. `acao` só é trocada nos testes.
 * O texto da caixa de autorização (`autorizacao`) é a versão em vigor, lida pela página no servidor (M7.15), a mesma que o
 * servidor confere e grava no envio (M7.14); o campo escondido leva só a marca desse texto. Se ele mudou depois que a
 * página abriu, o servidor devolve o texto novo, que continua na tela nos erros seguintes (eles não trazem o texto de novo).
 */
export function FormContatoProprietario({
  empresa,
  autorizacao: daPagina,
  acao = pedirContatoProprietarioAcao,
}: {
  empresa: string;
  autorizacao: TextoAutorizacao;
  acao?: typeof pedirContatoProprietarioAcao;
}) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  const [doServidor, setDoServidor] = useState<TextoAutorizacao | undefined>(estado.autorizacao);
  if (estado.autorizacao && estado.autorizacao.marca !== doServidor?.marca) setDoServidor(estado.autorizacao);
  if (estado.ok)
    return (
      <p role="status" className={styles.aviso}>
        Recebemos seu pedido. A equipe da {empresa} vai responder pelo e-mail ou WhatsApp que você informou.
      </p>
    );
  const v = (k: CampoPedidoContato, padrao = "") => estado.valores?.[k] ?? padrao;
  const autorizacao = estado.autorizacao ?? doServidor ?? daPagina;
  const id = (k: CampoPedidoContato) => `contato-proprietario-erro-${k}`;
  // Campo com erro: marcado como inválido e ligado à mensagem (leitor de tela lê os dois juntos).
  const marca = (k: CampoPedidoContato) => (estado.erros?.[k] ? { "aria-invalid": true as const, "aria-describedby": id(k) } : {});
  const erro = (k: CampoPedidoContato) =>
    estado.erros?.[k] ? (
      <span className={styles.erro} id={id(k)}>
        {estado.erros[k]}
      </span>
    ) : null;
  return (
    <form action={enviar} className={styles.formulario} aria-label="Pedir contato para a gestão completa" key={JSON.stringify(estado.valores ?? {})}>
      <label>
        Seu nome
        <input name="nome" required maxLength={150} autoComplete="name" defaultValue={v("nome")} {...marca("nome")} />
        {erro("nome")}
      </label>
      <div className={styles.linha}>
        <label>
          E-mail
          <input name="email" type="email" required maxLength={200} autoComplete="email" defaultValue={v("email")} {...marca("email")} />
          {erro("email")}
        </label>
        <label>
          Telefone (WhatsApp)
          <input name="telefone" type="tel" required inputMode="tel" autoComplete="tel" maxLength={20} placeholder="(21) 90000-0000" defaultValue={v("telefone")} {...marca("telefone")} />
          {erro("telefone")}
        </label>
      </div>
      <div className={styles.linha}>
        <label>
          Bairro do imóvel
          <input name="bairro" required maxLength={80} defaultValue={v("bairro")} {...marca("bairro")} />
          {erro("bairro")}
        </label>
        <label>
          Cidade
          <input name="cidade" required maxLength={80} defaultValue={v("cidade", "Rio de Janeiro")} {...marca("cidade")} />
          {erro("cidade")}
        </label>
      </div>
      <div className={styles.linha}>
        <label>
          Quartos
          <select name="quartos" defaultValue={v("quartos")} {...marca("quartos")}>
            <option value="">Não sei agora</option>
            <option value="0">Studio</option>
            <option value="1">1 quarto</option>
            <option value="2">2 quartos</option>
            <option value="3">3 quartos</option>
            <option value="4">4 ou mais</option>
          </select>
          {erro("quartos")}
        </label>
        <label>
          Já anuncia em alguma plataforma?
          <select name="anunciaHoje" defaultValue={v("anunciaHoje")} {...marca("anunciaHoje")}>
            <option value="">Prefiro não dizer</option>
            <option value="sim">Sim</option>
            <option value="nao">Não</option>
          </select>
          {erro("anunciaHoje")}
        </label>
      </div>
      <label>
        Mensagem (opcional)
        <textarea name="mensagem" rows={4} maxLength={2000} defaultValue={v("mensagem")} {...marca("mensagem")} />
        {erro("mensagem")}
      </label>
      <div aria-hidden="true" style={ISCA}>
        <label>
          Deixe este campo em branco
          <input name="site" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <input type="hidden" name={CAMPO_AUTORIZACAO} value={autorizacao.marca} />
      <label className={styles.opcao}>
        {/* A caixa é do texto ao lado: se o texto muda, ela volta desmarcada (a chave é a marca do texto). */}
        <input key={autorizacao.marca} type="checkbox" name="consentimento" required defaultChecked={v("consentimento") === "on"} {...marca("consentimento")} /> {autorizacao.texto}
      </label>
      {erro("consentimento")}
      {estado.mensagem && (
        <p role="alert" className={styles.erro}>
          {estado.mensagem}
        </p>
      )}
      <button type="submit" className={styles.botao} disabled={enviando}>
        Pedir contato
      </button>
    </form>
  );
}
