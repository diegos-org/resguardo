import { Disponibilidade } from "@/components/site/Disponibilidade";
import { SegurarDatas } from "@/components/site/SegurarDatas";
import { canalDeContato, FormConsulta } from "@/components/site/FormConsulta";
import { Moldura, SiteEmConfiguracao, TextoComDestaque } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { hojeISO } from "@/lib/datas";
import { criarCotacaoAcao } from "@/site/acoes";
import { podeSegurar } from "@/site/cotacoes";
import { consultarDisponibilidade } from "@/site/disponibilidade";
import { pixPossivel, portaoDoSite } from "@/site/pagamento";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { hojeMaisCedo, imoveisDoSite, imovelDoSite, lerPedidoConsulta, linkWhatsapp, montarConsulta } from "@/site/site";

export const generateMetadata = () => metadadosDoSite("Consulta");

export default async function Consulta({ searchParams }: PageProps<"/consulta">) {
  const sp = await searchParams;
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const pedido = lerPedidoConsulta(sp);
  const enviado = !!(pedido.entrada || pedido.saida);
  const todos = await imoveisDoSite(db, conteudo.organizacaoId);
  // Disponibilidade e valor reais (M7.2): só depois de o pedido passar na conferência básica.
  const imovel = enviado && pedido.imovel ? await imovelDoSite(db, conteudo.organizacaoId, pedido.imovel) : null;
  // "Hoje" no fuso do imóvel escolhido, o mesmo que a disponibilidade usa; sem imóvel, São Paulo.
  const hoje = hojeISO(imovel?.fuso ?? "America/Sao_Paulo");
  // O mínimo do formulário vale para qualquer imóvel da lista: o "hoje" mais cedo entre os fusos deles.
  // A conferência por imóvel (acima) continua sendo a que decide.
  const hojeMinimo = hojeMaisCedo(imovel ? [imovel, ...todos] : todos);
  const previa = enviado ? montarConsulta(pedido, imovel, hoje) : null;
  const disponibilidade = previa?.ok ? await consultarDisponibilidade(db, conteudo.organizacaoId, pedido) : null;
  const r = enviado ? montarConsulta(pedido, imovel, hoje, disponibilidade && { situacao: disponibilidade.situacao, noites: disponibilidade.noites, total: disponibilidade.cotacao?.total ?? null, desconto: disponibilidade.cotacao?.desconto ?? 0 }) : null;
  // Se a disponibilidade recusar o pedido, a mensagem não é oferecida: vale a conferência mais estrita.
  const prontoParaEnviar = r?.ok === true && disponibilidade?.situacao !== "invalida";
  // Pagamento no site (M8.2a): os textos "nenhum pagamento é feito aqui" dependem de o Pix estar oferecido.
  const gate = await portaoDoSite(db, conteudo.organizacaoId);
  // Estadia que dá para segurar (null = o site não oferece segurar estas datas).
  const segurar = disponibilidade && podeSegurar(disponibilidade) ? disponibilidade : null;
  const comPix =
    segurar && imovel
      ? await pixPossivel(db, conteudo.organizacaoId, { imovel: { codigo: imovel.codigo }, checkin: pedido.entrada, checkout: pedido.saida, situacao: segurar.situacao, total: segurar.cotacao?.total ?? null }, gate)
      : false;
  const { textos } = conteudo;
  return (
    <Moldura conteudo={conteudo}>
      <header className={`${styles.cabecalhoPagina} ${styles.cabecalhoConsulta}`}>
        {textos.consultaOlho && <p className={styles.olho}>{textos.consultaOlho}</p>}
        <h1>
          <TextoComDestaque texto={textos.consultaTitulo || "Planeje sua estadia"} />
        </h1>
        {textos.consultaTexto && <p>{textos.consultaTexto}</p>}
      </header>
      {sp.aviso === "mudou" && (
        <p className={styles.aviso} role="alert">
          A disponibilidade ou o valor mudaram desde a sua consulta anterior. Confira a situação atual abaixo.
        </p>
      )}
      <div className={styles.consultaColunas}>
        <div className={styles.consultaForm}>
          <FormConsulta imoveis={todos} valores={pedido} erros={r && !r.ok ? r.erros : {}} hoje={hojeMinimo} canal={canalDeContato(conteudo)} comPagamento={gate.ok} />
        </div>
        <aside className={styles.resumoViagem} aria-labelledby="titulo-resumo">
          <p className={styles.olho}>Sua estadia, sem surpresas</p>
          <h2 id="titulo-resumo">Resumo da viagem</h2>
          {disponibilidade ? (
            <Disponibilidade resultado={disponibilidade} entrada={pedido.entrada} saida={pedido.saida} fuso={imovel?.fuso ?? "America/Sao_Paulo"} nivel={3} comPagamento={comPix} />
          ) : (
            <>
              <p className={styles.texto}>{textos.comoReservar || "Escolha o apartamento, as datas e quantas pessoas."}</p>
              <dl className={styles.resumo}>
                <dt>Estadia</dt>
                <dd>a confirmar</dd>
                <dt>Limpeza e demais taxas</dt>
                <dd>a confirmar</dd>
                <dt>
                  <strong>Total</strong>
                </dt>
                <dd>
                  <strong>a confirmar</strong>
                </dd>
              </dl>
              <p className={styles.miudo} style={{ marginTop: 12 }}>
                {gate.ok ? "Nada é cobrado nem reservado na consulta." : "Nada é cobrado nem reservado por aqui."}
              </p>
            </>
          )}
          {segurar && <SegurarDatas pedido={pedido} aConfirmar={segurar.situacao === "a_confirmar"} acao={criarCotacaoAcao} nivel={3} comPagamento={comPix} />}
          {prontoParaEnviar && r?.ok && (
            <section className={styles.bloco} aria-labelledby="titulo-mensagem">
              <h3 id="titulo-mensagem">Sua mensagem</h3>
              <p className={`${styles.texto} ${styles.caixa}`}>{r.texto}</p>
              {conteudo.whatsapp ? (
                <p style={{ marginTop: 16 }}>
                  <a href={linkWhatsapp(conteudo.whatsapp, r.texto)} className={styles.botao} target="_blank" rel="noopener noreferrer">
                    Enviar pelo WhatsApp
                    <span aria-hidden="true">↗</span>
                  </a>
                </p>
              ) : conteudo.email ? (
                <p style={{ marginTop: 16 }}>
                  <a href={`mailto:${conteudo.email}?subject=${encodeURIComponent("Consulta de disponibilidade")}&body=${encodeURIComponent(r.texto)}`} className={styles.botao}>
                    Enviar por e-mail
                    <span aria-hidden="true">↗</span>
                  </a>
                </p>
              ) : (
                <p className={styles.aviso} role="note" style={{ marginTop: 16 }}>
                  O contato ainda não foi configurado. Volte em breve.
                </p>
              )}
              <p className={styles.miudo} style={{ marginTop: 12 }}>
                {comPix ? "Pela conversa, a reserva é confirmada pela equipe. Para pagar por Pix aqui no site, segure as datas." : "A reserva é confirmada na conversa. Nenhuma reserva ou pagamento é feito aqui."}
              </p>
            </section>
          )}
        </aside>
      </div>
    </Moldura>
  );
}
