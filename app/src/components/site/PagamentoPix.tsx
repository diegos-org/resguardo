"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useActionState, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import { dataNoFuso, diaHoraNoFuso, horaNoFuso, rotuloDoFuso } from "@/lib/datas";
import type { AceiteNaPagina } from "@/site/aceites";
import type { EstadoCartao, EstadoContinuar, EstadoPix } from "@/site/acoes-pagamento";
import { MENSAGEM_CARTAO_RECUSADO, MENSAGEM_VERIFICACAO_NAO_CONCLUIDA, NOTA_JUROS_CARTAO } from "@/site/mensagens-cartao";
import { deveAcompanhar, ESTADOS_COM_DINHEIRO, type EstadoPagamentoHospede, type PagamentoDoHospede, type TextosDoCancelamento, textoDoCancelamento } from "@/site/pagamento-vista";
import { LinkNovaJanela } from "./Acessibilidade";
import { AceiteFeito, BlocoAceite } from "./BlocoAceite";
import { DesafioCartao } from "./DesafioCartao";
import { type BloqueioDaRecarga, PagamentoCartao, type TravaRecarga } from "./PagamentoCartao";
import styles from "./site.module.css";

/** A página consulta a situação a cada 5 s enquanto espera; depois de um "muitas consultas", espera 1 minuto. */
export const INTERVALO_ACOMPANHAMENTO_MS = 5_000;
export const ESPERA_DEPOIS_DO_LIMITE_MS = 60_000;

type AcaoPix = (estado: EstadoPix, form: FormData) => Promise<EstadoPix>;
type AcaoContinuar = (estado: EstadoContinuar, form: FormData) => Promise<EstadoContinuar>;
type AcaoCartao = (form: FormData) => Promise<EstadoCartao>;

/**
 * Textos editáveis do pagamento (Configurações → Site). `cancelamento` (M8.2c): as frases da reserva cancelada pela
 * política e do pedido de cancelamento recebido; sem elas, a página mostra só os fatos do cancelamento.
 */
/**
 * `emConferencia` (M8.2e): a frase de Textos do site da reserva confirmada com o pagamento em disputa (vazia = a linha não
 * aparece); só aparece com a marca da vista, que vem só com o cookie de quem pagou.
 */
export type TextosPagamento = { convite: string; aguardando: string; semDatas: string; cartaoAnalise: string; cancelamento?: TextosDoCancelamento; emConferencia?: string };

const brl = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dia = (iso: string, fuso: string) => dataNoFuso(new Date(iso), fuso);

/** O que a rota de acompanhamento devolve (só os campos que a página lê). */
type RespostaDaRota = {
  estado?: EstadoPagamentoHospede;
  podeGerar?: boolean;
  podePagarCartao?: boolean;
  acompanhar?: boolean;
  alteracao?: { id?: string; situacao?: string; pagamento?: { estado?: EstadoPagamentoHospede; podeGerar?: boolean; podePagarCartao?: boolean; acompanhar?: boolean } | null } | null;
};

/**
 * Da resposta da rota, o pagamento que esta caixa acompanha: o da cotação, ou (M8.2d) o da diferença da alteração
 * `alteracaoId`. null = a alteração não está mais segurada com a diferença a pagar (aplicada, vencida, outra): a página
 * recarrega para mostrar o que vale agora.
 */
function pagamentoDaResposta(j: RespostaDaRota, alteracaoId: string | null): Omit<RespostaDaRota, "alteracao"> | null {
  if (!alteracaoId) return j;
  const a = j.alteracao;
  return a && a.id === alteracaoId && a.situacao === "segurada" && a.pagamento?.estado ? a.pagamento : null;
}

/**
 * Acompanha o pagamento (M8.2a): enquanto a situação é de espera, consulta a rota da cotação a cada 5 s (a primeira
 * logo ao abrir, para a página conferir quem volta pelo link), pausa com a aba escondida e volta quando ela aparece.
 * Mudou a situação, o "pode gerar outro Pix" ou o "pode pagar com cartão" (ex.: as travas voltaram depois de uma falha
 * passageira): recarrega a página (o servidor mostra o que vale agora). Uma resposta sem um dos dois campos conta como
 * sem mudança nele. Para quando a situação não é de espera e nenhuma tentativa ainda pode virar dinheiro (`acompanhar`,
 * ex.: os 3 Pix gastos e o último recusado há pouco: continua até o prazo da leitura).
 *
 * `adiarRecarga` (M8.2b): com o formulário do cartão aberto, uma mudança que não seja dinheiro fica para quando ele
 * fechar (devolve true quando adiou); dinheiro (confirmando, confirmada…) recarrega na hora.
 *
 * `alteracaoId` (M8.2d): acompanha o pagamento da diferença dessa alteração (a mesma rota, o campo `alteracao`); a
 * alteração deixou de estar segurada (aplicada pelo pagamento, vencida, desistida): recarrega na hora e para.
 */
export function useAcompanharPagamento(
  codigo: string,
  estado: EstadoPagamentoHospede,
  ofertas: { podeGerar: boolean; podePagarCartao: boolean },
  ativo: boolean,
  adiarRecarga?: () => boolean,
  alteracaoId: string | null = null,
) {
  const router = useRouter();
  const { podeGerar, podePagarCartao } = ofertas;
  useEffect(() => {
    if (!ativo) return;
    let parado = false;
    let consultando = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Começa do que a página mostra.
    const assinatura = (e: string, g: boolean, c: boolean) => `${e}|${g}|${c}`;
    let ultimo = assinatura(estado, podeGerar, podePagarCartao);
    let ultimoPodeGerar = podeGerar;
    let ultimoPodeCartao = podePagarCartao;
    const escondida = () => document.visibilityState === "hidden";
    const agendar = (ms: number) => {
      if (parado || timer || escondida()) return;
      timer = setTimeout(consultar, ms);
    };
    async function consultar() {
      timer = null;
      if (parado || consultando || escondida()) return;
      consultando = true;
      let proxima = INTERVALO_ACOMPANHAMENTO_MS;
      try {
        const r = await fetch(`/reservar/${encodeURIComponent(codigo)}/pagamento`, { cache: "no-store", headers: { accept: "application/json" } });
        if (r.status === 429) proxima = ESPERA_DEPOIS_DO_LIMITE_MS;
        else if (r.ok) {
          const resposta = (await r.json()) as RespostaDaRota;
          const j: Omit<RespostaDaRota, "alteracao"> | null = resposta.estado ? pagamentoDaResposta(resposta, alteracaoId) : {};
          if (parado) {
            // Desmontou no meio da consulta: nada a fazer.
          } else if (j === null) {
            // A alteração mudou (o pagamento da diferença a aplicou, o prazo passou): a página mostra o que vale agora.
            parado = true;
            router.refresh();
          } else if (j.estado) {
            const gerar = typeof j.podeGerar === "boolean" ? j.podeGerar : ultimoPodeGerar;
            const cartao = typeof j.podePagarCartao === "boolean" ? j.podePagarCartao : ultimoPodeCartao;
            if (!deveAcompanhar({ estado: j.estado, acompanhar: j.acompanhar })) parado = true;
            if (assinatura(j.estado, gerar, cartao) !== ultimo) {
              ultimo = assinatura(j.estado, gerar, cartao);
              ultimoPodeGerar = gerar;
              ultimoPodeCartao = cartao;
              if (ESTADOS_COM_DINHEIRO.includes(j.estado) || !adiarRecarga?.()) router.refresh();
            }
          }
        }
      } catch {
        // Sem rede: tenta de novo na próxima volta.
      } finally {
        consultando = false;
      }
      agendar(proxima);
    }
    const aoMudarVisibilidade = () => {
      if (!escondida()) return agendar(0);
      if (timer) clearTimeout(timer);
      timer = null;
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    agendar(0);
    return () => {
      parado = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [codigo, estado, podeGerar, podePagarCartao, ativo, router, adiarRecarga, alteracaoId]);
}

/**
 * A trava da recarga automática (M8.2b): o formulário do cartão trava ao abrir e destrava ao fechar; o acompanhamento
 * pergunta (`adiar`) antes de recarregar. Recarga adiada acontece no destravar.
 */
function useTravaDeRecarga(): { bloqueio: BloqueioDaRecarga; adiar: () => boolean } {
  const router = useRouter();
  const trava = useRef<TravaRecarga>({ ativa: false, pendente: false });
  const adiar = useCallback(() => {
    if (!trava.current.ativa) return false;
    trava.current.pendente = true;
    return true;
  }, []);
  const bloqueio = useMemo<BloqueioDaRecarga>(
    () => ({
      travar: () => {
        trava.current.ativa = true;
      },
      destravar: () => {
        trava.current.ativa = false;
        if (!trava.current.pendente) return;
        trava.current.pendente = false;
        router.refresh();
      },
    }),
    [router],
  );
  return { bloqueio, adiar };
}

const assinarRelogio = (aviso: () => void) => {
  const t = setInterval(aviso, 1000);
  return () => clearInterval(t);
};
const segundoAtual = () => Math.floor(Date.now() / 1000);
const semRelogio = () => null;

/** Contagem até o fim do Pix (só no navegador: no servidor, só a hora). Venceu: recarrega a página uma vez. */
function Contagem({ ate }: { ate: string }) {
  const router = useRouter();
  const segundo = useSyncExternalStore(assinarRelogio, segundoAtual, semRelogio);
  const restante = segundo === null ? null : Math.ceil(Date.parse(ate) / 1000) - segundo;
  const venceu = restante !== null && restante <= 0;
  const recarregou = useRef(false);
  useEffect(() => {
    if (!venceu || recarregou.current) return;
    recarregou.current = true;
    router.refresh();
  }, [venceu, router]);
  if (restante === null) return null;
  if (venceu) return <> · venceu</>;
  return (
    <>
      {" "}
      (faltam {Math.floor(restante / 60)}:{String(restante % 60).padStart(2, "0")})
    </>
  );
}

/**
 * "Gerar Pix". Enquanto a cotação não tem o aceite das versões em vigor das páginas legais (M7.4), o formulário leva a
 * caixa de aceite (resumo da política, prazo desta reserva, a caixa obrigatória e as versões); já aceitas, só a linha
 * do aceite feito. Quem confere é o servidor, na mesma transação do Pix.
 */
function GerarPix({ acao, rotulo, aceite, fuso, alteracaoId }: { acao: AcaoPix; rotulo: string; aceite: AceiteNaPagina | null; fuso: string; alteracaoId: string | null }) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  return (
    <form action={enviar} className={styles.pixAcao}>
      {/* M8.2d: o Pix da diferença leva a alteração; quem confere se ela ainda está segurada é o servidor. */}
      {alteracaoId && <input type="hidden" name="alteracao" value={alteracaoId} />}
      {aceite && (aceite.aceito ? <AceiteFeito aceito={aceite.aceito} fuso={fuso} /> : <BlocoAceite aceite={aceite} fuso={fuso} />)}
      <button type="submit" className={styles.botao} disabled={enviando}>
        {enviando ? "Gerando o Pix…" : rotulo}
      </button>
      {estado.erro && (
        <p role="alert" className={styles.aviso}>
          {estado.erro}
        </p>
      )}
    </form>
  );
}

/** "Continuar o pagamento" noutro aparelho: o e-mail usado ao segurar as datas. O e-mail digitado fica no navegador. */
function ContinuarPagamento({ codigo, acao }: { codigo: string; acao: AcaoContinuar }) {
  const [estado, enviar, enviando] = useActionState(async (_a: EstadoContinuar & { email?: string }, f: FormData): Promise<EstadoContinuar & { email?: string }> => {
    // O estado anterior não volta ao servidor; o e-mail digitado fica só aqui.
    const r = await acao({}, f);
    return { ...r, email: r.ok ? "" : String(f.get("email") ?? "") };
  }, {} as EstadoContinuar & { email?: string });
  return (
    <form action={enviar} className={styles.formulario} aria-label="Continuar o pagamento">
      <strong>Continuar o pagamento</strong>
      <p className={styles.miudo} style={{ margin: 0 }}>
        Para pagar neste aparelho, informe o e-mail usado ao segurar as datas.
      </p>
      <input type="hidden" name="codigo" value={codigo} />
      <label>
        E-mail
        <input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={estado.email ?? ""} />
      </label>
      {estado.erro && (
        <p role="alert" className={styles.aviso}>
          {estado.erro}
        </p>
      )}
      <button type="submit" className={styles.botao} disabled={enviando}>
        {enviando ? "Conferindo…" : "Continuar o pagamento"}
      </button>
    </form>
  );
}

function QrDoPix({ pix }: { pix: NonNullable<PagamentoDoHospede["pix"]> }) {
  if (pix.imagem) {
    return (
      <div className={styles.pixQr}>
        {/* QR em data: (gerado pelo Mercado Pago, sem arquivo para otimizar). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pix.imagem} alt="QR code do Pix" width={220} height={220} />
      </div>
    );
  }
  if (pix.link) {
    return (
      <p className={styles.pixQr}>
        <LinkNovaJanela href={pix.link} className={`${styles.botao} ${styles.botaoContorno}`}>
          Abrir o Pix no Mercado Pago
        </LinkNovaJanela>
      </p>
    );
  }
  return null;
}

/** Pix aguardando, com a autorização: copia e cola primeiro (no celular), o QR, o prazo e "pode fechar e voltar". */
function PixAguardando({ pix, textos, fuso, total, rotuloValor }: { pix: NonNullable<PagamentoDoHospede["pix"]>; textos: TextosPagamento; fuso: string; total: number; rotuloValor: string }) {
  return (
    <>
      <p className={styles.texto}>{textos.aguardando}</p>
      <p className={styles.pixValor}>
        {rotuloValor} <strong>{brl(total)}</strong>
      </p>
      <div className={styles.pixCodigos}>
        <div className={styles.pixCopia}>
          <span className={styles.pixRotulo} id="pix-copia-e-cola">
            Pix copia e cola
          </span>
          <p className={styles.pixCodigo} aria-labelledby="pix-copia-e-cola">
            {pix.copiaECola}
          </p>
          <BotaoCopiar texto={pix.copiaECola} rotulo="Copiar o código do Pix" className={styles.botao} />
        </div>
        <QrDoPix pix={pix} />
      </div>
      {pix.expiraEm && (
        <p className={styles.texto}>
          Este Pix vale até <strong>{horaNoFuso(new Date(pix.expiraEm), fuso)}</strong>
          <Contagem ate={pix.expiraEm} />.
        </p>
      )}
      <p className={styles.miudo}>Pode fechar e voltar por este link: a página confirma sozinha quando o pagamento chegar.</p>
    </>
  );
}

/**
 * As formas de pagar oferecidas agora (M8.2b). As duas: a escolha "Pix (recomendado)" | "Cartão de crédito", com o Pix
 * marcado e em destaque, e a nota dos juros junto do cartão; só uma: ela direto (o cartão com a nota).
 */
function FormasDePagamento({ pix, cartao }: { pix: ReactNode | null; cartao: ((irParaPix?: () => void) => ReactNode) | null }) {
  const [forma, setForma] = useState<"pix" | "cartao">("pix");
  if (pix && cartao) {
    return (
      <>
        <fieldset className={styles.formasPagamento}>
          <legend>Como pagar</legend>
          <label className={`${styles.formaPagamento} ${styles.formaRecomendada}`}>
            <input type="radio" name="formaPagamento" value="pix" checked={forma === "pix"} onChange={() => setForma("pix")} />
            <span>Pix (recomendado)</span>
          </label>
          <label className={styles.formaPagamento}>
            <input type="radio" name="formaPagamento" value="cartao" checked={forma === "cartao"} onChange={() => setForma("cartao")} />
            <span>
              Cartão de crédito
              <small className={styles.miudo}>{NOTA_JUROS_CARTAO}</small>
            </span>
          </label>
        </fieldset>
        {forma === "pix" ? pix : cartao(() => setForma("pix"))}
      </>
    );
  }
  if (cartao) {
    return (
      <>
        <p className={styles.miudo}>{NOTA_JUROS_CARTAO}</p>
        {cartao()}
      </>
    );
  }
  return <>{pix}</>;
}

/** Pix aguardando com o cartão também oferecido: "Prefere pagar com cartão?" troca o QR pelo formulário (e volta). */
function PixOuCartao({ pix, cartao, dif = false }: { pix: ReactNode; cartao: ((irParaPix?: () => void) => ReactNode) | null; dif?: boolean }) {
  const [comCartao, setComCartao] = useState(false);
  if (!cartao) return <>{pix}</>;
  if (!comCartao) {
    return (
      <>
        {pix}
        <p>
          <button type="button" className={styles.linkBotao} onClick={() => setComCartao(true)}>
            Prefere pagar com cartão?
          </button>
        </p>
      </>
    );
  }
  return (
    <>
      <p className={styles.miudo}>Ao pagar com cartão, o Pix {dif ? "da diferença" : "desta cotação"} é cancelado. {NOTA_JUROS_CARTAO}</p>
      {cartao(() => setComCartao(false))}
      <p>
        <button type="button" className={styles.linkBotao} onClick={() => setComCartao(false)}>
          Voltar ao Pix
        </button>
      </p>
    </>
  );
}

/** Desafio do banco com os outros caminhos: "Pagar com Pix" e "Usar outro cartão" trocam o quadro pelo formulário. */
function DesafioOuOutro({ codigo, desafioUrl, pix, cartao }: { codigo: string; desafioUrl: string | null; pix: ReactNode | null; cartao: ((irParaPix?: () => void) => ReactNode) | null }) {
  const [outro, setOutro] = useState<"pix" | "cartao" | null>(null);
  if (outro === null) {
    return <DesafioCartao codigo={codigo} desafioUrl={desafioUrl} aoPagarComPix={pix ? () => setOutro("pix") : undefined} aoUsarOutroCartao={cartao ? () => setOutro("cartao") : undefined} />;
  }
  return (
    <>
      <p className={styles.miudo}>A verificação do banco em andamento é cancelada antes do novo pagamento.{outro === "cartao" ? ` ${NOTA_JUROS_CARTAO}` : ""}</p>
      {outro === "pix" ? pix : cartao?.(pix ? () => setOutro("pix") : undefined)}
      {desafioUrl && (
        <p>
          <button type="button" className={styles.linkBotao} onClick={() => setOutro(null)}>
            Voltar à verificação do banco
          </button>
        </p>
      )}
    </>
  );
}

/**
 * O pagamento na página da cotação (M8.2a; cartão no M8.2b, design "O que o hóspede vê"): convite com a escolha entre
 * Pix e cartão de crédito (o Pix em destaque), Pix aguardando (copia e cola, QR, prazo; "prefere pagar com cartão?"),
 * vencido, esgotado, desafio do banco, cartão em análise, cartão recusado (sempre o mesmo texto), conferindo, recebido,
 * confirmado, sem as datas e devolução. Cada texto diz só as formas que estão disponíveis agora. Sem a autorização do
 * pedido (cookie), mostra só a situação e "Continuar o pagamento". O servidor decide tudo; aqui só se mostra e se
 * acompanha. `contato` é o botão para falar com a equipe (opção secundária). `aceite` (M7.4): as páginas legais em vigor
 * e o aceite que vale nesta cotação (a caixa antes do Pix ou do formulário do cartão; na reserva confirmada, as versões
 * aceitas e o prazo do reembolso); null quando as três não estão publicadas. `linhaAnalise`: a linha fixa do cartão em
 * análise (com a hora, montada no servidor).
 *
 * `alteracaoId` (M8.2d): a mesma caixa para o pagamento da diferença de uma alteração segurada (`pagamento` é o da
 * diferença e `total`, a diferença): o Pix e o cartão levam a alteração, os textos falam da diferença e das novas datas, e
 * o acompanhamento lê o pagamento da alteração na rota. Sem convite editável (`textos.convite` vazio), o parágrafo não
 * aparece: a linha da alteração acima já diz o que fazer. As situações de depois do pagamento (confirmada, cancelada,
 * devolução) não são da diferença: quem conta é a alteração.
 */
export function PagamentoPix({
  codigo,
  pagamento: v,
  autorizado,
  fuso,
  total,
  textos,
  contato,
  gerarPix,
  continuar,
  pagarComCartao,
  aceite = null,
  linhaAnalise = null,
  alteracaoId = null,
}: {
  codigo: string;
  pagamento: PagamentoDoHospede;
  autorizado: boolean;
  fuso: string;
  total: number;
  textos: TextosPagamento;
  contato: ReactNode;
  gerarPix: AcaoPix;
  continuar: AcaoContinuar;
  pagarComCartao?: AcaoCartao;
  aceite?: AceiteNaPagina | null;
  linhaAnalise?: string | null;
  alteracaoId?: string | null;
}) {
  const { bloqueio, adiar } = useTravaDeRecarga();
  // Cada caixa acompanha só o próprio pagamento (a da cotação não olha a diferença da alteração, que tem a dela).
  useAcompanharPagamento(codigo, v.estado, { podeGerar: v.podeGerar, podePagarCartao: v.podePagarCartao }, deveAcompanhar({ estado: v.estado, acompanhar: v.acompanhar }), adiar, alteracaoId);
  const dif = alteracaoId !== null;
  // Os textos da diferença (M8.2d): as novas datas, a alteração a confirmar.
  const asDatas = dif ? "as novas datas" : "as datas";
  const AsDatas = dif ? "As novas datas" : "As datas";
  const paraConcluir = dif ? "para confirmar a alteração" : "para reservar";
  const desta = dif ? "da diferença" : "desta cotação";
  const rotuloValor = dif ? "Diferença a pagar:" : "Valor:";
  // O cancelamento pela política (ou o pedido de cancelamento recebido): o compositor único dos textos, no fuso do imóvel.
  const cancelamento = textos.cancelamento ? textoDoCancelamento(v, textos.cancelamento, fuso) : { linhas: [], decisao: "", comoVolta: null };
  const prazo = v.holdAte ? (
    <p className={styles.texto}>
      {AsDatas} estão seguradas para você até <strong>{diaHoraNoFuso(new Date(v.holdAte), fuso)}</strong> ({rotuloDoFuso(fuso)}).
    </p>
  ) : null;
  const outraOpcao = contato ? (
    <div className={styles.pixOutraOpcao}>
      <span className={styles.miudo}>Prefere combinar com a equipe?</span>
      {contato}
    </div>
  ) : null;
  const continuarAqui = <ContinuarPagamento codigo={codigo} acao={continuar} />;
  // Formas disponíveis agora (para os textos) e os formulários (só com o cookie do pedido).
  const temPix = v.podeGerar;
  const temCartao = v.podePagarCartao;
  const dados = v.cartao;
  const cartao =
    autorizado && temCartao && dados && pagarComCartao
      ? (irParaPix?: () => void) => (
          <PagamentoCartao
            codigo={codigo}
            alteracaoId={alteracaoId}
            chavePublica={dados.chavePublica}
            valor={dados.valor}
            parcelasMaximas={dados.parcelasMaximas}
            emailTeste={dados.emailTeste}
            aceite={aceite}
            fuso={fuso}
            acao={pagarComCartao}
            bloqueio={bloqueio}
            oferecerPix={irParaPix}
          />
        )
      : null;
  const pix = (rotulo: string) => (autorizado && temPix ? <GerarPix acao={gerarPix} rotulo={rotulo} aceite={aceite} fuso={fuso} alteracaoId={alteracaoId} /> : null);
  const formas = (rotulo: string) => (autorizado ? <FormasDePagamento pix={pix(rotulo)} cartao={cartao} /> : continuarAqui);
  const secao = (filhos: ReactNode, o: { classe?: string; aoVivo?: boolean } = {}) => (
    <section className={o.classe ? `${styles.pix} ${o.classe}` : styles.pix} aria-label={dif ? "Pagamento da diferença" : "Pagamento"} aria-live={o.aoVivo ? "polite" : undefined}>
      {filhos}
    </section>
  );

  switch (v.estado) {
    case "pagar":
      return secao(
        <>
          <h3>{dif ? (temPix && temCartao ? "Pagar a diferença" : temCartao ? "Pague a diferença com cartão de crédito" : "Pague a diferença com Pix") : temPix && temCartao ? "Pagamento" : temCartao ? "Pague com cartão de crédito" : "Pague com Pix"}</h3>
          {textos.convite && <p className={styles.texto}>{textos.convite}</p>}
          <p className={styles.pixValor}>
            {rotuloValor} <strong>{brl(total)}</strong>
          </p>
          {prazo}
          {formas("Gerar Pix")}
          {outraOpcao}
        </>,
      );
    case "pix_aguardando":
      return secao(
        <>
          <h3>{dif ? "Pix da diferença gerado" : "Pix gerado"}</h3>
          {autorizado && v.pix ? (
            <PixOuCartao pix={<PixAguardando pix={v.pix} textos={textos} fuso={fuso} total={total} rotuloValor={rotuloValor} />} cartao={cartao} dif={dif} />
          ) : (
            <>
              <p className={styles.texto}>Há um Pix {desta} aguardando pagamento. A página atualiza sozinha quando o pagamento chegar.</p>
              {prazo}
              {!autorizado && continuarAqui}
            </>
          )}
          {outraOpcao}
        </>,
      );
    case "pix_vencido":
      return secao(
        <>
          <h3>O Pix venceu</h3>
          {temPix || temCartao ? (
            <>
              <p className={styles.texto}>
                {temPix && temCartao
                  ? `O Pix venceu sem pagamento, mas ${asDatas} continuam seguradas. Gere outro Pix${v.pixRestantes > 0 ? ` (ainda dá para gerar ${v.pixRestantes})` : ""} ou pague com cartão de crédito.`
                  : temPix
                    ? `O Pix venceu sem pagamento, mas ${asDatas} continuam seguradas. Gere outro para pagar${v.pixRestantes > 0 ? ` (ainda dá para gerar ${v.pixRestantes})` : ""}.`
                    : "O Pix venceu sem pagamento. Você pode pagar com cartão de crédito."}
              </p>
              {prazo}
              {formas("Gerar outro Pix")}
              {outraOpcao}
            </>
          ) : (
            <>
              <p className={styles.texto}>O Pix venceu sem pagamento, e o pagamento pelo site não está disponível agora. {AsDatas} continuam seguradas: {paraConcluir}, fale com a equipe.</p>
              {prazo}
              {contato}
            </>
          )}
        </>,
      );
    case "pix_esgotado":
      if (temCartao) {
        return secao(
          <>
            <p className={styles.texto}>{dif ? "O pagamento da diferença já gerou o máximo de Pix." : "Esta cotação já gerou o máximo de Pix."} Você ainda pode pagar com cartão de crédito.</p>
            {prazo}
            {formas("Gerar Pix")}
            {outraOpcao}
          </>,
        );
      }
      return secao(
        <>
          <p className={styles.texto}>{dif ? "O pagamento da diferença já gerou o máximo de Pix sem pagamento. Para confirmar a alteração, fale com a equipe." : "Esta cotação já gerou o máximo de Pix sem pagamento. Para reservar, fale com a equipe."}</p>
          {prazo}
          {contato}
        </>,
        { classe: styles.pixAtencao },
      );
    case "cartao_recusado":
      return secao(
        <>
          <h3>Pagamento não aprovado</h3>
          <p className={styles.texto}>{v.recusa === "verificacao" ? MENSAGEM_VERIFICACAO_NAO_CONCLUIDA : MENSAGEM_CARTAO_RECUSADO}</p>
          {prazo}
          {temPix || temCartao ? (
            <>
              {formas("Gerar Pix")}
              {outraOpcao}
            </>
          ) : (
            <>
              <p className={styles.texto}>O pagamento pelo site não está disponível agora. {AsDatas} continuam seguradas: {paraConcluir}, fale com a equipe.</p>
              {contato}
            </>
          )}
        </>,
        { classe: styles.pixAtencao },
      );
    case "cartao_desafio":
      return secao(
        <>
          {autorizado ? (
            <DesafioOuOutro codigo={codigo} desafioUrl={v.desafioUrl} pix={pix("Gerar Pix")} cartao={cartao} />
          ) : (
            <>
              <p className={styles.texto}>Há um pagamento com cartão {desta} aguardando a verificação do banco. A página atualiza sozinha quando ela terminar.</p>
              {prazo}
              {continuarAqui}
            </>
          )}
          {outraOpcao}
        </>,
      );
    case "cartao_em_analise":
      return secao(
        <>
          <p className={styles.texto}>{textos.cartaoAnalise}</p>
          {linhaAnalise && <p className={styles.texto}>{linhaAnalise}</p>}
          {contato}
        </>,
        { aoVivo: true },
      );
    case "verificando":
      return secao(
        <>
          <p className={styles.texto}>Estamos conferindo o pagamento com o Mercado Pago. A página atualiza sozinha; pode fechar e voltar por este link.</p>
          {outraOpcao}
        </>,
        { aoVivo: true },
      );
    case "confirmando":
      return secao(
        <p className={styles.texto}>
          <strong>{dif ? "Pagamento da diferença recebido, confirmando a alteração." : "Pagamento recebido, confirmando sua reserva."}</strong> A página atualiza sozinha em instantes.
        </p>,
        { classe: styles.pixOk, aoVivo: true },
      );
    case "confirmada":
      if (dif) return null;
      return secao(
        <>
          <p className={styles.texto}>
            <strong>Pagamento aprovado: reserva {v.reservaCodigo ?? ""} confirmada.</strong>
          </p>
          <p className={styles.texto}>Guarde este link. Os detalhes da estadia ficam em Minha reserva, com o e-mail usado ao segurar as datas.</p>
          {aceite?.aceito && <AceiteFeito aceito={aceite.aceito} fuso={fuso} prazo={aceite.prazo} />}
          {v.pagamentoEmDobro && <p className={styles.aviso}>Recebemos mais de um pagamento desta cotação: a equipe vai devolver o valor pago a mais.</p>}
          {/* M8.2e: pagamento em disputa (só com o cookie de quem pagou; a frase editável pode ficar vazia). */}
          {v.pagamentoEmConferencia && textos.emConferencia && (
            <p className={styles.aviso} role="note">
              {textos.emConferencia}
            </p>
          )}
          {/* M8.2c: pedido de cancelamento recebido, ainda sem decisão (a reserva continua confirmada). */}
          {cancelamento.linhas.length > 0 && (
            <div className={styles.aviso} role="note">
              {cancelamento.linhas.map((l) => (
                <p key={l} style={{ margin: 0 }}>
                  {l}
                </p>
              ))}
              <p style={{ margin: 0 }}>
                Acompanhe ou peça pelo seu acesso: <a href="/hospede">Minha reserva</a>.
              </p>
            </div>
          )}
          <p>
            <a href="/hospede" className={styles.botao}>
              Minha reserva
            </a>
          </p>
        </>,
        { classe: styles.pixOk, aoVivo: true },
      );
    // M8.2c: a reserva paga pelo site foi cancelada pela política. Os fatos (código, datas, valores, versão) vêm do
    // servidor; as frases, de Textos do site. Nunca oferece outra forma de pagar.
    case "cancelada_devolucao_pedida":
    case "cancelada_devolvida":
    case "cancelada_com_a_equipe":
    case "cancelada_em_conferencia":
    case "cancelada_sem_devolucao":
      if (dif) return null;
      return secao(
        <>
          {cancelamento.linhas.map((l, i) => (
            <p key={l} className={styles.texto}>
              {i === 0 ? <strong>{l}</strong> : l}
            </p>
          ))}
          {contato}
        </>,
        { classe: v.estado === "cancelada_devolvida" || v.estado === "cancelada_sem_devolucao" ? undefined : styles.pixAtencao },
      );
    case "aprovado_sem_datas":
      if (dif) return null;
      return secao(
        <>
          <p className={styles.texto}>{textos.semDatas}</p>
          {contato}
        </>,
        { classe: styles.pixAtencao },
      );
    case "devolucao_pedida":
      if (dif) return null;
      return secao(
        <>
          <p className={styles.texto}>
            Pedimos a devolução do valor integral ao Mercado Pago{v.devolucao?.em ? ` em ${dia(v.devolucao.em, fuso)}` : ""}. Ela pode levar alguns dias para aparecer na sua conta.
          </p>
          {contato}
        </>,
        { classe: styles.pixAtencao },
      );
    case "devolvido":
      if (dif) return null;
      return secao(
        <>
          <p className={styles.texto}>O valor do pagamento foi devolvido{v.devolucao?.em ? ` em ${dia(v.devolucao.em, fuso)}` : ""}.</p>
          {contato}
        </>,
      );
    default:
      return null;
  }
}
