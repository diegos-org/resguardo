import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { AVISO_SEM_CONTATO, type ConteudoSite, contatoDoSite, type OpcoesDoContato } from "@/site/site";
import { LinkNovaJanela } from "./Acessibilidade";
import styles from "./site.module.css";

/** O aviso do site sem casas, de Configurações → Site; salvo vazio ou só com espaços, o texto-base (nunca um aviso em branco). */
export const textoSemCasas = (textos: Pick<ConteudoSite["textos"], "semCasasTexto">) => textos.semCasasTexto.trim() || TEXTOS_SITE_INICIAIS.semCasasTexto;

/**
 * Site sem nenhuma casa publicada (M7.8 — hoje, o caso da produção): diz isso com clareza e oferece o contato da
 * empresa, no lugar de uma lista vazia ("Em breve.") ou de um formulário de consulta que não dá para enviar. O texto é
 * editável em Configurações → Site (`semCasasTexto`, obrigatório). Sem WhatsApp nem e-mail no cadastro, no lugar do
 * botão, o mesmo aviso da consulta ("O contato ainda não foi configurado."): a página não convida sem dizer por onde.
 * É o aviso único do site sem casas, também na busca em todas as casas (M7.9), que passa em `contato` o assunto da
 * busca e, com datas e pessoas válidas, a mensagem com elas (sem nada, a mensagem e o assunto padrão do site).
 */
export function SemCasas({ conteudo, contato: opcoes }: { conteudo: Pick<ConteudoSite, "textos" | "whatsapp" | "email">; contato?: OpcoesDoContato }) {
  const contato = contatoDoSite(conteudo, opcoes);
  return (
    <div className={styles.semCasas} role="note">
      <p>{textoSemCasas(conteudo.textos)}</p>
      {contato ? (
        <BotaoContato contato={contato} />
      ) : (
        // O cartão já tem o visual de aviso: aqui, só a frase em destaque.
        <p>
          <strong>{AVISO_SEM_CONTATO}</strong>
        </p>
      )}
    </div>
  );
}

/**
 * O botão do link de `contatoDoSite` (o mesmo no aviso do site sem casas, na busca em todas as casas e no envio da
 * mensagem da consulta). O WhatsApp abre outra janela pelo `LinkNovaJanela` (M7.11, com o aviso para o leitor de tela);
 * o e-mail abre o programa de e-mail. `rotulo` troca o texto padrão do contato (o envio da consulta diz "Enviar…").
 */
export function BotaoContato({ contato, rotulo = contato.rotulo }: { contato: NonNullable<ReturnType<typeof contatoDoSite>>; rotulo?: string }) {
  const texto = (
    <>
      {rotulo}
      <span aria-hidden="true">↗</span>
    </>
  );
  return contato.externo ? (
    <LinkNovaJanela href={contato.href} className={styles.botao}>
      {texto}
    </LinkNovaJanela>
  ) : (
    <a href={contato.href} className={styles.botao}>
      {texto}
    </a>
  );
}
