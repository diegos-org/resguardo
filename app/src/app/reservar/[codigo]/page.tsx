import { notFound } from "next/navigation";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { BotaoContato, Cotacao } from "@/components/site/Cotacao";
import { FormSegurar } from "@/components/site/FormSegurar";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import { PagamentoPix } from "@/components/site/PagamentoPix";
import styles from "@/components/site/site.module.css";
import { versoesLegaisAtuais } from "@/configuracoes/paginas-legais";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { aceiteParaPagina } from "@/site/aceites";
import { segurarDatasAcao } from "@/site/acoes";
import { continuarPagamentoAcao, gerarPixAcao } from "@/site/acoes-pagamento";
import { autorizadoNaCotacao } from "@/site/checkout";
import { codigoCotacaoValido, textoDaCotacao, verCotacao } from "@/site/cotacoes";
import { pixPossivel, portaoDoSite, vistaDoPagamento } from "@/site/pagamento";
import { mensagemDoContato, TITULO_PAGAMENTO } from "@/site/pagamento-vista";
import { carregarSite, metadadosDoSite } from "@/site/pagina";

export const generateMetadata = () => metadadosDoSite("Cotação");

/** Situações em que falar com a equipe é o caminho principal (não há Pix a pagar). */
const CONTATO_PRINCIPAL = new Set(["pix_esgotado", "aprovado_sem_datas", "devolucao_pedida", "devolvido"]);
/** Situações que mostram o aceite das páginas legais (M7.4): a caixa antes do Pix, ou o aceite da reserva confirmada. */
const COM_ACEITE = new Set(["pagar", "pix_vencido", "confirmada"]);

/**
 * Página pública da cotação (M8.1): sempre revalidada ao abrir; nada é gravado só por visitar. Com o pagamento no
 * site (M8.2a), a situação do pagamento vence a da cotação ("expirada", "cancelada") e o Pix vem primeiro.
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
  // M7.4: o aceite das páginas legais (caixa no "Gerar Pix", ou as versões aceitas na reserva confirmada) e, no
  // formulário de segurar as datas, o link da Política de privacidade em vigor.
  const aceite = pagamento && COM_ACEITE.has(pagamento.estado) ? await aceiteParaPagina(db, organizacaoId, { id: c.id, checkin: c.checkin, fuso: c.fuso, reservaId: c.reservaId }, agora) : null;
  const mostraFormulario = vista.estado === "aberta" && !vista.mudou;
  const privacidade = mostraFormulario ? ((await versoesLegaisAtuais(db, organizacaoId))?.privacidade ?? null) : null;
  const { textos } = conteudo;
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
          formulario={
            mostraFormulario ? <FormSegurar codigo={codigo} minutos={regras.site.minutosHold} acao={segurarDatasAcao} comPagamento={pagamentoNoSite} privacidade={privacidade} /> : null
          }
          pagamento={
            pagamento && pagamento.estado !== "sem_pagamento"
              ? {
                  titulo: TITULO_PAGAMENTO[pagamento.estado],
                  conteudo: (
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
                      }}
                      contato={
                        conteudo.whatsapp || conteudo.email ? (
                          <BotaoContato
                            whatsapp={conteudo.whatsapp}
                            email={conteudo.email}
                            codigo={c.codigo}
                            texto={mensagemDoContato(textoDaCotacao(vista), pagamento.estado, pagamento.reservaCodigo)}
                            secundario={!CONTATO_PRINCIPAL.has(pagamento.estado)}
                          />
                        ) : null
                      }
                      gerarPix={gerarPixAcao.bind(null, codigo)}
                      continuar={continuarPagamentoAcao}
                      aceite={aceite}
                    />
                  ),
                }
              : undefined
          }
        />
      </div>
    </Moldura>
  );
}
