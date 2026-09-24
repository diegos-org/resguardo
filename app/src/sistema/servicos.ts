/**
 * Serviços externos (M1.6): o que está ligado e funcionando, sem nunca mostrar chaves.
 */
export type SituacaoServico = "ok" | "falha" | "nao_configurado" | "planejado";

export type Servico = { nome: string; paraQue: string; situacao: SituacaoServico; detalhe: string };

export function situacaoServicos(env: NodeJS.ProcessEnv, bancoOk: boolean | null): Servico[] {
  const tem = (...chaves: string[]) => chaves.every((c) => Boolean(env[c]));
  const banco = env.DATABASE_URL ?? "";
  const bancoLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(banco);
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
      situacao: tem("AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET") ? "ok" : "nao_configurado",
      detalhe: tem("AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET") ? "Configurado" : "Faltam as credenciais do Google",
    },
    {
      nome: "E-mail do sistema (Resend)",
      paraQue: "Código de login, convites, relatórios",
      situacao: tem("RESEND_API_KEY", "EMAIL_REMETENTE") ? "ok" : "nao_configurado",
      detalhe: tem("RESEND_API_KEY", "EMAIL_REMETENTE") ? "Configurado" : "Faltam RESEND_API_KEY e EMAIL_REMETENTE",
    },
    {
      nome: "Beds24",
      paraQue: "Reservas, calendário e preços das OTAs",
      situacao: tem("BEDS24_API_KEY") ? "ok" : "nao_configurado",
      detalhe: !tem("BEDS24_API_KEY")
        ? "Falta a chave BEDS24_API_KEY"
        : env.BEDS24_ESCRITA === "ligada"
          ? "Chave configurada · envio para o Beds24 LIGADO"
          : "Chave configurada · envio para o Beds24 desligado",
    },
    { nome: "WhatsApp (Meta)", paraQue: "Atendimento e mensagens", situacao: "planejado", detalhe: "Chega no M10 (depende da verificação no Meta)" },
    { nome: "Pagamentos (Mercado Pago)", paraQue: "Reserva direta no site", situacao: "planejado", detalhe: "Chega no M8" },
  ];
}
