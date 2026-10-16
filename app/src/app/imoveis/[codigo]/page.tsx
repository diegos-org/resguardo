import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BairroAPorta } from "@/components/site/BairroAPorta";
import { altDaCapa } from "@/components/site/CapaDoImovel";
import { olhoImovel, resumoImovel } from "@/components/site/CartaoImovel";
import { Disponibilidade } from "@/components/site/Disponibilidade";
import { SegurarDatas } from "@/components/site/SegurarDatas";
import { FormConsulta } from "@/components/site/FormConsulta";
import { GaleriaImovel } from "@/components/site/GaleriaImovel";
import { metadadosDaNaoEncontrada } from "@/components/site/NaoEncontrada";
import { IconeComodidade, temIcone } from "@/components/site/IconeComodidade";
import { RegrasDaCasa } from "@/components/site/RegrasDaCasa";
import { FotoProvisoria, Moldura, SiteEmConfiguracao, TextoComDestaque } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { tituloDaSecao } from "@/configuracoes/textos-site";
import { hojeISO } from "@/lib/datas";
import { criarCotacaoAcao } from "@/site/acoes";
import { lugaresDoSite } from "@/site/bairro";
import { linkDaCasa } from "@/site/link-da-casa";
import { podeSegurar } from "@/site/cotacoes";
import { consultarDisponibilidade, disponibilidadeInvalida } from "@/site/disponibilidade";
import { fraseDoImovel } from "@/site/frase-do-imovel";
import { pixPossivel, portaoDoSite } from "@/site/pagamento";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { frasesDosHorarios, regrasDaCasa } from "@/site/regras-da-casa";
import { canalDeContato, hojeMaisCedo, imovelDoSite, imoveisDoSite, lerPedidoConsulta, montarConsulta, pedidoEnviado } from "@/site/site";

export async function generateMetadata({ params }: PageProps<"/imoveis/[codigo]">): Promise<Metadata> {
  const { codigo } = await params;
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return metadadosDoSite(undefined);
  // A mesma leitura da página (com `cache`, uma vez só por requisição: por isso, os mesmos argumentos, com "galeria").
  const i = await imovelDoSite(db, conteudo.organizacaoId, codigo, "galeria");
  // Casa que não existe ou saiu do site (M7.8): o título da aba é o da "Casa não encontrada" já aqui, o mesmo de
  // ./not-found.tsx, para não depender só do título da not-found (que o Next pode trocar pelo do layout).
  if (!i) return metadadosDaNaoEncontrada("casa");
  // Prévia do link (M7.13): o nome, a frase do cartão (`fraseDoImovel`: a frase de abertura da casa, M7.17, ou a primeira
  // frase da descrição; sem descrição, bairro e cidade) e a versão pequena da capa da casa
  // (sem foto, sem imagem: nunca a capa do site no lugar). O endereço principal é o da casa, sem as datas do link.
  const capa = i.fotos[0];
  return metadadosDoSite(i.nome, {
    descricao: fraseDoImovel(i),
    imagem: capa ? { url: capa.pequena, alt: altDaCapa(i.nome, capa) } : null,
    caminho: linkDaCasa(i.codigo) ?? undefined,
  });
}

export default async function PaginaImovel({ params, searchParams }: PageProps<"/imoveis/[codigo]">) {
  const { codigo } = await params;
  // Link com datas e pessoas (ex.: ?checkin=…&checkout=…&guests=2) já preenche o formulário.
  const pedido = lerPedidoConsulta(await searchParams);
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  // Com as medidas das fotos (M7.19), para a galeria; a mesma leitura dos metadados acima.
  const [imovel, todos] = await Promise.all([imovelDoSite(db, conteudo.organizacaoId, codigo, "galeria"), imoveisDoSite(db, conteudo.organizacaoId)]);
  if (!imovel) notFound();
  const bairro = await lugaresDoSite(db, conteudo.organizacaoId, imovel.bairro);
  // "Hoje" no fuso do imóvel, o mesmo que a disponibilidade usa.
  const hoje = hojeISO(imovel.fuso);
  // Com datas no link, mostra disponibilidade e valor reais (M7.2) antes do formulário.
  const consulta = { ...pedido, imovel: imovel.codigo };
  // Link com datas que não servem (M7.21: entrada antes de hoje, saída antes da entrada, grupo maior que a casa ou sem o
  // número de pessoas): a mesma conferência da consulta (`montarConsulta`), com os mesmos textos, no quadro da
  // disponibilidade ("Confira os dados") e nos campos do cartão "Planeje sua estadia" — avisar em vez de não mostrar nada.
  // Vale com alguma data no link (`pedidoEnviado`, a mesma regra do envio da consulta); sem datas, nenhum aviso. Pedido que
  // não passa não chega à disponibilidade, nem ao "segurar as datas".
  const conferida = pedidoEnviado(pedido) ? montarConsulta(consulta, imovel, hoje) : null;
  const erros = conferida && !conferida.ok ? conferida.erros : {};
  const disponibilidade = conferida?.ok ? await consultarDisponibilidade(db, conteudo.organizacaoId, consulta) : conferida ? disponibilidadeInvalida(Object.values(erros)) : null;
  // Pagamento no site (M8.2a): os textos "nenhum pagamento é feito aqui" dependem de o Pix estar oferecido.
  const gate = await portaoDoSite(db, conteudo.organizacaoId);
  // Estadia que dá para segurar (null = o site não oferece segurar estas datas).
  const segurar = disponibilidade && podeSegurar(disponibilidade) ? disponibilidade : null;
  const comPix = segurar
    ? await pixPossivel(db, conteudo.organizacaoId, { imovel: { codigo: imovel.codigo }, checkin: consulta.entrada, checkout: consulta.saida, situacao: segurar.situacao, total: segurar.cotacao?.total ?? null }, gate)
    : false;
  // Horários e regras de convivência de um lugar só (M7.20), os mesmos da página da cotação; a estadia mínima entra aqui.
  const casa = regrasDaCasa(imovel);
  const regras = [
    ...frasesDosHorarios(casa),
    imovel.estadiaMinima ? `Em geral, mínimo de ${imovel.estadiaMinima} ${imovel.estadiaMinima === 1 ? "noite" : "noites"} (datas especiais podem ter outro mínimo)` : null,
    ...casa.convivencia,
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
          {/* Frase de abertura da casa (M7.17), acima da descrição, em serifa como no estudo; h2 logo abaixo do h1. Sem frase, nada. */}
          {imovel.frase && <h2 className={styles.fraseDaCasa}>{imovel.frase}</h2>}
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
          <RegrasDaCasa itens={regras} texto={casa.texto} />
        </div>
        {/* Cartão da consulta (M7.16): olho, título e frase de Configurações → Textos do site (olho e frase vazios não
            aparecem; título vazio volta ao texto inicial). */}
        <aside id="planejar" className={styles.lateral} aria-labelledby="titulo-planejar">
          {conteudo.textos.planejarOlho && <p className={styles.olho}>{conteudo.textos.planejarOlho}</p>}
          <h2 id="titulo-planejar">
            <TextoComDestaque texto={tituloDaSecao(conteudo.textos, "planejarTitulo")} />
          </h2>
          {conteudo.textos.planejarTexto && (
            <p className={styles.texto} style={{ margin: 0 }}>
              {conteudo.textos.planejarTexto}
            </p>
          )}
          <FormConsulta imoveis={todos} valores={consulta} erros={erros} hoje={hojeMaisCedo([imovel, ...todos])} canal={canalDeContato(conteudo)} variante="lateral" comPagamento={gate.ok} />
        </aside>
      </div>
      <BairroAPorta {...bairro} />
    </Moldura>
  );
}
