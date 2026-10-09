"use client";

import { useActionState } from "react";
import type { EstadoSegurar } from "@/site/acoes";
import styles from "./site.module.css";

type Acao = (a: EstadoSegurar, f: FormData) => Promise<EstadoSegurar>;
type Valores = { nome: string; email: string; telefone: string };
type Estado = EstadoSegurar & { valores?: Valores };
const VAZIO: Valores = { nome: "", email: "", telefone: "" };

/**
 * Contato do visitante para segurar as datas da cotação (M8.1). O servidor decide; aqui só o formulário. O que foi
 * digitado fica no navegador (o estado da ação nunca traz dado pessoal de volta) e volta aos campos depois de um erro.
 * `comPagamento` (M8.2a): o site oferece o Pix nesta cotação (muda o texto "nenhum pagamento é feito aqui");
 * `comCartao` (M8.2b): o cartão de crédito também está ligado.
 * `privacidade` (M7.4): versão em vigor da Política de privacidade, para o aviso de como os dados são usados (onde
 * eles são pedidos) apontar para ela; sem versão publicada, o aviso fica sem o link.
 */
export function FormSegurar({
  codigo,
  minutos,
  acao,
  comPagamento = false,
  comCartao = false,
  privacidade = null,
}: {
  codigo: string;
  minutos: number;
  acao: Acao;
  comPagamento?: boolean;
  comCartao?: boolean;
  privacidade?: number | null;
}) {
  const [estado, enviar, enviando] = useActionState(async (_a: Estado, f: FormData): Promise<Estado> => {
    // O estado anterior não volta ao servidor (ele só traria de volta o que já foi digitado).
    const r = await acao({}, f);
    const ok = !r.erro && !r.erros;
    return { ...r, valores: ok ? VAZIO : { nome: String(f.get("nome") ?? ""), email: String(f.get("email") ?? ""), telefone: String(f.get("telefone") ?? "") } };
  }, {} as Estado);
  const v = estado.valores ?? VAZIO;
  const e = estado.erros ?? {};
  const erro = (k: string) => (e[k] ? <span className={styles.erro}>{e[k]}</span> : null);
  // Aviso de transparência da LGPD onde os dados são pedidos (não é consentimento: a base é a própria reserva).
  const comoExplica = privacidade ? (
    <>
      , como explica a{" "}
      <a href={`/privacidade?versao=${privacidade}`} target="_blank" rel="noopener noreferrer">
        Política de privacidade
      </a>
    </>
  ) : null;
  return (
    <form action={enviar} className={styles.formulario} aria-label="Segurar as datas">
      <strong>Segurar as datas por {minutos} minutos</strong>
      <p className={styles.miudo} style={{ margin: 0 }}>
        {comPagamento ? (
          <>
            Usamos seus dados só para a sua reserva{comoExplica}. Nada é cobrado ao segurar: {comCartao ? "o pagamento por Pix ou cartão" : "o Pix"} aparece logo depois, nesta página.
          </>
        ) : (
          <>Usamos seus dados só para confirmar a reserva com você{comoExplica}. Nenhum pagamento é feito aqui.</>
        )}
      </p>
      <input type="hidden" name="codigo" value={codigo} />
      <label>
        Nome
        <input name="nome" required maxLength={120} autoComplete="name" defaultValue={v.nome} aria-invalid={e.nome ? true : undefined} />
        {erro("nome")}
      </label>
      <label>
        E-mail
        <input name="email" type="email" required maxLength={120} autoComplete="email" defaultValue={v.email} aria-invalid={e.email ? true : undefined} />
        {erro("email")}
      </label>
      <label>
        WhatsApp (com DDD)
        <input name="telefone" type="tel" required maxLength={40} autoComplete="tel" defaultValue={v.telefone} aria-invalid={e.telefone ? true : undefined} />
        {erro("telefone")}
      </label>
      {estado.erro && (
        <p role="alert" className={styles.aviso}>
          {estado.erro}
          {estado.motivos?.length ? ` ${estado.motivos.join(" ")}` : ""}
        </p>
      )}
      <button type="submit" className={styles.botao} disabled={enviando}>
        {enviando ? "Segurando…" : "Segurar as datas"}
      </button>
    </form>
  );
}
