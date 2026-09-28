/**
 * Serviços externos (M1.6): o que está ligado e funcionando, sem nunca mostrar chaves.
 * "ok" só quando foi testado agora (o banco); "configurado" quando a chave existe mas o
 * serviço não foi testado nesta abertura (não afirmar que funciona sem ter conferido).
 */
export type SituacaoServico = "ok" | "configurado" | "falha" | "nao_configurado" | "planejado";

export type Servico = { nome: string; paraQue: string; situacao: SituacaoServico; detalhe: string };

export function situacaoServicos(env: NodeJS.ProcessEnv, bancoOk: boolean | null): Servico[] {
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
      paraQue: "Roda as automações no horário (agenda diária às 20h)",
      situacao: tem("CRON_SECRET") ? "configurado" : "nao_configurado",
      detalhe: tem("CRON_SECRET") ? "Configurado" : "Falta CRON_SECRET (sem ele, o agendador é recusado)",
    },
    {
      nome: "Beds24",
      paraQue: "Reservas, calendário e preços das OTAs",
      situacao: beds24 ? "configurado" : "nao_configurado",
      detalhe: !beds24
        ? "Falta BEDS24_REFRESH_TOKEN (ou BEDS24_API_KEY para token direto)"
        : env.BEDS24_ESCRITA === "ligada"
          ? "Credencial configurada, conexão não testada · sinal de escrita LIGADO, mas o cliente atual só faz leitura"
          : "Credencial configurada, conexão não testada · envio para o Beds24 desligado",
    },
    { nome: "WhatsApp (Meta)", paraQue: "Atendimento e mensagens", situacao: "planejado", detalhe: "Chega no M10 (depende da verificação no Meta)" },
    { nome: "Pagamentos (Mercado Pago)", paraQue: "Reserva direta no site", situacao: "planejado", detalhe: "Chega no M8" },
  ];
}
