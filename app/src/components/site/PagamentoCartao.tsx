"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";
import { CAMPOS_VERSAO, DOCUMENTOS_LEGAIS, type VersoesLegais } from "@/configuracoes/paginas-legais-texto";
import type { AceiteNaPagina } from "@/site/aceites";
import type { EstadoCartao } from "@/site/acoes-pagamento";
import {
  LINHA_MERCADO_PAGO,
  MENSAGEM_ACEITE_PENDENTE_CARTAO,
  MENSAGEM_CARTAO_INCERTO,
  MENSAGEM_FORMULARIO_FALHOU,
  MENSAGEM_PROVEDOR_CARTAO,
  MENSAGEM_SO_CREDITO,
} from "@/site/mensagens-cartao";
import { AceiteFeito, BlocoAceite } from "./BlocoAceite";
import {
  carregarSdkMercadoPago,
  type ControleDoFormulario,
  type DadosAdicionaisCartao,
  type DadosDoFormularioCartao,
  type ErroDoFormulario,
  idDoAparelho,
} from "./sdk-mercadopago";
import styles from "./site.module.css";

type AcaoCartao = (form: FormData) => Promise<EstadoCartao>;

/**
 * Trava da recarga automática da página (M8.2b): enquanto o formulário do cartão está aberto (ou um envio está no meio),
 * o acompanhamento não recarrega a página por uma mudança que não seja dinheiro — guarda a recarga e a faz quando o
 * formulário fecha (o hóspede nunca perde o que digitou por uma consulta de rotina). Quem acompanha é dono da trava;
 * o formulário só avisa quando abre (`travar`) e quando fecha (`destravar`).
 */
export type TravaRecarga = { ativa: boolean; pendente: boolean };
export type BloqueioDaRecarga = { travar: () => void; destravar: () => void };

/** Só crédito (débito e pré-pago ficam de fora); o servidor confere de novo (`so_credito`). */
export const TIPOS_EXCLUIDOS_CARTAO = ["debit_card", "prepaid_card"] as const;
const CAUSA = /^[a-z_]{1,60}$/;
const texto = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * O que vai ao servidor no envio do cartão: só o token (o número do cartão nunca), a bandeira, o tipo, as parcelas, o
 * documento (repassado ao Mercado Pago, nunca guardado), o id do aparelho quando o SDK o deu, e o aceite com as versões
 * que a página mostrou (só quando o aceite ainda estava pendente e a caixa foi marcada). E-mail, valor, emissor, BIN,
 * últimos dígitos e titular ficam de fora, nem que o formulário os entregue. M8.2d: no pagamento da diferença, o id da
 * alteração (`alteracao`; quem confere é o servidor).
 */
export function formularioDoCartao(dados: DadosDoFormularioCartao, tipo: unknown, extra: { dispositivo: unknown; aceite: VersoesLegais | null; alteracaoId?: string | null }): FormData {
  const f = new FormData();
  f.set("token", texto(dados?.token));
  f.set("bandeira", texto(dados?.payment_method_id));
  f.set("tipo", texto(tipo));
  f.set("parcelas", typeof dados?.installments === "number" && Number.isInteger(dados.installments) ? String(dados.installments) : "");
  const id = dados?.payer?.identification;
  if (id && typeof id.type === "string" && typeof id.number === "string" && id.type && id.number) {
    f.set("documentoTipo", id.type);
    f.set("documentoNumero", id.number);
  }
  if (typeof extra.dispositivo === "string" && extra.dispositivo) f.set("dispositivo", extra.dispositivo);
  if (extra.aceite) {
    f.set("aceite", "sim");
    for (const doc of DOCUMENTOS_LEGAIS) f.set(CAMPOS_VERSAO[doc], String(extra.aceite[doc]));
  }
  if (extra.alteracaoId) f.set("alteracao", extra.alteracaoId);
  return f;
}

type Props = {
  codigo: string;
  /** M8.2d: o pagamento da diferença desta alteração (o formulário leva o id; `valor` é a diferença). */
  alteracaoId?: string | null;
  chavePublica: string;
  /** Total da cotação, em centavos (o que o servidor cobra; os juros das parcelas o formulário mostra por cima). */
  valor: number;
  parcelasMaximas: number | null;
  emailTeste: string | null;
  /** As páginas legais em vigor e o aceite desta cotação (null = não publicadas: o servidor recusa). */
  aceite: AceiteNaPagina | null;
  fuso: string;
  acao: AcaoCartao;
  bloqueio?: BloqueioDaRecarga;
  /** Quando há Pix: o botão "Pagar com Pix" na falha do formulário. */
  oferecerPix?: () => void;
};

/**
 * O pagamento com cartão de crédito na página da cotação (M8.2b), pelo formulário do Mercado Pago ("Card Payment
 * Brick"): o número do cartão é digitado nele e vira um token de uso único; aqui só passa o token. Com o aceite das
 * páginas legais pendente, a caixa vem primeiro e o SDK só carrega depois de marcada. Com recusa, o formulário é
 * recriado (o token não serve de novo); quando o servidor pede, a página recarrega antes (tetos e parcelas frescos).
 * O formulário só é recriado quando muda a chave, o valor, as parcelas ou o e-mail de teste (props simples: uma nova
 * renderização da página com os mesmos valores não apaga o que foi digitado).
 */
export function PagamentoCartao({ codigo, alteracaoId = null, chavePublica, valor, parcelasMaximas, emailTeste, aceite, fuso, acao, bloqueio, oferecerPix }: Props) {
  const router = useRouter();
  const aceitePendente = !!aceite && !aceite.aceito;
  const [marcado, setMarcado] = useState(false);
  // Depois de marcada a primeira vez, o formulário fica (desmarcar só impede o envio).
  const [liberado, setLiberado] = useState(false);
  // As versões publicadas mudaram (ou o aceite voltou a ficar pendente) enquanto a página estava aberta: a caixa
  // recomeça desmarcada (é outra, pela `key`) e o formulário fecha até o hóspede marcar de novo — nunca um aceite
  // de versões que ele não marcou. A mensagem do servidor ("Leia a versão atual e marque de novo") fica.
  const chaveAceite = aceite ? `${aceitePendente ? "pendente" : "aceito"}:${DOCUMENTOS_LEGAIS.map((d) => aceite.versoes[d]).join("-")}` : "";
  const [aceiteVisto, setAceiteVisto] = useState(chaveAceite);
  if (aceiteVisto !== chaveAceite) {
    setAceiteVisto(chaveAceite);
    setMarcado(false);
    setLiberado(false);
  }
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [geracao, setGeracao] = useState(0);
  const pronto = (!aceitePendente || liberado) && !falhou;
  // Um quadro por pagamento (o da cotação e o da diferença de uma alteração nunca dividem o mesmo elemento).
  const container = `cartao-${codigo.replace(/[^A-Za-z0-9_-]/g, "")}${alteracaoId ? `-${alteracaoId.replace(/[^A-Za-z0-9_-]/g, "")}` : ""}`;

  const aoMarcar = (v: boolean) => {
    setMarcado(v);
    if (v) setLiberado(true);
  };

  const enviar = useEffectEvent(async (dados: DadosDoFormularioCartao, adicionais?: DadosAdicionaisCartao): Promise<void> => {
    setMensagem(null);
    if (aceitePendente && !marcado) {
      setMensagem(MENSAGEM_ACEITE_PENDENTE_CARTAO);
      throw new Error("aceite_pendente");
    }
    const form = formularioDoCartao(dados, adicionais?.paymentTypeId, { dispositivo: idDoAparelho(), aceite: aceitePendente && aceite ? aceite.versoes : null, alteracaoId });
    let r: EstadoCartao;
    try {
      r = await acao(form);
    } catch {
      // Sem resposta do servidor: pode ter chegado ao Mercado Pago. Nunca "tente de novo": a página confere.
      r = { erro: MENSAGEM_CARTAO_INCERTO, recarregar: true };
    }
    if (r.ok) {
      router.refresh();
      return;
    }
    setMensagem(r.erro ?? MENSAGEM_PROVEDOR_CARTAO);
    // Tetos, parcelas ou a oferta mudaram: a página recarrega antes do formulário novo.
    if (r.recarregar) router.refresh();
    // O token é de uso único: um formulário novo para a próxima tentativa.
    setGeracao((g) => g + 1);
    throw new Error("recusado");
  });

  const erroDoFormulario = useEffectEvent((e: ErroDoFormulario) => {
    const causa = typeof e?.cause === "string" && CAUSA.test(e.cause) ? e.cause : "desconhecida";
    // Só o código da causa vai ao registro (nunca a mensagem do formulário).
    console.warn("[site] formulário do cartão:", causa);
    if (e?.type === "critical") setFalhou(true);
    else if (causa === "payment_method_not_in_allowed_types") setMensagem(MENSAGEM_SO_CREDITO);
    // Outros avisos (campos incompletos, parcelas…): o próprio formulário mostra nos campos.
  });

  const travar = useEffectEvent(() => bloqueio?.travar());
  const destravar = useEffectEvent(() => bloqueio?.destravar());

  useEffect(() => {
    if (!pronto) return;
    let ativo = true;
    let controle: ControleDoFormulario | null = null;
    travar();
    carregarSdkMercadoPago()
      .then(async (MercadoPago) => {
        if (!ativo) return;
        const mp = new MercadoPago(chavePublica, { locale: "pt-BR" });
        const c = await mp.bricks().create("cardPayment", container, {
          initialization: { amount: valor / 100, ...(emailTeste ? { payer: { email: emailTeste } } : {}) },
          customization: {
            paymentMethods: { minInstallments: 1, ...(parcelasMaximas ? { maxInstallments: parcelasMaximas } : {}), types: { excluded: [...TIPOS_EXCLUIDOS_CARTAO] } },
          },
          callbacks: {
            onReady: () => {},
            onSubmit: (dados, adicionais) => enviar(dados, adicionais),
            onError: (e) => erroDoFormulario(e),
          },
        });
        if (ativo) controle = c;
        else c.unmount();
      })
      .catch(() => {
        if (ativo) setFalhou(true);
      });
    return () => {
      ativo = false;
      controle?.unmount();
      destravar();
    };
  }, [pronto, chavePublica, valor, parcelasMaximas, emailTeste, geracao, container]);

  return (
    <div className={styles.cartaoPagamento}>
      {aceite && (aceite.aceito ? <AceiteFeito aceito={aceite.aceito} fuso={fuso} /> : <BlocoAceite key={chaveAceite} aceite={aceite} fuso={fuso} aoMarcar={aoMarcar} />)}
      {falhou ? (
        <div role="alert" className={styles.aviso}>
          <p>{MENSAGEM_FORMULARIO_FALHOU}</p>
          {oferecerPix && (
            <button type="button" className={`${styles.botao} ${styles.botaoContorno}`} onClick={oferecerPix}>
              Pagar com Pix
            </button>
          )}
        </div>
      ) : pronto ? (
        <>
          <p className={styles.miudo}>{LINHA_MERCADO_PAGO}</p>
          <div id={container} className={styles.cartaoFormulario} />
        </>
      ) : (
        <p className={styles.miudo}>Marque a caixa acima para abrir o formulário do cartão.</p>
      )}
      {mensagem && (
        <p role="alert" className={styles.aviso}>
          {mensagem}
        </p>
      )}
    </div>
  );
}
