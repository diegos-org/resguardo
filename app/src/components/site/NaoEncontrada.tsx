import Link from "next/link";
import { TEXTOS_SITE_INICIAIS, type TextosSite } from "@/configuracoes/textos-site";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { type ConteudoSite, temCasaNoSite } from "@/site/site";
import { Moldura } from "./Moldura";
import { SemCasas, textoSemCasas } from "./SemCasas";
import styles from "./site.module.css";

/** "pagina": endereço que não existe no site; "casa": link de uma casa que não existe ou saiu do site. */
export type TipoNaoEncontrada = "pagina" | "casa";

const CHAVES = {
  pagina: { titulo: "naoEncontradoTitulo", texto: "naoEncontradoTexto" },
  casa: { titulo: "casaNaoEncontradaTitulo", texto: "casaNaoEncontradaTexto" },
} as const;

/**
 * Título e frase da página não encontrada (M7.8), de Configurações → Site. O título nunca sai vazio (é obrigatório; se
 * mesmo assim vier vazio, vale o texto-base); a frase salva vazia some. Sem o conteúdo do site, os textos-base.
 */
export function textosDaNaoEncontrada(textos: TextosSite | null, tipo: TipoNaoEncontrada): { titulo: string; texto: string } {
  const k = CHAVES[tipo];
  return { titulo: textos?.[k.titulo].trim() || TEXTOS_SITE_INICIAIS[k.titulo], texto: textos ? textos[k.texto].trim() : TEXTOS_SITE_INICIAIS[k.texto] };
}

/**
 * Página não encontrada no visual do site, como a do estudo aprovado (prototipos/scl-publico, `errorPage`): olho com o
 * nome da empresa, título, frase e "Conhecer as casas". Sem nenhuma casa publicada, o botão levaria a um catálogo
 * vazio: no lugar dele, o aviso do site sem casas com o contato e a volta ao início.
 */
export function NaoEncontrada({ conteudo, tipo, temCasas }: { conteudo: ConteudoSite | null; tipo: TipoNaoEncontrada; temCasas: boolean }) {
  const { titulo, texto } = textosDaNaoEncontrada(conteudo?.textos ?? null, tipo);
  const empresa = conteudo?.nomeEmpresa.trim();
  return (
    <Moldura conteudo={conteudo}>
      <section className={styles.paginaAviso} aria-labelledby="titulo-nao-encontrada">
        {empresa && <p className={styles.olho}>{empresa}</p>}
        <h1 id="titulo-nao-encontrada">{titulo}</h1>
        {temCasas ? (
          <>
            {texto && <p>{texto}</p>}
            <Link href="/imoveis" className={styles.botao}>
              Conhecer as casas
              <span aria-hidden="true">↗</span>
            </Link>
          </>
        ) : (
          <>
            {conteudo && <SemCasas conteudo={conteudo} />}
            <Link href="/" className={styles.linkTexto}>
              Voltar ao início
            </Link>
          </>
        )}
      </section>
    </Moldura>
  );
}

/**
 * A página não encontrada com o conteúdo do site lido nesta requisição (o mesmo da página que chamou `notFound()`). Para
 * o botão, só a conferência curta de que há alguma casa no site, sem a lista nem as fotos.
 */
export async function PaginaNaoEncontrada({ tipo }: { tipo: TipoNaoEncontrada }) {
  const { db, conteudo } = await carregarSite();
  const temCasas = conteudo ? await temCasaNoSite(db, conteudo.organizacaoId) : false;
  return <NaoEncontrada conteudo={conteudo} tipo={tipo} temCasas={temCasas} />;
}

/**
 * Título da aba da página não encontrada: "Página não encontrada — Nome da empresa"; a descrição (M7.13) é o que a
 * página mostra: a frase dela (vazia = a do site) ou, sem nenhuma casa no site, o aviso do site sem casas, pela mesma
 * conferência curta da página (`temCasaNoSite`, com `cache`: uma leitura só por requisição).
 */
export async function metadadosDaNaoEncontrada(tipo: TipoNaoEncontrada) {
  const { db, conteudo } = await carregarSite();
  const { titulo, texto } = textosDaNaoEncontrada(conteudo?.textos ?? null, tipo);
  const temCasas = conteudo ? await temCasaNoSite(db, conteudo.organizacaoId) : false;
  return metadadosDoSite(titulo, { descricao: conteudo && !temCasas ? textoSemCasas(conteudo.textos) : texto });
}
