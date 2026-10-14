import { Fragment, type ReactNode } from "react";
import { partesDoTitulo } from "@/configuracoes/textos-site";
import { type ConteudoSite, linkWhatsapp, MARCA_PADRAO, MENSAGEM_CONTATO_SITE } from "@/site/site";
import { MolduraBase } from "./MolduraBase";
import styles from "./site.module.css";

// A marca com destaque mora na moldura sem banco (M7.8); continua saindo daqui para quem já a lia deste arquivo.
export { marcaComDestaque } from "./MolduraBase";

/** Texto editável com a palavra entre *asteriscos* em itálico (título da capa, chamada final). */
export function TextoComDestaque({ texto }: { texto: string }) {
  return (
    <>
      {partesDoTitulo(texto).map((p, i) =>
        p.destaque ? <em key={i}>{p.texto}</em> : <Fragment key={i}>{p.texto}</Fragment>,
      )}
    </>
  );
}

/**
 * Cabeçalho (floresta) e rodapé (profundo) do site público, com o botão do WhatsApp quando a empresa
 * tem telefone. `largura="cheia"` é para a página inicial, que tem faixas de cor de ponta a ponta;
 * as outras páginas ficam no miolo centralizado. O desenho é o da `MolduraBase`; aqui só se lê o conteúdo do site.
 */
export function Moldura({ conteudo, children, largura = "miolo" }: { conteudo: ConteudoSite | null; children: ReactNode; largura?: "miolo" | "cheia" }) {
  const nome = conteudo?.nomeEmpresa.trim() || "Início";
  // Quem vende (Decreto 7.962, art. 2º): razão social, CNPJ e endereço da empresa, quando preenchidos em Configurações → Empresa.
  const id = conteudo?.identidade;
  const identidade = id && (id.razaoSocial || id.cnpj) ? [id.razaoSocial, id.cnpj && `CNPJ ${id.cnpj}`, id.endereco].filter(Boolean).join(" · ") : null;
  return (
    <MolduraBase
      nome={nome}
      marca={conteudo?.imagens.marca ?? MARCA_PADRAO}
      rodape={conteudo?.textos.rodape || conteudo?.textos.subtitulo || nome}
      identidade={identidade}
      whatsapp={conteudo?.whatsapp ? linkWhatsapp(conteudo.whatsapp, MENSAGEM_CONTATO_SITE) : null}
      largura={largura}
    >
      {children}
    </MolduraBase>
  );
}

/** Sem organização definida para o site: avisa em vez de escolher uma. */
export function SiteEmConfiguracao() {
  return (
    <Moldura conteudo={null}>
      <p className={styles.aviso} role="note">
        Site em configuração. Volte em breve.
      </p>
    </Moldura>
  );
}

/** Imóvel ainda sem foto real (M7.3): um quadro com o nome do apartamento — nunca uma imagem genérica. */
export function FotoProvisoria({ titulo }: { titulo: string }) {
  return (
    <div className={styles.foto} role="img" aria-label={titulo ? `Foto de ${titulo} (em breve)` : "Foto (em breve)"}>
      {titulo}
      <small>Foto em breve</small>
    </div>
  );
}
