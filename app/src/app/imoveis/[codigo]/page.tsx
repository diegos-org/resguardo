import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BairroAPorta } from "@/components/site/BairroAPorta";
import { olhoImovel, resumoImovel } from "@/components/site/CartaoImovel";
import { Disponibilidade } from "@/components/site/Disponibilidade";
import { SegurarDatas } from "@/components/site/SegurarDatas";
import { canalDeContato, FormConsulta } from "@/components/site/FormConsulta";
import { GaleriaImovel } from "@/components/site/GaleriaImovel";
import { FotoProvisoria, Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { hojeISO } from "@/lib/datas";
import { criarCotacaoAcao } from "@/site/acoes";
import { lugaresDoSite } from "@/site/bairro";
import { podeSegurar } from "@/site/cotacoes";
import { consultarDisponibilidade } from "@/site/disponibilidade";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { hojeMaisCedo, imovelDoSite, imoveisDoSite, lerPedidoConsulta, montarConsulta } from "@/site/site";

export async function generateMetadata({ params }: PageProps<"/imoveis/[codigo]">): Promise<Metadata> {
  const { codigo } = await params;
  const { db, conteudo } = await carregarSite();
  const i = conteudo ? await imovelDoSite(db, conteudo.organizacaoId, codigo) : null;
  return metadadosDoSite(i?.nome);
}

export default async function PaginaImovel({ params, searchParams }: PageProps<"/imoveis/[codigo]">) {
  const { codigo } = await params;
  // Link com datas e pessoas (ex.: ?checkin=…&checkout=…&guests=2) já preenche o formulário.
  const pedido = lerPedidoConsulta(await searchParams);
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const [imovel, todos] = await Promise.all([imovelDoSite(db, conteudo.organizacaoId, codigo), imoveisDoSite(db, conteudo.organizacaoId)]);
  if (!imovel) notFound();
  const lugares = await lugaresDoSite(db, conteudo.organizacaoId, imovel.bairro);
  // "Hoje" no fuso do imóvel, o mesmo que a disponibilidade usa.
  const hoje = hojeISO(imovel.fuso);
  // Com datas no link, mostra disponibilidade e valor reais (M7.2) antes do formulário.
  const consulta = { ...pedido, imovel: imovel.codigo };
  const disponibilidade = pedido.entrada && pedido.saida && montarConsulta(consulta, imovel, hoje).ok ? await consultarDisponibilidade(db, conteudo.organizacaoId, consulta) : null;
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
          {disponibilidade && <Disponibilidade resultado={disponibilidade} entrada={pedido.entrada} saida={pedido.saida} fuso={imovel.fuso} />}
          {disponibilidade && podeSegurar(disponibilidade) && <SegurarDatas pedido={consulta} aConfirmar={disponibilidade.situacao === "a_confirmar"} acao={criarCotacaoAcao} />}
          {imovel.descricao && <p className={styles.texto}>{imovel.descricao}</p>}
          {imovel.comodidades.length > 0 && (
            <section aria-labelledby="titulo-comodidades">
              <h3 id="titulo-comodidades">O que você encontra</h3>
              <ul className={styles.comodidades}>
                {imovel.comodidades.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
          {imovel.camas.length > 0 && (
            <section aria-labelledby="titulo-camas">
              <h3 id="titulo-camas">Camas</h3>
              <ul className={styles.fichas}>
                {imovel.camas.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="titulo-regras">
            <h3 id="titulo-regras">Regras da casa</h3>
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
          <FormConsulta imoveis={todos} valores={consulta} hoje={hojeMaisCedo([imovel, ...todos])} canal={canalDeContato(conteudo)} variante="lateral" />
        </aside>
      </div>
      <BairroAPorta lugares={lugares} />
    </Moldura>
  );
}
