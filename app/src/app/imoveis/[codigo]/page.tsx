import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resumoImovel } from "@/components/site/CartaoImovel";
import { Disponibilidade } from "@/components/site/Disponibilidade";
import { canalDeContato, FormConsulta } from "@/components/site/FormConsulta";
import { FotoProvisoria, Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { hojeISO } from "@/lib/datas";
import { consultarDisponibilidade } from "@/site/disponibilidade";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { imovelDoSite, imoveisDoSite, lerPedidoConsulta, montarConsulta } from "@/site/site";

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
  return (
    <Moldura conteudo={conteudo}>
      <h1 style={{ fontSize: "2rem", margin: "8px 0 4px" }}>{imovel.nome}</h1>
      <p className={styles.miudo} style={{ marginBottom: 16 }}>
        {[imovel.bairro, imovel.cidade].filter(Boolean).join(", ")}
        {resumoImovel(imovel) ? ` · ${resumoImovel(imovel)}` : ""}
      </p>
      <div className={styles.galeria} aria-label="Galeria (fotos em breve)">
        <FotoProvisoria titulo={imovel.nome} />
        <FotoProvisoria titulo="" />
        <FotoProvisoria titulo="" />
      </div>
      <div className={styles.colunas}>
        <div>
          {disponibilidade && <Disponibilidade resultado={disponibilidade} entrada={pedido.entrada} saida={pedido.saida} />}
          {imovel.descricao && <p className={styles.texto}>{imovel.descricao}</p>}
          {imovel.camas.length > 0 && (
            <section className={styles.secao}>
              <h2>Camas</h2>
              <ul className={styles.fichas}>
                {imovel.camas.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
          {imovel.comodidades.length > 0 && (
            <section className={styles.secao}>
              <h2>Comodidades</h2>
              <ul className={styles.fichas}>
                {imovel.comodidades.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
          <section className={styles.secao}>
            <h2>Regras da casa</h2>
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
        <FormConsulta imoveis={todos} valores={consulta} hoje={hoje} canal={canalDeContato(conteudo)} />
      </div>
    </Moldura>
  );
}
