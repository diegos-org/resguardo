import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { type ConteudoSite, contatoDoSite } from "@/site/site";
import styles from "./site.module.css";

/**
 * Site sem nenhuma casa publicada (M7.8 — hoje, o caso da produção): diz isso com clareza e oferece o contato da
 * empresa, no lugar de uma lista vazia ("Em breve.") ou de um formulário de consulta que não dá para enviar. O texto é
 * editável em Configurações → Site (`semCasasTexto`, obrigatório); sem WhatsApp nem e-mail no cadastro, só o texto.
 */
export function SemCasas({ conteudo }: { conteudo: Pick<ConteudoSite, "textos" | "whatsapp" | "email"> }) {
  const contato = contatoDoSite(conteudo);
  return (
    <div className={styles.semCasas} role="note">
      <p>{conteudo.textos.semCasasTexto || TEXTOS_SITE_INICIAIS.semCasasTexto}</p>
      {contato && (
        <a href={contato.href} className={styles.botao} {...(contato.externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {contato.rotulo}
          <span aria-hidden="true">↗</span>
        </a>
      )}
    </div>
  );
}
