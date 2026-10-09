/**
 * Mercado Pago a partir do ambiente (M8.2a). Deny-by-default: qualquer chave ausente ou valor
 * inesperado desliga o pagamento no site (volta o pedido pela conversa).
 *
 * - MERCADOPAGO_AMBIENTE: ausente/vazio ou exatamente "teste" = teste; exatamente "producao" =
 *   travado (a parte (a) NÃO cobra; liberar é código num item futuro, nunca uma variável só);
 *   qualquer outro valor = configuração inválida (desliga).
 * - Deploy de produção da Vercel (VERCEL_ENV=production): o teste nunca roda ali, porque o banco
 *   de produção tem a operação real; o teste é nas prévias (banco separado). Só rodam o teste as
 *   prévias (VERCEL_ENV=preview), o `vercel dev` (development) e o computador de desenvolvimento
 *   (sem VERCEL_ENV e NODE_ENV diferente de production): um `next start` ou script fora da Vercel
 *   com NODE_ENV=production, ou um VERCEL_ENV inesperado, conta como produção.
 * - MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_PUBLIC_KEY: as duas obrigatórias.
 * - MERCADOPAGO_WEBHOOK_SECRET: opcional aqui (sem ela, nenhum aviso é aceito).
 *
 * A variável sozinha não é barreira: o prefixo APP_USR é igual em teste e produção. Antes de
 * cobrar, quem chama exige `contaDeTesteConfirmada(...) === true` (conta de teste comprovada
 * pelo provedor). Nada aqui registra ou devolve o access token ou o segredo do webhook.
 */
import { createHash } from "node:crypto";
import { ClienteMercadoPagoHttp } from "./mercadopago";
import type { ProvedorPagamento } from "./provedor";

export type AmbienteMercadoPago = "teste" | "producao";

export type EstadoPagamento =
  | { situacao: "desligado"; motivo: string }
  | { situacao: "so_nas_previas" }
  | { situacao: "producao_travada" }
  | { situacao: "teste"; chavePublica: string; segredoWebhook: string | null };

/** Valor de MERCADOPAGO_AMBIENTE normalizado; null = valor inesperado (desliga). */
export function ambienteMercadoPago(valor: string | undefined): AmbienteMercadoPago | null {
  const v = (valor ?? "").trim();
  if (v === "" || v === "teste") return "teste";
  if (v === "producao") return "producao";
  return null;
}

const chaveLegivel = (v: string) => /^[\x21-\x7E]{1,512}$/.test(v);
const ler = (v: string | undefined) => v?.trim() || null;

/** Só as prévias da Vercel, o `vercel dev` e o computador de desenvolvimento rodam o teste (deny-by-default). */
function ambienteDeTeste(env: NodeJS.ProcessEnv): boolean {
  const vercel = env.VERCEL_ENV?.trim();
  if (vercel) return vercel === "preview" || vercel === "development";
  return env.NODE_ENV !== "production";
}

export function estadoPagamentoDoAmbiente(env: NodeJS.ProcessEnv = process.env): EstadoPagamento {
  const ambiente = ambienteMercadoPago(env.MERCADOPAGO_AMBIENTE);
  // Nunca repetir o valor recebido: pode ser uma chave colada na variável errada.
  if (!ambiente) return { situacao: "desligado", motivo: "MERCADOPAGO_AMBIENTE com valor inesperado: use teste ou producao." };
  const token = ler(env.MERCADOPAGO_ACCESS_TOKEN);
  const publica = ler(env.MERCADOPAGO_PUBLIC_KEY);
  const faltam = [token ? null : "MERCADOPAGO_ACCESS_TOKEN", publica ? null : "MERCADOPAGO_PUBLIC_KEY"].filter((n): n is string => n !== null);
  if (faltam.length) return { situacao: "desligado", motivo: `Falta configurar ${faltam.join(" e ")}.` };
  if (!chaveLegivel(token!)) return { situacao: "desligado", motivo: "MERCADOPAGO_ACCESS_TOKEN tem espaços ou caracteres inválidos: cole só a chave, numa linha." };
  if (!chaveLegivel(publica!)) return { situacao: "desligado", motivo: "MERCADOPAGO_PUBLIC_KEY tem espaços ou caracteres inválidos: cole só a chave, numa linha." };
  if (ambiente === "producao") return { situacao: "producao_travada" };
  if (!ambienteDeTeste(env)) return { situacao: "so_nas_previas" };
  return { situacao: "teste", chavePublica: publica!, segredoWebhook: ler(env.MERCADOPAGO_WEBHOOK_SECRET) };
}

// Guarda só a impressão (hash) da chave para saber quando ela mudou.
let doProcesso: { impressao: string; fetchImpl: typeof fetch | undefined; provedor: ClienteMercadoPagoHttp } | null = null;
let conferencias = new WeakMap<ProvedorPagamento, { resposta: boolean | null; ate: number; emAndamento: Promise<boolean | null> | null }>();

/**
 * Cliente do Mercado Pago, ou null fora da situação "teste". Reaproveitado no processo enquanto
 * a chave (e o fetch) não mudam — e, com ele, o resultado de `contaDeTesteConfirmada`.
 */
export function provedorDoAmbiente(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): ProvedorPagamento | null {
  if (estadoPagamentoDoAmbiente(env).situacao !== "teste") {
    doProcesso = null;
    return null;
  }
  const token = ler(env.MERCADOPAGO_ACCESS_TOKEN)!;
  const impressao = createHash("sha256").update(token).digest("hex");
  if (!doProcesso || doProcesso.impressao !== impressao || doProcesso.fetchImpl !== fetchImpl) {
    doProcesso = { impressao, fetchImpl, provedor: new ClienteMercadoPagoHttp({ accessToken: token, ambiente: "teste", fetchImpl }) };
  }
  return doProcesso.provedor;
}

/** Quanto tempo vale cada resposta da conferência de conta de teste. */
export const VALIDADE_CONFERENCIA_MS = { confirmada: 10 * 60_000, outra: 60_000 } as const;

/**
 * A conta por trás da chave é de teste? Pergunta ao provedor (`conferirContaDeTeste`) e lembra
 * a resposta por provedor — que `provedorDoAmbiente` mantém um por chave —, 10 minutos para true
 * e 1 minuto para false/null. Chamadas simultâneas esperam a mesma conferência. Só true libera
 * cobrar; false ou null = NÃO cobrar.
 */
export async function contaDeTesteConfirmada(provedor: ProvedorPagamento | null, agora: () => Date = () => new Date()): Promise<boolean | null> {
  if (!provedor) return null;
  const lembrado = conferencias.get(provedor);
  if (lembrado?.emAndamento) return lembrado.emAndamento;
  if (lembrado && agora().getTime() < lembrado.ate) return lembrado.resposta;
  const mapa = conferencias;
  // Começa num passo seguinte, para a marca "em andamento" já estar gravada quando terminar.
  const emAndamento = Promise.resolve().then(async () => {
    let resposta: boolean | null = null;
    try {
      const r = await provedor.conferirContaDeTeste();
      resposta = r === true || r === false ? r : null;
    } catch {
      resposta = null;
    }
    mapa.set(provedor, { resposta, ate: agora().getTime() + (resposta === true ? VALIDADE_CONFERENCIA_MS.confirmada : VALIDADE_CONFERENCIA_MS.outra), emAndamento: null });
    return resposta;
  });
  mapa.set(provedor, { resposta: null, ate: 0, emAndamento });
  return emAndamento;
}

/** Para testes: esquece o cliente do processo e as conferências lembradas. */
export function esquecerProvedorDoAmbiente() {
  doProcesso = null;
  conferencias = new WeakMap();
}
