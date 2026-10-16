import { Disponibilidade } from "@/components/site/Disponibilidade";
import { SegurarDatas } from "@/components/site/SegurarDatas";
import { FormConsulta } from "@/components/site/FormConsulta";
import { Moldura, SiteEmConfiguracao, TextoComDestaque } from "@/components/site/Moldura";
import { CabecalhoBusca, ResultadosBusca } from "@/components/site/ResultadosBusca";
import { BotaoContato, SemCasas, textoSemCasas } from "@/components/site/SemCasas";
import styles from "@/components/site/site.module.css";
import { tituloDaSecao } from "@/configuracoes/textos-site";
import { hojeISO } from "@/lib/datas";
import { criarCotacaoAcao } from "@/site/acoes";
import { buscarEmTodasAsCasas } from "@/site/busca";
import { podeSegurar } from "@/site/cotacoes";
import { consultarDisponibilidade } from "@/site/disponibilidade";
import { pixPossivel, portaoDoSite } from "@/site/pagamento";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { ASSUNTO_CONSULTA, AVISO_SEM_CONTATO, CASA_FORA_DO_SITE, canalDeContato, contatoDoSite, hojeMaisCedo, imoveisDoSite, imovelDoSite, lerPedidoConsulta, mensagemDaBusca, montarConsulta } from "@/site/site";

/** Busca em todas as casas (M7.9): o pedido tem datas, mas nenhuma casa escolhida ("Todas as casas"). */
const ehBusca = (p: { imovel: string; entrada: string; saida: string }) => !p.imovel && !!(p.entrada || p.saida);

/**
 * Prévia do link (M7.13): a frase que a própria página mostra (Configurações → Textos do site) — na consulta, a frase
 * abaixo do título; na busca em todas as casas, o aviso acima das casas (vazio = a descrição do site); sem nenhuma casa
 * no site (M7.8), o aviso do site sem casas, que as duas mostram no lugar — e, só na consulta, o endereço principal sem
 * as datas, as pessoas e a casa do link. A busca não indica endereço principal: com o da consulta, o Facebook trocaria a
 * prévia dela pela da consulta. A lista de casas é a mesma da página (`imoveisDoSite`, com `cache`: uma leitura só).
 */
export async function generateMetadata({ searchParams }: PageProps<"/consulta">) {
  const { db, conteudo } = await carregarSite();
  const busca = ehBusca(lerPedidoConsulta(await searchParams));
  const semCasas = conteudo ? !(await imoveisDoSite(db, conteudo.organizacaoId)).length : false;
  const descricao = conteudo && (semCasas ? textoSemCasas(conteudo.textos) : busca ? conteudo.textos.buscaAviso : conteudo.textos.consultaTexto);
  return metadadosDoSite(busca ? "Sua busca" : "Consulta", { descricao, caminho: busca ? undefined : "/consulta" });
}

export default async function Consulta({ searchParams }: PageProps<"/consulta">) {
  const sp = await searchParams;
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const pedido = lerPedidoConsulta(sp);
  const enviado = !!(pedido.entrada || pedido.saida);
  const todos = await imoveisDoSite(db, conteudo.organizacaoId);
  const { textos } = conteudo;
  const busca = ehBusca(pedido);
  const cabecalho = (comTexto: boolean) => (
    <header className={`${styles.cabecalhoPagina} ${styles.cabecalhoConsulta}`}>
      {textos.consultaOlho && <p className={styles.olho}>{textos.consultaOlho}</p>}
      <h1>
        <TextoComDestaque texto={textos.consultaTitulo || "Planeje sua estadia"} />
      </h1>
      {comTexto && textos.consultaTexto && <p>{textos.consultaTexto}</p>}
    </header>
  );
  // Nenhuma casa publicada (M7.8), na consulta e também na busca em todas as casas (M7.9): o formulário só teria
  // "Todas as casas" e nenhuma casa para consultar. Uma regra só para os dois casos, decidida aqui antes da busca: no
  // lugar do formulário, o aviso do site sem casas (`semCasasTexto`) e o contato; a frase da consulta ("escolha a
  // casa…") também sai. Vale também para o link de uma casa fora do site: sem casas, o aviso é este, não o da casa.
  // Na busca, o cabeçalho é o dela (como o título da aba) e o contato é o da busca sem casa para o grupo: o assunto da
  // consulta e, com datas e pessoas válidas, a mensagem com essas informações. Fora da busca, o contato padrão do aviso.
  if (!todos.length) {
    const resultado = busca ? await buscarEmTodasAsCasas(db, conteudo.organizacaoId, pedido, todos) : null;
    return (
      <Moldura conteudo={conteudo}>
        {busca ? <CabecalhoBusca textos={textos} /> : cabecalho(false)}
        <div className={styles.consultaColunas}>
          <SemCasas conteudo={conteudo} contato={busca ? { assunto: ASSUNTO_CONSULTA, mensagem: resultado?.ok ? mensagemDaBusca(pedido, resultado.hospedes) : undefined } : undefined} />
        </div>
      </Moldura>
    );
  }
  // Sem casa escolhida: a situação de cada casa que recebe o grupo, com o link para a página dela. Nada é gravado.
  if (busca) {
    const resultado = await buscarEmTodasAsCasas(db, conteudo.organizacaoId, pedido, todos);
    return (
      <Moldura conteudo={conteudo}>
        <ResultadosBusca conteudo={conteudo} imoveis={todos} pedido={pedido} resultado={resultado} hoje={hojeMaisCedo(todos)} />
      </Moldura>
    );
  }
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
  // Casa pedida que não está (mais) no site, mesmo sem datas (o link antigo de uma casa que saiu, M7.9): o aviso aparece
  // já na chegada, com as outras casas e "Todas as casas" no campo.
  const casaFora = !enviado && !!pedido.imovel && !todos.some((i) => i.codigo === pedido.imovel);
  const erros = r && !r.ok ? r.erros : casaFora ? { imovel: CASA_FORA_DO_SITE } : {};
  // Pagamento no site (M8.2a): os textos "nenhum pagamento é feito aqui" dependem de o Pix estar oferecido.
  const gate = await portaoDoSite(db, conteudo.organizacaoId);
  // Estadia que dá para segurar (null = o site não oferece segurar estas datas).
  const segurar = disponibilidade && podeSegurar(disponibilidade) ? disponibilidade : null;
  const comPix =
    segurar && imovel
      ? await pixPossivel(db, conteudo.organizacaoId, { imovel: { codigo: imovel.codigo }, checkin: pedido.entrada, checkout: pedido.saida, situacao: segurar.situacao, total: segurar.cotacao?.total ?? null }, gate)
      : false;
  // Por onde a conversa continua (WhatsApp, senão e-mail): a regra única do site, para o formulário e para o envio, cujo
  // link (a mensagem pronta, com o assunto da consulta no e-mail) também vem do lugar único, `contatoDoSite`; o botão é o
  // `BotaoContato` de sempre, com o rótulo do envio tirado do mesmo link (`externo`: WhatsApp).
  const canal = canalDeContato(conteudo);
  const envio = prontoParaEnviar && r?.ok ? contatoDoSite(conteudo, { mensagem: r.texto, assunto: ASSUNTO_CONSULTA }) : null;
  // Frase do Resumo da viagem antes da consulta (M7.16): o texto de "Como reservar", quando preenchido (como desde o
  // M7.1), senão a frase própria do quadro; as duas vazias, nenhuma.
  const fraseDoResumo = textos.comoReservar || textos.resumoTexto;
  return (
    <Moldura conteudo={conteudo}>
      {cabecalho(true)}
      {sp.aviso === "mudou" && (
        <p className={styles.aviso} role="alert">
          A disponibilidade ou o valor mudaram desde a sua consulta anterior. Confira a situação atual abaixo.
        </p>
      )}
      <div className={styles.consultaColunas}>
        <div className={styles.consultaForm}>
          <FormConsulta imoveis={todos} valores={pedido} erros={erros} hoje={hojeMinimo} canal={canal} comPagamento={gate.ok} />
        </div>
        {/* Olho, título e frase do quadro em Configurações → Textos do site (M7.16): olho e frase vazios não aparecem;
            título vazio volta ao texto inicial. */}
        <aside className={styles.resumoViagem} aria-labelledby="titulo-resumo">
          {textos.resumoOlho && <p className={styles.olho}>{textos.resumoOlho}</p>}
          <h2 id="titulo-resumo">
            <TextoComDestaque texto={tituloDaSecao(textos, "resumoTitulo")} />
          </h2>
          {disponibilidade ? (
            <Disponibilidade resultado={disponibilidade} entrada={pedido.entrada} saida={pedido.saida} fuso={imovel?.fuso ?? "America/Sao_Paulo"} nivel={3} comPagamento={comPix} />
          ) : (
            <>
              {fraseDoResumo && <p className={styles.texto}>{fraseDoResumo}</p>}
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
              {envio ? (
                <p style={{ marginTop: 16 }}>
                  <BotaoContato contato={envio} rotulo={envio.externo ? "Enviar pelo WhatsApp" : "Enviar por e-mail"} />
                </p>
              ) : (
                <p className={styles.aviso} role="note" style={{ marginTop: 16 }}>
                  {AVISO_SEM_CONTATO}
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
