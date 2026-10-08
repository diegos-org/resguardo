import Link from "next/link";
import { CartaoImovel } from "@/components/site/CartaoImovel";
import { FormContatoProprietario } from "@/components/site/FormContatoProprietario";
import { Moldura, SiteEmConfiguracao, TextoComDestaque } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { VitrineCasas } from "@/components/site/VitrineCasas";
import { lerComoFunciona, secoesParaMostrar, versaoAtual } from "@/configuracoes/como-funciona";
import { lerMercado, lerTextosProprietarios, mercadoParaMostrar, mesPorExtenso } from "@/configuracoes/pagina-proprietarios";
import { blocosDoTexto, tituloSimples } from "@/configuracoes/textos-site";
import { correioDoAmbiente } from "@/email/correio";
import { formatBRL } from "@/lib/money";
import { bpParaTexto } from "@/lib/percentual";
import { entrarCadastroAcao, pedirCodigoCadastroAcao } from "@/marketplace/acoes";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { imoveisDoSite } from "@/site/site";

export const generateMetadata = () => metadadosDoSite("Anuncie seu imóvel");

const MENSAGENS: Record<string, string> = {
  "email-vazio": "Informe seu e-mail.",
  codigo: "Código incorreto ou vencido. Confira o e-mail mais recente ou peça um novo código.",
};

const dataCurta = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Página para proprietários (M7.7): o que a empresa faz (gestão completa e marketplace), como gerimos, a faixa de
 * mercado (só com números reais do painel), a vitrine dos imóveis, o portfólio, o "Como funciona" publicado (M5.6), o
 * pedido de contato para a gestão completa e o cadastro do marketplace (M12.3, que continua igual: e-mail, código e
 * dados do imóvel). Textos editáveis em Configurações → Página para proprietários.
 *
 * No meio do cadastro (código enviado ou erro), a página mostra só o cadastro, como antes.
 */
export default async function Anunciar({ searchParams }: PageProps<"/anunciar">) {
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const { erro, etapa, email } = await searchParams;
  const configurado = Boolean(process.env.AUTH_SECRET && correioDoAmbiente());
  const mensagem = typeof erro === "string" ? (MENSAGENS[erro] ?? "Não foi possível continuar. Tente novamente.") : null;
  const emailInformado = typeof email === "string" ? email.slice(0, 200) : "";
  const digitarCodigo = configurado && etapa === "codigo" && emailInformado;
  const org = conteudo.organizacaoId;
  const [textos, mercadoGravado, versoes] = await Promise.all([lerTextosProprietarios(db, org), lerMercado(db, org), lerComoFunciona(db, org)]);

  const cadastro = (
    <section className={styles.secao} id="marketplace" aria-labelledby="titulo-cadastro">
      <div className={`${styles.dentro} ${styles.cadastroProprietario}`}>
        <div>
          {textos.cadastroOlho && <p className={styles.olho}>{textos.cadastroOlho}</p>}
          <h2 id="titulo-cadastro">
            <TextoComDestaque texto={textos.cadastroTitulo} />
          </h2>
          {textos.cadastroTexto && <p className={styles.texto}>{textos.cadastroTexto}</p>}
        </div>
        <div>
          {mensagem && (
            <p role="alert" className={styles.erro}>
              {mensagem}
            </p>
          )}
          {!configurado ? (
            <p className={styles.aviso} role="note">
              O cadastro pelo site ainda não está disponível. Fale com a gente pelo contato do site.
            </p>
          ) : digitarCodigo ? (
            <form action={entrarCadastroAcao} className={styles.formulario} aria-label="Digitar código">
              <p style={{ margin: 0 }}>
                Enviamos um código de 6 dígitos para <strong>{emailInformado}</strong>. Ele vale por 10 minutos. Não chegou? Confira o spam e peça outro.
              </p>
              <input type="hidden" name="email" value={emailInformado} />
              <label>
                Código
                <input name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
              </label>
              <button type="submit" className={styles.botao}>
                Continuar
              </button>
              <Link href="/anunciar#marketplace" className={styles.miudo}>
                Usar outro e-mail ou pedir novo código
              </Link>
            </form>
          ) : (
            <form action={pedirCodigoCadastroAcao} className={styles.formulario} aria-label="Confirmar e-mail">
              <p style={{ margin: 0 }}>Primeiro, confirme seu e-mail: enviamos um código para ele. É por esse e-mail que vamos responder.</p>
              <label>
                Seu e-mail
                <input type="email" name="email" autoComplete="email" required defaultValue={emailInformado} />
              </label>
              <button type="submit" className={styles.botao}>
                Receber código por e-mail
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );

  // No meio do cadastro: só ele, com o caminho de volta para a página inteira.
  if (digitarCodigo || mensagem) {
    return (
      <Moldura conteudo={conteudo}>
        <p className={styles.miudo} style={{ margin: 0 }}>
          <Link href="/anunciar">Página para proprietários</Link>
        </p>
        {cadastro}
      </Moldura>
    );
  }

  const lista = await imoveisDoSite(db, org);
  const passos = blocosDoTexto(textos.como);
  const mercado = mercadoParaMostrar(mercadoGravado);
  const versao = versaoAtual(versoes);
  const secoes = versao ? secoesParaMostrar(versao, conteudo.nomeEmpresa) : [];

  return (
    <Moldura conteudo={conteudo} largura="cheia">
      <section className={styles.capa} aria-label="Apresentação">
        <div className={styles.capaDentro}>
          <div className={styles.capaTextos}>
            {textos.olho && <p className={styles.olho}>{textos.olho}</p>}
            <h1>
              <TextoComDestaque texto={textos.titulo} />
            </h1>
            {textos.subtitulo && <p className={styles.capaTexto}>{textos.subtitulo}</p>}
          </div>
          <div className={styles.capaAcoes}>
            <a href="#contato" className={`${styles.botao} ${styles.botaoClaro}`}>
              Pedir uma análise do imóvel
              <span aria-hidden="true">↓</span>
            </a>
            <a href="#marketplace" className={styles.capaLink}>
              Cadastrar no marketplace
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>
      </section>

      <section className={styles.secao} aria-labelledby="titulo-ofertas">
        <div className={styles.dentro}>
          {textos.ofertasOlho && <p className={styles.olho}>{textos.ofertasOlho}</p>}
          {textos.ofertasTitulo && (
            <h2 id="titulo-ofertas">
              <TextoComDestaque texto={textos.ofertasTitulo} />
            </h2>
          )}
          <div className={styles.ofertas}>
            <article className={styles.oferta} aria-labelledby="titulo-gestao">
              <h3 id="titulo-gestao">{textos.gestaoTitulo}</h3>
              {textos.gestaoTexto && <p>{textos.gestaoTexto}</p>}
              <a href="#contato" className={styles.linkTexto}>
                Pedir contato ↓
              </a>
            </article>
            <article className={styles.oferta} aria-labelledby="titulo-marketplace">
              <h3 id="titulo-marketplace">{textos.marketplaceTitulo}</h3>
              {textos.marketplaceTexto && <p>{textos.marketplaceTexto}</p>}
              <a href="#marketplace" className={styles.linkTexto}>
                Cadastrar meu imóvel ↓
              </a>
            </article>
          </div>
        </div>
      </section>

      {passos.length > 0 && (
        <section className={`${styles.secao} ${styles.porque}`} aria-labelledby="titulo-como-gerimos">
          <div className={styles.dentro}>
            {textos.comoOlho && <p className={styles.olho}>{textos.comoOlho}</p>}
            <h2 id="titulo-como-gerimos" className={styles.porqueTitulo}>
              <TextoComDestaque texto={textos.comoTitulo || "Como gerimos"} />
            </h2>
            <div className={`${styles.beneficios} ${styles.passos}`}>
              {passos.map((p, i) => (
                <article key={i}>
                  <span>{String(i + 1).padStart(2, "0")} /</span>
                  {p.titulo && <h3>{p.titulo}</h3>}
                  <p>{p.texto}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {mercado && (
        <section className={styles.secao} aria-labelledby="titulo-mercado">
          <div className={styles.dentro}>
            {textos.mercadoOlho && <p className={styles.olho}>{textos.mercadoOlho}</p>}
            <h2 id="titulo-mercado">
              <TextoComDestaque texto={textos.mercadoTitulo || "Números de referência"} />
            </h2>
            <div className={styles.mercado}>
              {mercado.linhas.map((l) => (
                <article key={l.tipo} className={styles.mercadoLinha} aria-label={l.tipo}>
                  <h3>{l.tipo}</h3>
                  <dl>
                    <dt>Diária média</dt>
                    <dd>{formatBRL(l.diaria)}</dd>
                    <dt>Ocupação</dt>
                    <dd>{bpParaTexto(l.ocupacao)}</dd>
                    {l.liquido !== null && (
                      <>
                        <dt>Líquido por mês, estimado</dt>
                        <dd>{formatBRL(l.liquido)}</dd>
                      </>
                    )}
                  </dl>
                </article>
              ))}
            </div>
            <p className={styles.miudo} role="note">
              Números de {mesPorExtenso(mercado.referencia)} ({mercado.fonte}). São uma estimativa, sem garantia: o resultado de cada imóvel depende do imóvel, da
              época do ano e do mercado.
            </p>
          </div>
        </section>
      )}

      {lista.length > 0 && (
        <section className={`${styles.secao} ${styles.casas}`} aria-labelledby="titulo-casas">
          <div className={styles.dentro}>
            <div className={styles.cabecalhoSecao}>
              <h2 id="titulo-casas">
                <TextoComDestaque texto={textos.vitrineTitulo || "Imóveis que cuidamos"} />
              </h2>
              <Link href="/imoveis" className={styles.linkTexto}>
                Ver todos ↗
              </Link>
            </div>
            <VitrineCasas rotulo={tituloSimples(textos.vitrineTitulo) || "Imóveis que cuidamos"}>
              {lista.map((i, n) => (
                <CartaoImovel key={i.codigo} imovel={i} carregarCedo={n < 2} />
              ))}
            </VitrineCasas>
          </div>
        </section>
      )}

      {textos.portfolioTitulo && (
        <section className={styles.secao} aria-labelledby="titulo-portfolio">
          <div className={styles.dentro}>
            <div className={styles.portfolio}>
              {textos.portfolioOlho && <p className={styles.olho}>{textos.portfolioOlho}</p>}
              <h2 id="titulo-portfolio">
                <TextoComDestaque texto={textos.portfolioTitulo} />
              </h2>
              {textos.portfolioTexto && <p className={styles.texto}>{textos.portfolioTexto}</p>}
            </div>
          </div>
        </section>
      )}

      {versao && secoes.length > 0 && (
        <section className={`${styles.secao} ${styles.porque}`} aria-labelledby="titulo-como-funciona">
          <div className={styles.dentro}>
            <p className={styles.olho}>Por escrito</p>
            <h2 id="titulo-como-funciona">Como funciona</h2>
            <p className={styles.miudo}>
              O mesmo documento que cada proprietário lê e aceita no portal (versão {versao.numero}, de {dataCurta(versao.data)}). O que é do contrato de cada um,
              como a comissão e a forma de receber, aparece no portal, no quadro &ldquo;Seus dados&rdquo;.
            </p>
            <div className={styles.comoFunciona}>
              {secoes.map((s) => (
                <details key={s.chave}>
                  <summary>{s.titulo}</summary>
                  {s.paragrafos.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className={styles.secao} id="contato" aria-labelledby="titulo-contato-proprietario">
        <div className={`${styles.dentro} ${styles.cadastroProprietario}`}>
          <div>
            {textos.contatoOlho && <p className={styles.olho}>{textos.contatoOlho}</p>}
            <h2 id="titulo-contato-proprietario">
              <TextoComDestaque texto={textos.contatoTitulo} />
            </h2>
            {textos.contatoTexto && <p className={styles.texto}>{textos.contatoTexto}</p>}
          </div>
          <FormContatoProprietario empresa={conteudo.nomeEmpresa} />
        </div>
      </section>

      {cadastro}
    </Moldura>
  );
}
