import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BairroAPorta } from "@/components/site/BairroAPorta";
import { fraseDoImovel, olhoImovel, resumoImovel } from "@/components/site/CartaoImovel";
import { Disponibilidade } from "@/components/site/Disponibilidade";
import { SegurarDatas } from "@/components/site/SegurarDatas";
import { FormConsulta } from "@/components/site/FormConsulta";
import { GaleriaImovel } from "@/components/site/GaleriaImovel";
import { metadadosDaNaoEncontrada } from "@/components/site/NaoEncontrada";
import { IconeComodidade, temIcone } from "@/components/site/IconeComodidade";
import { FotoProvisoria, Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { hojeISO } from "@/lib/datas";
import { criarCotacaoAcao } from "@/site/acoes";
import { lugaresDoSite } from "@/site/bairro";
import { linkDaCasa } from "@/site/link-da-casa";
import { podeSegurar } from "@/site/cotacoes";
import { consultarDisponibilidade } from "@/site/disponibilidade";
import { pixPossivel, portaoDoSite } from "@/site/pagamento";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { canalDeContato, hojeMaisCedo, imovelDoSite, imoveisDoSite, lerPedidoConsulta, montarConsulta } from "@/site/site";

export async function generateMetadata({ params }: PageProps<"/imoveis/[codigo]">): Promise<Metadata> {
  const { codigo } = await params;
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return metadadosDoSite(undefined);
  // A mesma leitura da página (com `cache`, uma vez só por requisição).
  const i = await imovelDoSite(db, conteudo.organizacaoId, codigo);
  // Casa que não existe ou saiu do site (M7.8): o título da aba é o da "Casa não encontrada" já aqui, o mesmo de
  // ./not-found.tsx, para não depender só do título da not-found (que o Next pode trocar pelo do layout).
  if (!i) return metadadosDaNaoEncontrada("casa");
  // Prévia do link (M7.13): o nome, a primeira frase da descrição (a mesma do cartão) e a versão pequena da capa da casa
  // (sem foto, sem imagem: nunca a capa do site no lugar). O endereço principal é o da casa, sem as datas do link.
  const capa = i.fotos[0];
  return metadadosDoSite(i.nome, {
    descricao: fraseDoImovel(i),
    imagem: capa ? { url: capa.pequena, alt: capa.legenda || `Foto de ${i.nome}` } : null,
    caminho: linkDaCasa(i.codigo) ?? undefined,
  });
}

export default async function PaginaImovel({ params, searchParams }: PageProps<"/imoveis/[codigo]">) {
  const { codigo } = await params;
  // Link com datas e pessoas (ex.: ?checkin=…&checkout=…&guests=2) já preenche o formulário.
  const pedido = lerPedidoConsulta(await searchParams);
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const [imovel, todos] = await Promise.all([imovelDoSite(db, conteudo.organizacaoId, codigo), imoveisDoSite(db, conteudo.organizacaoId)]);
  if (!imovel) notFound();
  const bairro = await lugaresDoSite(db, conteudo.organizacaoId, imovel.bairro);
  // "Hoje" no fuso do imóvel, o mesmo que a disponibilidade usa.
  const hoje = hojeISO(imovel.fuso);
  // Com datas no link, mostra disponibilidade e valor reais (M7.2) antes do formulário.
  const consulta = { ...pedido, imovel: imovel.codigo };
  const disponibilidade = pedido.entrada && pedido.saida && montarConsulta(consulta, imovel, hoje).ok ? await consultarDisponibilidade(db, conteudo.organizacaoId, consulta) : null;
  // Pagamento no site (M8.2a): os textos "nenhum pagamento é feito aqui" dependem de o Pix estar oferecido.
  const gate = await portaoDoSite(db, conteudo.organizacaoId);
  // Estadia que dá para segurar (null = o site não oferece segurar estas datas).
  const segurar = disponibilidade && podeSegurar(disponibilidade) ? disponibilidade : null;
  const comPix = segurar
    ? await pixPossivel(db, conteudo.organizacaoId, { imovel: { codigo: imovel.codigo }, checkin: consulta.entrada, checkout: consulta.saida, situacao: segurar.situacao, total: segurar.cotacao?.total ?? null }, gate)
    : false;
  const regras = [
    `Entrada a partir das ${imovel.checkinAPartirDe}`,
    `Saída até as ${imovel.checkoutAte}`,
    imovel.estadiaMinima ? `Em geral, mínimo de ${imovel.estadiaMinima} ${imovel.estadiaMinima === 1 ? "noite" : "noites"} (datas especiais podem ter outro mínimo)` : null,
    imovel.aceitaAnimais ? "Aceita animais" : "Não aceita animais",
    imovel.permiteFumar ? null : "Proibido fumar",
    imovel.permiteFestas ? null : "Sem festas ou eventos",
  ].filter((x): x is string => !!x);
  const resumo = resumoImovel(imovel);
  return (
    <Moldura conteudo={conteudo}>
      <Link href="/imoveis" className={styles.linkTexto}>
        ← Todas as casas
      </Link>
      <header className={styles.cabecalhoImovel}>
        <div>
          <p className={styles.olho}>{olhoImovel(imovel)}</p>
          <h1>{imovel.nome}</h1>
          {resumo && <p>{resumo}</p>}
        </div>
        <a href="#planejar" className={styles.botao}>
          Planejar estadia
          <span aria-hidden="true">↗</span>
        </a>
      </header>
      {imovel.fotos.length > 0 ? (
        <GaleriaImovel nome={imovel.nome} fotos={imovel.fotos} />
      ) : (
        <>
          <div className={styles.galeria} aria-label="Galeria (fotos em breve)">
            <div className={styles.galeriaPrincipal}>
              <FotoProvisoria titulo={imovel.nome} />
            </div>
            <div className={styles.miniaturas}>
              <FotoProvisoria titulo="" />
              <FotoProvisoria titulo="" />
              <FotoProvisoria titulo="" />
              <FotoProvisoria titulo="" />
            </div>
          </div>
          <p className={styles.notaEditorial}>Fotos em breve.</p>
        </>
      )}
      <div className={styles.colunas}>
        <div className={styles.editorial}>
          {disponibilidade && <Disponibilidade resultado={disponibilidade} entrada={pedido.entrada} saida={pedido.saida} fuso={imovel.fuso} comPagamento={comPix} />}
          {segurar && <SegurarDatas pedido={consulta} aConfirmar={segurar.situacao === "a_confirmar"} acao={criarCotacaoAcao} comPagamento={comPix} />}
          {imovel.descricao && <p className={styles.texto}>{imovel.descricao}</p>}
          {imovel.comodidades.length > 0 && (
            <section aria-labelledby="titulo-comodidades">
              {/* h2 abaixo do h1 do imóvel (M7.11), no tamanho menor das partes da ficha. */}
              <h2 id="titulo-comodidades" className={styles.tituloFicha}>
                O que você encontra
              </h2>
              <ul className={styles.comodidades}>
                {imovel.comodidades.map((c) => (
                  <li key={c}>
                    {temIcone(c) ? <IconeComodidade nome={c} /> : <span aria-hidden="true">✓</span>}
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {imovel.camas.length > 0 && (
            <section aria-labelledby="titulo-camas">
              <h2 id="titulo-camas" className={styles.tituloFicha}>
                Camas
              </h2>
              <ul className={styles.fichas}>
                {imovel.camas.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="titulo-regras">
            <h2 id="titulo-regras" className={styles.tituloFicha}>
              Regras da casa
            </h2>
            <ul className={styles.fichas}>
              {regras.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {imovel.regrasCasa && (
              <p className={styles.texto} style={{ marginTop: 12 }}>
                {imovel.regrasCasa}
              </p>
            )}
          </section>
        </div>
        <aside id="planejar" className={styles.lateral} aria-labelledby="titulo-planejar">
          <p className={styles.olho}>Planeje sua estadia</p>
          <h2 id="titulo-planejar">Consultar disponibilidade</h2>
          <FormConsulta imoveis={todos} valores={consulta} hoje={hojeMaisCedo([imovel, ...todos])} canal={canalDeContato(conteudo)} variante="lateral" comPagamento={gate.ok} />
        </aside>
      </div>
      <BairroAPorta {...bairro} />
    </Moldura>
  );
}
