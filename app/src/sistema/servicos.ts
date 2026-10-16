/**
 * Serviços externos (M1.6): o que está ligado e funcionando, sem nunca mostrar chaves.
 * "ok" só quando foi testado agora (o banco); "configurado" quando a chave existe mas o
 * serviço não foi testado nesta abertura (não afirmar que funciona sem ter conferido).
 */
import { ambienteDoSentry, situacaoDoSentry } from "@/observabilidade/sentry";
import { ambienteMercadoPago } from "@/pagamentos/ambiente";
import type { SituacaoMercadoPago } from "@/pagamentos/integracao";
import { deployDeProducao } from "@/sistema/ambiente";

export type SituacaoServico = "ok" | "configurado" | "falha" | "nao_configurado" | "planejado";

export type Servico = { nome: string; paraQue: string; situacao: SituacaoServico; detalhe: string };

export const NOME_MERCADO_PAGO = "Pagamentos (Mercado Pago)";
export const NOME_SENTRY = "Avisos de erro (Sentry)";

const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/**
 * No deploy de produção sem as chaves de teste (que ficam só no ambiente Preview): é o esperado, não falta nada. Só no
 * deploy de verdade (`deployDeProducao`, a mesma regra de `sistema/ambiente.ts`): onde só conta como produção, faltar a
 * chave segue como "desligado".
 */
export const TEXTO_PRODUCAO_SEM_CHAVES = "Deploy de produção: o teste do pagamento roda nas prévias (as chaves de teste ficam só no ambiente Preview da Vercel)";
export const producaoSemChaves = (mp: SituacaoMercadoPago, env: NodeJS.ProcessEnv) =>
  deployDeProducao(env) && mp.situacao === "desligado" && ambienteMercadoPago(env.MERCADOPAGO_AMBIENTE) !== null;

/**
 * A linha do Mercado Pago (Integrações e Sistema), lida de `situacaoDoMercadoPago` — a mesma função nos dois
 * lugares. "ok" só com a conta conferida agora como de teste no provedor.
 */
export function servicoMercadoPago(mp: SituacaoMercadoPago, env: NodeJS.ProcessEnv): Servico {
  const avisos = [
    mp.segredoWebhook ? "segredo do webhook configurado" : "sem segredo do webhook (todo aviso é recusado)",
    mp.ultimoAvisoValidoEm ? `último aviso válido em ${quando(mp.ultimoAvisoValidoEm)}` : "nenhum aviso válido recebido ainda",
    `${mp.assinaturasRecusadasHoje} assinatura(s) recusada(s) hoje`,
  ].join(" · ");
  const base = { nome: NOME_MERCADO_PAGO, paraQue: "Pagamento da reserva direta no site (Pix, em teste)" };
  switch (mp.situacao) {
    case "desligado":
      if (producaoSemChaves(mp, env)) return { ...base, situacao: "configurado", detalhe: `${TEXTO_PRODUCAO_SEM_CHAVES} · ${avisos}` };
      return { ...base, situacao: ambienteMercadoPago(env.MERCADOPAGO_AMBIENTE) === null ? "falha" : "nao_configurado", detalhe: `Desligado: ${mp.motivo ?? "faltam as chaves"} · ${avisos}` };
    case "so_nas_previas":
      return { ...base, situacao: "configurado", detalhe: `Chaves configuradas, mas o teste do pagamento roda nas prévias da Vercel: aqui o site segue pelo pedido na conversa · ${avisos}` };
    case "producao_travada":
      return { ...base, situacao: "configurado", detalhe: `Ambiente de produção do Mercado Pago: travado nesta fase (nenhuma cobrança; só teste) · ${avisos}` };
    case "teste":
      return {
        ...base,
        situacao: mp.contaDeTeste === true ? "ok" : "falha",
        detalhe: `${mp.contaDeTeste === true ? "Ambiente de teste · conta conferida como de teste no Mercado Pago" : mp.contaDeTeste === false ? "Ambiente de teste · a conta das chaves NÃO é de teste: nenhuma cobrança é feita" : "Ambiente de teste · não deu para conferir no Mercado Pago se a conta é de teste: nenhuma cobrança é feita"} · ${avisos}`,
      };
  }
}

/**
 * A linha do Sentry (M0.9), pela mesma regra que liga o envio (`situacaoDoSentry`): um endereço de envio com a forma
 * errada aparece como problema, em vez de deixar os avisos desligados sem ninguém saber. O valor nunca aparece.
 */
export function servicoSentry(env: NodeJS.ProcessEnv): Servico {
  const base = { nome: NOME_SENTRY, paraQue: "Avisa a equipe dos erros do sistema, sem dados pessoais" };
  switch (situacaoDoSentry(env)) {
    case "ligado":
      return { ...base, situacao: "configurado", detalhe: `Ligado ${ambienteDoSentry(env) === "production" ? "no deploy de produção" : "nesta prévia"}; o envio não é testado nesta abertura` };
    case "sem_endereco":
      return { ...base, situacao: "nao_configurado", detalhe: "Falta NEXT_PUBLIC_SENTRY_DSN: os erros não são avisados" };
    case "endereco_invalido":
      return {
        ...base,
        situacao: "falha",
        detalhe: "NEXT_PUBLIC_SENTRY_DSN não tem a forma de um endereço de envio do Sentry (https://chave@servidor/número do projeto): nada é enviado. Confira o valor na Vercel",
      };
    case "fora_do_ambiente":
      return { ...base, situacao: "configurado", detalhe: "Endereço configurado, mas desligado aqui: só envia no deploy de produção e nas prévias da Vercel" };
  }
}

/** `mercadoPago`: a situação já lida (`situacaoDoMercadoPago`); sem ela, a linha diz só que não foi conferida. */
export function situacaoServicos(env: NodeJS.ProcessEnv, bancoOk: boolean | null, mercadoPago: SituacaoMercadoPago | null = null): Servico[] {
  const tem = (...chaves: string[]) => chaves.every((c) => Boolean(env[c]));
  const banco = env.DATABASE_URL ?? "";
  const bancoLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(banco);
  const beds24 = Boolean(env.BEDS24_REFRESH_TOKEN?.trim() || env.BEDS24_API_KEY?.trim());
  return [
    {
      nome: "Banco de dados (Neon)",
      paraQue: "Guarda tudo: cadastros, reservas, financeiro",
      situacao: !banco ? "nao_configurado" : bancoOk === false ? "falha" : "ok",
      detalhe: !banco ? "Falta DATABASE_URL" : bancoOk === false ? "Não respondeu agora" : bancoLocal ? "Banco local (computador)" : "Conectado",
    },
    {
      nome: "Login com Google",
      paraQue: "Entrada da equipe com conta Google",
      situacao: tem("AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET") ? "configurado" : "nao_configurado",
      detalhe: tem("AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET") ? "Configurado" : "Faltam as credenciais do Google",
    },
    {
      nome: "E-mail do sistema (Resend)",
      paraQue: "Código de login, convites, relatórios",
      situacao: tem("RESEND_API_KEY", "EMAIL_REMETENTE") ? "configurado" : "nao_configurado",
      detalhe: tem("RESEND_API_KEY", "EMAIL_REMETENTE") ? "Configurado" : "Faltam RESEND_API_KEY e EMAIL_REMETENTE",
    },
    {
      nome: "Agendador (Vercel Cron)",
      paraQue: "Roda as automações no horário (agenda diária às 20:00)",
      situacao: tem("CRON_SECRET") ? "configurado" : "nao_configurado",
      detalhe: tem("CRON_SECRET") ? "Configurado" : "Falta CRON_SECRET (sem ele, o agendador é recusado)",
    },
    {
      nome: "Beds24",
      paraQue: "Reservas, calendário e preços das OTAs",
      situacao: beds24 ? "configurado" : "nao_configurado",
      detalhe: !beds24
        ? "Falta BEDS24_REFRESH_TOKEN (ou BEDS24_API_KEY para token direto)"
        : env.BEDS24_ESCRITA?.trim() === "ligada"
          ? "Credencial configurada, conexão não testada · envio para o Beds24 LIGADO (só para os imóveis marcados em Configurações → Calendário e preços)"
          : "Credencial configurada, conexão não testada · envio para o Beds24 desligado (BEDS24_ESCRITA)",
    },
    { nome: "WhatsApp (Meta)", paraQue: "Atendimento e mensagens", situacao: "planejado", detalhe: "Chega no M10 (depende da verificação no Meta)" },
    mercadoPago
      ? servicoMercadoPago(mercadoPago, env)
      : { nome: NOME_MERCADO_PAGO, paraQue: "Pagamento da reserva direta no site (Pix, em teste)", situacao: "nao_configurado", detalhe: "Situação não conferida nesta abertura" },
    servicoSentry(env),
  ];
}
