/**
 * Pagamento no site (M8.2a) — a situação do Mercado Pago para Integrações (e Sistema, pela mesma função): ambiente,
 * chaves, conta de teste conferida, segredo do webhook, último aviso válido, assinaturas recusadas hoje e o
 * endereço fixo do webhook (sempre o de homologação: nas prévias o aviso não chega — ali se usa "Conferir agora").
 * Nunca devolve chave nem segredo.
 */
import type { Db } from "@/db/types";
import { ESPERA_TELA_MS, esperarNoMaximo } from "@/lib/prazo";
import { contaDeTesteConfirmada, estadoPagamentoDoAmbiente, provedorDoAmbiente } from "./ambiente";
import { situacaoDosAvisos } from "./eventos";
import type { ProvedorPagamento } from "./provedor";

/** Endereço do aviso assinado para configurar no Mercado Pago (o deploy de produção, fixo). */
export const ENDERECO_WEBHOOK = "https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago";

/** Segredo dos avisos (MERCADOPAGO_WEBHOOK_SECRET), em qualquer ambiente; null = ausente ou vazio (todo aviso é recusado). */
export function segredoDoWebhook(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.MERCADOPAGO_WEBHOOK_SECRET?.trim() || null;
}

export type SituacaoMercadoPago = {
  situacao: "desligado" | "so_nas_previas" | "producao_travada" | "teste";
  /** Por que está desligado (lista fechada, sem valores das variáveis). */
  motivo: string | null;
  /** true = conta conferida como de teste; false = comprovadamente não é; null = não conferida (ou fora do teste). */
  contaDeTeste: boolean | null;
  segredoWebhook: boolean;
  ultimoAvisoValidoEm: Date | null;
  assinaturasRecusadasHoje: number;
  enderecoWebhook: string;
};

/**
 * `esperaMs`: quanto a tela espera a conferência da conta no Mercado Pago (padrão `ESPERA_TELA_MS`, 2 s); passou disso,
 * a conta sai "não conferida" e o resto da tela aparece (a conferência continua no fundo e fica lembrada).
 */
export async function situacaoDoMercadoPago(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
  agora: Date = new Date(),
  o: { provedor?: ProvedorPagamento; esperaMs?: number } = {},
): Promise<SituacaoMercadoPago> {
  const estado = estadoPagamentoDoAmbiente(env);
  const provedor = estado.situacao === "teste" ? (o.provedor ?? provedorDoAmbiente(env)) : null;
  const conta = provedor ? await esperarNoMaximo(contaDeTesteConfirmada(provedor, () => agora).catch(() => null), o.esperaMs ?? ESPERA_TELA_MS, null) : null;
  const avisos = await situacaoDosAvisos(db, agora);
  return {
    situacao: estado.situacao,
    motivo: estado.situacao === "desligado" ? estado.motivo : null,
    contaDeTeste: conta,
    segredoWebhook: segredoDoWebhook(env) !== null,
    ultimoAvisoValidoEm: avisos.ultimoValidoEm,
    assinaturasRecusadasHoje: avisos.recusadasHoje,
    enderecoWebhook: ENDERECO_WEBHOOK,
  };
}
