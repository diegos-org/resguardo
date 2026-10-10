import { notFound } from "next/navigation";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { AlteracaoNaReserva } from "@/components/site/AlteracaoNaReserva";
import { BotaoContato, Cotacao } from "@/components/site/Cotacao";
import { FormSegurar } from "@/components/site/FormSegurar";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import { PagamentoPix } from "@/components/site/PagamentoPix";
import styles from "@/components/site/site.module.css";
import { versaoAtualDaPaginaLegal } from "@/configuracoes/paginas-legais";
import { TEXTOS_SITE_INICIAIS, TEXTOS_SITE_OBRIGATORIOS, type TextosSite } from "@/configuracoes/textos-site";
import { aceiteDaDiferencaParaPagina, aceiteParaPagina } from "@/site/aceites";
import { segurarDatasAcao } from "@/site/acoes";
import { continuarPagamentoAcao, gerarPixAcao, pagarComCartaoAcao } from "@/site/acoes-pagamento";
import { autorizadoNaCotacao } from "@/site/checkout";
import { codigoCotacaoValido, textoDaCotacao, verCotacao } from "@/site/cotacoes";
import { cartaoNoSite, pixPossivel, portaoDoSite, vistaDoPagamento } from "@/site/pagamento";
import {
  contatoPrincipal,
  ESTADOS_QUE_PAGAM,
  linhaDaAnalise,
  mensagemDoContato,
  mensagemDoContatoDaAlteracao,
  type TextosDaAlteracao,
  type TextosDoCancelamento,
  TITULO_PAGAMENTO,
} from "@/site/pagamento-vista";
import { carregarSite, metadadosDoSite } from "@/site/pagina";

export const generateMetadata = () => metadadosDoSite("Cotação");

const CHAVES_DO_CANCELAMENTO = [
  "cancelamentoSemTaxas",
  "cancelamentoDevolucaoPedida",
  "cancelamentoEstornoNoCartao",
  "cancelamentoVoltaPix",
  "cancelamentoVoltaCartao",
  "cancelamentoVoltaPorFora",
  "cancelamentoComAEquipe",
  "cancelamentoEmConferencia",
  "cancelamentoSemDevolucaoPrazo",
  "cancelamentoSemDevolucaoNaoComparecimento",
  "cancelamentoSemDevolucaoEquipe",
  "cancelamentoFecho",
  "cancelamentoPedidoRecebido",
  "devolucaoAguardaLiberacao",
] as const satisfies readonly (keyof TextosDoCancelamento)[];

/** As frases do cancelamento (M8.2c) de Textos do site: as obrigatórias nunca saem vazias; a frase final pode. */
const textosDoCancelamento = (t: TextosSite): TextosDoCancelamento =>
  Object.fromEntries(CHAVES_DO_CANCELAMENTO.map((k) => [k, t[k] || (TEXTOS_SITE_OBRIGATORIOS.includes(k) ? TEXTOS_SITE_INICIAIS[k] : "")])) as TextosDoCancelamento;

const CHAVES_DA_ALTERACAO = [
  "alteracaoEmAndamento",
  "alteracaoAguardaConfirmacao",
  "alteracaoPolitica",
  "alteracaoConfirmada",
  "devolucaoAguardaLiberacao",
  "alteracaoSemDevolucao",
  "alteracaoNaoAplicada",
  "alteracaoNaoVale",
  "cancelamentoDevolucaoPedida",
  "cancelamentoEstornoNoCartao",
  "cancelamentoVoltaPix",
  "cancelamentoVoltaCartao",
  "cancelamentoVoltaPorFora",
  "cancelamentoComAEquipe",
  "cancelamentoEmConferencia",
] as const satisfies readonly (keyof TextosDaAlteracao)[];

/** As frases da alteração (M8.2d) de Textos do site, do mesmo jeito: as obrigatórias nunca saem vazias. */
const textosDaAlteracao = (t: TextosSite): TextosDaAlteracao =>
  Object.fromEntries(CHAVES_DA_ALTERACAO.map((k) => [k, t[k] || (TEXTOS_SITE_OBRIGATORIOS.includes(k) ? TEXTOS_SITE_INICIAIS[k] : "")])) as TextosDaAlteracao;

/**
 * Situações que mostram o aceite das páginas legais (M7.4): a caixa antes do Pix ou do cartão (M8.2b) em toda situação
 * que pode pagar — a mesma lista que decide a oferta —, ou o aceite da reserva confirmada.
 */
const COM_ACEITE = new Set([...ESTADOS_QUE_PAGAM, "confirmada"]);

/**
 * Página pública da cotação (M8.1): sempre revalidada ao abrir; nada é gravado só por visitar. Com o pagamento no
 * site (M8.2a), a situação do pagamento vence a da cotação ("expirada", "cancelada") e o pagamento vem primeiro (o Pix
 * em destaque; o cartão de crédito ao lado quando ligado, M8.2b). M8.2d: a alteração da reserva paga vem acima do quadro
 * do pagamento (`AlteracaoNaReserva`), com o pagamento da diferença no aumento e o aceite na política da reserva (D11).
 */
export default async function PaginaCotacao({ params }: PageProps<"/reservar/[codigo]">) {
  const { codigo: bruto } = await params;
  const codigo = decodeURIComponent(bruto).toUpperCase();
  if (!codigoCotacaoValido(codigo)) notFound();
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const organizacaoId = conteudo.organizacaoId;
  const agora = new Date();
  const [vista, regras, gate] = await Promise.all([verCotacao(db, organizacaoId, codigo, agora), lerRegrasCalendario(db, organizacaoId), portaoDoSite(db, organizacaoId, agora)]);
  if (!vista) notFound();
  const c = vista.cotacao;
  const autorizado = await autorizadoNaCotacao(c.id, agora);
  const vistaPagamento = await vistaDoPagamento(db, organizacaoId, c.id, agora, { comAutorizacao: autorizado, gate: async () => gate });
  const pagamento = vistaPagamento && vistaPagamento.estado !== "sem_pagamento" ? vistaPagamento : null;
  // Sem pagamento em curso: o texto "nenhum pagamento é feito no site" depende de o Pix ser oferecido para esta
  // estadia. Cotação segurada sem "pagar" = a oferta já disse que não (segue pela conversa); reserva já confirmada
  // pela equipe = nada mais a pagar no site.
  const pagamentoNoSite =
    !pagamento && vista.estado !== "segurada" && vista.estado !== "convertida" && !(vista.estado === "aberta" && vista.mudou)
      ? await pixPossivel(db, organizacaoId, { imovel: { id: c.imovelId }, checkin: c.checkin, checkout: c.checkout, situacao: c.situacao, total: c.total }, gate)
      : false;
  const ambienteTeste = gate.ok || (pagamento?.ambienteTeste ?? false);
  // Com o cartão ligado (M8.2b), os textos de antes de segurar dizem "por Pix ou cartão".
  const cartaoNoPagamento = pagamentoNoSite && (await cartaoNoSite(db, organizacaoId, gate, agora));
  // M7.4: o aceite das páginas legais (caixa no "Gerar Pix" ou no cartão, só quando algum pode aparecer; ou as versões
  // aceitas na reserva confirmada) e, no formulário de segurar as datas, o link da Política de privacidade em vigor.
  const comFormulario = !!pagamento && (pagamento.estado === "confirmada" || pagamento.podeGerar || pagamento.podePagarCartao);
  const aceite = pagamento && COM_ACEITE.has(pagamento.estado) && comFormulario ? await aceiteParaPagina(db, organizacaoId, { id: c.id, checkin: c.checkin, fuso: c.fuso, reservaId: c.reservaId }, agora) : null;
  // M8.2d: a alteração (a vista já traz a oferta da diferença) e, quando o Pix ou o cartão da diferença aparecem, o aceite
  // na forma do D11 (os Termos e a Privacidade em vigor com a política da reserva).
  const alteracao = pagamento?.alteracao ?? null;
  const pagaDiferenca = !!alteracao?.pagamento && (alteracao.pagamento.podeGerar || alteracao.pagamento.podePagarCartao);
  const aceiteDaDiferenca = pagaDiferenca && c.reservaId ? await aceiteDaDiferencaParaPagina(db, organizacaoId, { id: c.id, checkin: c.checkin, fuso: c.fuso, reservaId: c.reservaId }, agora) : null;
  const mostraFormulario = vista.estado === "aberta" && !vista.mudou;
  // A Política de privacidade vale assim que publicada, mesmo com os termos ou o cancelamento ainda em preparação.
  const privacidade = mostraFormulario ? await versaoAtualDaPaginaLegal(db, organizacaoId, "privacidade") : null;
  const { textos } = conteudo;
  const reservaCodigo = pagamento?.reservaCodigo ?? null;
  const quadroDaAlteracao =
    pagamento && alteracao && reservaCodigo ? (
      <AlteracaoNaReserva
        codigo={codigo}
        reservaCodigo={reservaCodigo}
        alteracao={alteracao}
        textos={textosDaAlteracao(textos)}
        fuso={c.fuso}
        autorizado={autorizado}
        aceite={aceiteDaDiferenca}
        textosPagamento={{
          aguardando: textos.pagamentoAguardando || TEXTOS_SITE_INICIAIS.pagamentoAguardando,
          semDatas: textos.pagamentoSemDatas || TEXTOS_SITE_INICIAIS.pagamentoSemDatas,
          cartaoAnalise: textos.pagamentoCartaoAnalise || TEXTOS_SITE_INICIAIS.pagamentoCartaoAnalise,
        }}
        contato={
          conteudo.whatsapp || conteudo.email ? (
            <BotaoContato whatsapp={conteudo.whatsapp} email={conteudo.email} codigo={c.codigo} texto={mensagemDoContatoDaAlteracao(textoDaCotacao(vista), reservaCodigo)} secundario />
          ) : null
        }
        gerarPix={gerarPixAcao.bind(null, codigo)}
        continuar={continuarPagamentoAcao}
        pagarComCartao={pagarComCartaoAcao.bind(null, codigo)}
        linhaAnalise={alteracao.pagamento?.estado === "cartao_em_analise" ? linhaDaAnalise(alteracao.pagamento.prazoDasDatas, agora, c.fuso) : null}
      />
    ) : null;
  return (
    <Moldura conteudo={conteudo}>
      <div className={styles.largo}>
        <header className={styles.cabecalhoPagina}>
          <p className={styles.olho}>Cotação</p>
          <h1>Reservar</h1>
        </header>
        {ambienteTeste && (
          <p className={styles.faixaTeste} role="note">
            Ambiente de teste: nenhuma cobrança real.
          </p>
        )}
        <Cotacao
          vista={vista}
          whatsapp={conteudo.whatsapp}
          email={conteudo.email}
          pagamentoNoSite={pagamentoNoSite}
          comCartao={cartaoNoPagamento}
          reservaAtual={pagamento?.reservaAtual && reservaCodigo ? { codigo: reservaCodigo, ...pagamento.reservaAtual } : null}
          formulario={
            mostraFormulario ? (
              <FormSegurar codigo={codigo} minutos={regras.site.minutosHold} acao={segurarDatasAcao} comPagamento={pagamentoNoSite} comCartao={cartaoNoPagamento} privacidade={privacidade} />
            ) : null
          }
          pagamento={
            pagamento && pagamento.estado !== "sem_pagamento"
              ? {
                  titulo: TITULO_PAGAMENTO[pagamento.estado],
                  conteudo: (
                    <>
                      {quadroDaAlteracao}
                      <PagamentoPix
                        codigo={codigo}
                        pagamento={pagamento}
                        autorizado={autorizado}
                        fuso={c.fuso}
                        total={c.total}
                        textos={{
                          convite: textos.pagamentoConvite || TEXTOS_SITE_INICIAIS.pagamentoConvite,
                          aguardando: textos.pagamentoAguardando || TEXTOS_SITE_INICIAIS.pagamentoAguardando,
                          semDatas: textos.pagamentoSemDatas || TEXTOS_SITE_INICIAIS.pagamentoSemDatas,
                          cartaoAnalise: textos.pagamentoCartaoAnalise || TEXTOS_SITE_INICIAIS.pagamentoCartaoAnalise,
                          cancelamento: textosDoCancelamento(textos),
                        }}
                        contato={
                          conteudo.whatsapp || conteudo.email ? (
                            <BotaoContato
                              whatsapp={conteudo.whatsapp}
                              email={conteudo.email}
                              codigo={c.codigo}
                              texto={mensagemDoContato(textoDaCotacao(vista), pagamento.estado, pagamento.reservaCodigo, pagamento.forma)}
                              secundario={!contatoPrincipal(pagamento)}
                            />
                          ) : null
                        }
                        gerarPix={gerarPixAcao.bind(null, codigo)}
                        continuar={continuarPagamentoAcao}
                        pagarComCartao={pagarComCartaoAcao.bind(null, codigo)}
                        aceite={aceite}
                        linhaAnalise={pagamento.estado === "cartao_em_analise" ? linhaDaAnalise(pagamento.prazoDasDatas, agora, c.fuso) : null}
                      />
                    </>
                  ),
                }
              : undefined
          }
        />
      </div>
    </Moldura>
  );
}
