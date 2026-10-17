import { BotaoCopiar } from "@/components/BotaoCopiar";
import styles from "@/components/formularios.module.css";
import { AvisosWhatsapp } from "@/components/mensagens/AvisosWhatsapp";
import { dataHoraNoFuso } from "@/lib/datas";
import type { EmailDoEvento, SituacaoWhatsapp } from "@/whatsapp/integracao";
import type { Sincronizacao } from "@/whatsapp/regras";
import { ROTULO_EVENTO, ROTULO_SITUACAO, rotuloDoMotivo } from "@/whatsapp/situacao";
import { FormIdsWhatsapp } from "./FormIdsWhatsapp";
import { FormQuemVeConversas } from "./FormQuemVeConversas";

const quando = (d: Date) => dataHoraNoFuso(d);

const TOKEN: Record<SituacaoWhatsapp["token"], string> = {
  ok: "Senha de verificação (WHATSAPP_VERIFY_TOKEN): configurada",
  falta: "Senha de verificação (WHATSAPP_VERIFY_TOKEN): falta",
  curto: "Senha de verificação (WHATSAPP_VERIFY_TOKEN): curta demais (mínimo 32 caracteres)",
};

const SINCRONIZACAO: Record<Sincronizacao, string> = {
  nao_pedida: "não pedido",
  pedida: "pedido",
  recebendo: "recebendo",
  concluida: "concluído",
  recusada: "recusado no celular",
};

/** O resultado do e-mail de cada aviso da conta: um texto por causa, nunca um palpite. Sem e-mail no evento: nada. */
const EMAIL: Record<EmailDoEvento, string | null> = {
  enviado: "e-mail enviado",
  "sem-email": "e-mail não enviado: falta o e-mail da empresa em Configurações → Empresa",
  "sem-correio": "e-mail não enviado: o e-mail do sistema (Resend) não está configurado",
  falhou: "e-mail não enviado: o envio falhou; nova tentativa de hora em hora",
  pendente: "e-mail ainda não enviado",
  sem_nova_tentativa: "e-mail não enviado: passaram 7 dias sem conseguir; não há nova tentativa",
  nao_se_aplica: null,
};

function linhaDaSituacao(c: SituacaoWhatsapp["conta"]): string {
  const extra = [c.motivo ? rotuloDoMotivo(c.motivo) : null, c.situacaoEm ? `desde ${quando(c.situacaoEm)}` : null].filter(Boolean);
  return `Situação da conta: ${ROTULO_SITUACAO[c.situacao]}${extra.length ? ` (${extra.join(", ")})` : ""}`;
}

function linhaDosContatos(c: SituacaoWhatsapp["conta"]): string {
  // A Meta não manda sinal de fim da agenda: "recebidos (último em …)", nunca "recebendo".
  if (c.sincronizacaoContatos === "recebendo") return `Contatos da agenda: recebidos${c.contatosRecebidosEm ? ` (último em ${quando(c.contatosRecebidosEm)})` : ""}`;
  return `Contatos da agenda: ${SINCRONIZACAO[c.sincronizacaoContatos]}`;
}

const linhaDoHistorico = (c: SituacaoWhatsapp["conta"]) =>
  `Histórico: ${SINCRONIZACAO[c.sincronizacaoHistorico]}${c.progressoHistorico === null ? "" : ` (${c.progressoHistorico}%)`}`;

/**
 * Integrações → WhatsApp (M10.1a): a mesma situação que Sistema mostra (`situacaoDoWhatsapp`), em detalhe — as três
 * variáveis da Vercel (só se existem, nunca o valor), o endereço fixo para colar no app da Meta, a situação da conta, os
 * contadores de hoje, os últimos avisos da conta com o resultado do e-mail e os dois formulários (os ids da Meta e quem
 * vê as conversas). Componente de servidor: os formulários (cliente) recebem só os ids e o "quem vê"; o ambiente nunca
 * chega aqui (a página passa só `naPrevia`).
 */
export function WhatsappIntegracao({ w, naPrevia }: { w: SituacaoWhatsapp; naPrevia: boolean }) {
  const h = w.avisos.hoje;
  const linhas = [
    w.recebimentoLigado ? "Recebimento: ligado" : "Recebimento: desligado (WHATSAPP_RECEBIMENTO não está como ligada na Vercel)",
    TOKEN[w.token],
    w.segredoConfigurado ? "Chave secreta do app (WHATSAPP_APP_SECRET): configurada" : "Chave secreta do app (WHATSAPP_APP_SECRET): falta",
    linhaDaSituacao(w.conta),
    ...(w.conta.prazo24h ? [`Prazo para pedir os contatos e o histórico: até ${quando(w.conta.prazo24h)}`] : []),
    linhaDosContatos(w.conta),
    linhaDoHistorico(w.conta),
    w.avisos.ultimoValidoEm ? `Último aviso válido: ${quando(w.avisos.ultimoValidoEm)}` : "Último aviso válido: nenhum ainda",
    `Hoje: ${h.assinaturas_recusadas} recusado(s) pela assinatura, ${h.ilegiveis} ilegível(is), ${h.outra_conta} de outra conta ou número, ${h.desconhecidos} não reconhecido(s), ${h.ignorados} ignorado(s) (grupos, confirmações de entrega e avisos sem efeito).`,
  ];
  return (
    <section aria-label="WhatsApp" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 style={{ fontSize: "1.25rem", margin: 0 }}>WhatsApp (Meta)</h2>
      <AvisosWhatsapp conta={{ situacao: w.conta.situacao, motivo: w.conta.motivo, situacaoEm: w.conta.situacaoEm, prazo24h: w.conta.prazo24h, recebimentoLigado: w.recebimentoLigado }} />
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: "0.9375rem" }}>
        {linhas.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {!w.config.numeroId && (
        <p role="alert" className={styles.alerta} style={{ margin: 0 }}>
          Falta o id do número: os avisos de mensagem estão sendo recusados e contados como de outra conta.
        </p>
      )}
      <div className={styles.linha} style={{ alignItems: "center" }}>
        <span style={{ fontSize: "0.875rem", overflowWrap: "anywhere" }}>
          Endereço para colar no app da Meta: <code>{w.enderecoWebhook}</code>
        </span>
        <BotaoCopiar texto={w.enderecoWebhook} rotulo="Copiar endereço" className={styles.pequeno} />
      </div>
      {naPrevia && (
        <p role="note" className={styles.alerta} style={{ margin: 0 }}>
          Esta é uma prévia de teste: o endereço do WhatsApp só funciona na produção. Aqui, use só ids fictícios no formulário &lsquo;Identificação na Meta&rsquo;.
        </p>
      )}
      <h3 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 500 }}>Últimos avisos da conta</h3>
      {w.eventosDaConta.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: "0.875rem" }}>
          {w.eventosDaConta.map((e, i) => {
            const email = EMAIL[e.email];
            return (
              <li key={i}>
                {`${e.ocorridoEm ? quando(e.ocorridoEm) : "—"} — ${ROTULO_EVENTO[e.tipo]}${e.motivo ? `: ${rotuloDoMotivo(e.motivo)}` : ""}${email ? ` · ${email}` : ""}`}
              </li>
            );
          })}
        </ul>
      ) : (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>Nenhum aviso da conta recebido ainda.</p>
      )}
      <FormIdsWhatsapp wabaId={w.config.wabaId} numeroId={w.config.numeroId} />
      <FormQuemVeConversas quemVe={w.config.quemVeConversas} />
    </section>
  );
}
