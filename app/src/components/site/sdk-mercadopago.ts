/**
 * SDK do Mercado Pago no navegador (M8.2b): o script hospedado por ele, sem versão no endereço (exigência do PCI: o
 * formulário do cartão vem sempre do Mercado Pago, e o número do cartão nunca passa pelo nosso servidor). Carregado uma
 * vez, só quando o formulário do cartão vai aparecer (com a oferta, o cookie do pedido e o aceite marcado); nenhuma
 * dependência do npm. Os tipos são o mínimo que o site usa do "Card Payment Brick".
 */

export const URL_SDK_MERCADO_PAGO = "https://sdk.mercadopago.com/js/v2";

/** Erro que o formulário do Mercado Pago informa (`cause` é um código; `message` nunca é mostrado nem registrado). */
export type ErroDoFormulario = { type?: string; cause?: unknown; message?: unknown };

/** O que o formulário entrega no envio (o token do cartão, nunca o número). */
export type DadosDoFormularioCartao = {
  token?: unknown;
  payment_method_id?: unknown;
  installments?: unknown;
  issuer_id?: unknown;
  transaction_amount?: unknown;
  payer?: { email?: unknown; identification?: { type?: unknown; number?: unknown } | null } | null;
};
/** Dados que o formulário entrega à parte: deles só `paymentTypeId` é usado (BIN, últimos dígitos e titular nunca). */
export type DadosAdicionaisCartao = { paymentTypeId?: unknown; bin?: unknown; lastFourDigits?: unknown; cardholderName?: unknown };

export type ConfiguracaoCartao = {
  initialization: { amount: number; payer?: { email: string } };
  customization: {
    paymentMethods: { minInstallments: number; maxInstallments?: number; types: { excluded: string[] } };
  };
  callbacks: {
    onReady: () => void;
    onSubmit: (dados: DadosDoFormularioCartao, adicionais?: DadosAdicionaisCartao) => Promise<void>;
    onError: (erro: ErroDoFormulario) => void;
  };
};

export type ControleDoFormulario = { unmount: () => void };
export type MercadoPagoSdk = { bricks: () => { create: (tipo: "cardPayment", container: string, configuracao: ConfiguracaoCartao) => Promise<ControleDoFormulario> } };
export type MercadoPagoCtor = new (chavePublica: string, opcoes: { locale: string }) => MercadoPagoSdk;

type JanelaComSdk = Window & { MercadoPago?: MercadoPagoCtor; MP_DEVICE_SESSION_ID?: unknown };

let carregando: Promise<MercadoPagoCtor> | null = null;

/**
 * Injeta o `<script>` do SDK uma vez e resolve com o construtor `MercadoPago`. Falhou (rede, bloqueador): rejeita e a
 * próxima chamada tenta de novo.
 */
export function carregarSdkMercadoPago(): Promise<MercadoPagoCtor> {
  const janela = window as JanelaComSdk;
  if (janela.MercadoPago) return Promise.resolve(janela.MercadoPago);
  if (carregando) return carregando;
  carregando = new Promise<MercadoPagoCtor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = URL_SDK_MERCADO_PAGO;
    script.async = true;
    const falhar = () => {
      carregando = null;
      script.remove();
      reject(new Error("sdk_indisponivel"));
    };
    script.onload = () => (janela.MercadoPago ? resolve(janela.MercadoPago) : falhar());
    script.onerror = falhar;
    document.head.appendChild(script);
  });
  return carregando;
}

/** Id do aparelho que o SDK v2 grava na janela (repassado ao Mercado Pago contra fraude; nunca guardado). */
export function idDoAparelho(): string | null {
  const v = (window as JanelaComSdk).MP_DEVICE_SESSION_ID;
  return typeof v === "string" && v ? v : null;
}
