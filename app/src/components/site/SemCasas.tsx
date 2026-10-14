import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { AVISO_SEM_CONTATO, type ConteudoSite, contatoDoSite } from "@/site/site";
import { LinkNovaJanela } from "./Acessibilidade";
import styles from "./site.module.css";

/** O aviso do site sem casas, de Configurações → Site; salvo vazio ou só com espaços, o texto-base (nunca um aviso em branco). */
export const textoSemCasas = (textos: Pick<ConteudoSite["textos"], "semCasasTexto">) => textos.semCasasTexto.trim() || TEXTOS_SITE_INICIAIS.semCasasTexto;

/**
 * Site sem nenhuma casa publicada (M7.8 — hoje, o caso da produção): diz isso com clareza e oferece o contato da
 * empresa, no lugar de uma lista vazia ("Em breve.") ou de um formulário de consulta que não dá para enviar. O texto é
 * editável em Configurações → Site (`semCasasTexto`, obrigatório). Sem WhatsApp nem e-mail no cadastro, no lugar do
 * botão, o mesmo aviso da consulta ("O contato ainda não foi configurado."): a página não convida sem dizer por onde.
 */
export function SemCasas({ conteudo }: { conteudo: Pick<ConteudoSite, "textos" | "whatsapp" | "email"> }) {
  const contato = contatoDoSite(conteudo);
  const rotulo = contato && (
    <>
      {contato.rotulo}
      <span aria-hidden="true">↗</span>
    </>
  );
  return (
    <div className={styles.semCasas} role="note">
      <p>{textoSemCasas(conteudo.textos)}</p>
      {contato?.externo ? (
        // O WhatsApp abre outra janela (com o aviso para o leitor de tela); o e-mail abre o programa de e-mail.
        <LinkNovaJanela href={contato.href} className={styles.botao}>
          {rotulo}
        </LinkNovaJanela>
      ) : contato ? (
        <a href={contato.href} className={styles.botao}>
          {rotulo}
        </a>
      ) : (
        // O cartão já tem o visual de aviso: aqui, só a frase em destaque.
        <p>
          <strong>{AVISO_SEM_CONTATO}</strong>
        </p>
      )}
    </div>
  );
}
