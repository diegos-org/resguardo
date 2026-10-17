import { dataHoraNoFuso } from "@/lib/datas";
import type { MotivoDesconexao, SituacaoConta } from "@/whatsapp/regras";
import { PRAZO_SINCRONIZACAO_MS, rotuloDoMotivo } from "@/whatsapp/situacao";
import styles from "./mensagens.module.css";

/**
 * Só o que os avisos precisam: a situação da conta, o motivo e a hora da Meta, o prazo das 24 h e o recebimento ligado
 * (null = quem vê não tem `configuracao:editar`; o aviso da chave é só para quem pode mudá-la). Nunca a configuração
 * (os ids da Meta) nem os eventos da conta: a caixa de entrada é aberta pela operação quando Diego libera as conversas.
 */
export type AvisosDaConta = {
  situacao: SituacaoConta;
  motivo: MotivoDesconexao | null;
  situacaoEm: Date | null;
  prazo24h: Date | null;
  recebimentoLigado: boolean | null;
};

/** O aviso para quem não vê as conversas (as duas páginas de mensagens), sem ler nada. */
export const TEXTO_SEM_ACESSO =
  "As conversas do WhatsApp estão visíveis só para o administrador. Quem muda isso é o administrador, em Configurações → Integrações → WhatsApp.";

export function AvisoSemAcesso() {
  return (
    <>
      <h1>Mensagens</h1>
      <p role="note" className={styles.aviso}>
        {TEXTO_SEM_ACESSO}
      </p>
    </>
  );
}

const quando = (d: Date) => dataHoraNoFuso(d);

/**
 * Avisos do WhatsApp no topo da caixa de entrada (e em Integrações → WhatsApp), M10.1a: o recebimento desligado, a
 * conta não conectada, desconectada, aguardando reconexão ou suspensa, o prazo das 24 h correndo e, sempre, que os
 * anexos ficam "ver no celular". Componente de servidor: nada daqui vai para o navegador como dado.
 */
export function AvisosWhatsapp({ conta }: { conta: AvisosDaConta }) {
  const avisos: { texto: string; grave?: boolean; info?: boolean }[] = [];
  if (conta.recebimentoLigado === false) {
    avisos.push({ texto: "O recebimento do WhatsApp está desligado: nada novo chega ao painel. Só o Diego liga, na Vercel (WHATSAPP_RECEBIMENTO)." });
  }
  switch (conta.situacao) {
    case "nao_conectada":
      avisos.push({ texto: "O WhatsApp ainda não está conectado ao sistema. As conversas aparecem aqui depois da conexão, que será feita no dia combinado.", info: true });
      break;
    case "desconectada":
      avisos.push({
        texto: `A conexão do WhatsApp com o sistema caiu${conta.situacaoEm ? ` em ${quando(conta.situacaoEm)}` : ""}: ${rotuloDoMotivo(conta.motivo)}. As mensagens novas não chegam aqui até a conexão ser refeita; o celular continua funcionando.`,
        grave: true,
      });
      break;
    case "aguardando_reconexao":
      avisos.push({
        texto: `O WhatsApp foi registrado de novo${conta.situacaoEm ? ` em ${quando(conta.situacaoEm)}` : ""} (troca de aparelho ou reinstalação). A reconexão costuma ser automática em alguns minutos.`,
      });
      break;
    case "suspensa":
      avisos.push({ texto: `A Meta suspendeu ou vai suspender a conta do WhatsApp${conta.situacaoEm ? ` (${quando(conta.situacaoEm)})` : ""}.`, grave: true });
      break;
    case "conectada":
      break;
  }
  if (conta.prazo24h) {
    // O prazo é a conexão + 24 h (`prazoDas24h`): a hora da conexão sai da mesma constante, sem outra leitura.
    const conectadoEm = new Date(conta.prazo24h.getTime() - PRAZO_SINCRONIZACAO_MS);
    avisos.push({ texto: `Conectado em ${quando(conectadoEm)}. O prazo para pedir os contatos e o histórico termina em ${quando(conta.prazo24h)}.`, info: true });
  }
  return (
    <section aria-label="Avisos do WhatsApp" className={styles.avisos}>
      {avisos.map((a) => (
        <p key={a.texto} role={a.grave ? "alert" : "note"} className={[styles.aviso, a.grave ? styles.avisoGrave : a.info ? styles.avisoInfo : ""].filter(Boolean).join(" ")}>
          {a.texto}
        </p>
      ))}
      <p className={styles.nota}>
        Fotos, áudios, vídeos, documentos e localizações aparecem como “ver no celular”: o sistema não baixa anexos. Mensagens vindas de aparelhos vinculados que a
        Meta não suporta podem não chegar aqui.
      </p>
    </section>
  );
}
