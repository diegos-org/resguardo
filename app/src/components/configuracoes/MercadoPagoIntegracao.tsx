import { BotaoCopiar } from "@/components/BotaoCopiar";
import styles from "@/components/formularios.module.css";
import { dataHoraNoFuso } from "@/lib/datas";
import { ambienteMercadoPago } from "@/pagamentos/ambiente";
import type { SituacaoMercadoPago } from "@/pagamentos/integracao";
import { type AmbienteDoSistema, ambienteDeTeste, ambienteDoSistema, deployDeProducao, type MotivoDaProducao, motivoDaProducao } from "@/sistema/ambiente";
import { producaoSemChaves, TEXTO_PRODUCAO_SEM_CHAVES } from "@/sistema/servicos";

const quando = (d: Date) => dataHoraNoFuso(d);

const CONEXAO: Record<SituacaoMercadoPago["situacao"], string> = {
  teste: "Ligado em teste (nenhuma cobrança real)",
  so_nas_previas: "Chaves configuradas, mas aqui é o deploy de produção: o teste do pagamento roda nas prévias",
  producao_travada: "Ambiente de produção do Mercado Pago: travado nesta fase (só teste)",
  desligado: "Desligado",
};
/** As chaves de teste fora do ambiente de teste sem ser o deploy de produção (`motivoDaProducao`): sem afirmar o deploy. */
const SO_NAS_PREVIAS_FORA_DO_DEPLOY = "Chaves configuradas, mas aqui conta como produção: o teste do pagamento roda nas prévias";

function conexao(mp: SituacaoMercadoPago, env: NodeJS.ProcessEnv): string {
  if (producaoSemChaves(mp, env)) return TEXTO_PRODUCAO_SEM_CHAVES;
  const texto = mp.situacao === "so_nas_previas" && !deployDeProducao(env) ? SO_NAS_PREVIAS_FORA_DO_DEPLOY : CONEXAO[mp.situacao];
  return mp.motivo ? `${texto}: ${mp.motivo}` : texto;
}

function contaDeTeste(mp: SituacaoMercadoPago): string {
  if (mp.situacao !== "teste") return "Não conferida: só é conferida no ambiente de teste, nas prévias.";
  if (mp.contaDeTeste === true) return "Conferida no Mercado Pago: é uma conta de teste.";
  if (mp.contaDeTeste === false) return "A conta das chaves NÃO é de teste: nenhuma cobrança é feita até trocar as chaves.";
  return "Não deu para conferir agora no Mercado Pago: nenhuma cobrança é feita até conferir.";
}

/** Onde roda; na produção, se é o deploy de produção ou se só conta como produção (sem afirmar um deploy que não é). */
const ONDE: Record<AmbienteDoSistema | MotivoDaProducao, string> = {
  previa: "prévia da Vercel",
  desenvolvimento: "computador de desenvolvimento",
  deploy: "deploy de produção",
  vercel_inesperado: "conta como produção (VERCEL_ENV inesperado, nem preview nem development)",
  node_env_producao: "conta como produção (fora da Vercel, com NODE_ENV=production)",
  producao: "conta como produção",
};

/**
 * MERCADOPAGO_AMBIENTE e onde o sistema está rodando (o teste só roda fora do deploy de produção), pela mesma regra do
 * pagamento (`ambienteDoSistema`, M7.12): um VERCEL_ENV inesperado, ou fora da Vercel com NODE_ENV=production, conta
 * como produção, como no pagamento — e a linha diz que só conta como produção, sem chamar de deploy de produção.
 */
export function textoAmbiente(env: NodeJS.ProcessEnv): string {
  const a = ambienteMercadoPago(env.MERCADOPAGO_AMBIENTE);
  const mp = a === "teste" ? "teste" : a === "producao" ? "produção (travado nesta fase)" : "valor inválido em MERCADOPAGO_AMBIENTE (desligado)";
  return `${mp} · ${ONDE[motivoDaProducao(env) ?? ambienteDoSistema(env)]}`;
}

/** Prefixo de uma chave do Mercado Pago (TEST- ou APP_USR-); null quando falta ou é outro (nunca a chave). */
const prefixoDaChave = (v: string | undefined): "TEST" | "APP_USR" | null => {
  const t = v?.trim() ?? "";
  return t.startsWith("TEST-") ? "TEST" : t.startsWith("APP_USR-") ? "APP_USR" : null;
};

/**
 * A chave pública (do formulário do cartão, M8.2b) e o token parecem de contas ou ambientes diferentes? Pelo prefixo
 * só (TEST- de um lado, APP_USR- do outro): com o par trocado, o Mercado Pago recusa todo cartão.
 */
export function chavesDesencontradas(env: NodeJS.ProcessEnv): boolean {
  const publica = prefixoDaChave(env.MERCADOPAGO_PUBLIC_KEY);
  const token = prefixoDaChave(env.MERCADOPAGO_ACCESS_TOKEN);
  return publica !== null && token !== null && publica !== token;
}

/**
 * Integrações → Mercado Pago (M8.2a): a mesma situação que Sistema mostra (`situacaoDoMercadoPago`), em detalhe, e o
 * endereço fixo do aviso assinado para configurar no painel do Mercado Pago. Nunca mostra chave nem segredo. Cartão
 * (M8.2b): avisa quando a chave pública e o token parecem de contas ou ambientes diferentes.
 */
export function MercadoPagoIntegracao({ mp, env }: { mp: SituacaoMercadoPago; env: NodeJS.ProcessEnv }) {
  // Fora do deploy de produção (prévia ou computador), o Mercado Pago não alcança este endereço.
  const naPrevia = ambienteDeTeste(env);
  const linhas: [string, string][] = [
    ["Conexão", conexao(mp, env)],
    ["Conta de teste", contaDeTeste(mp)],
    ["Ambiente", textoAmbiente(env)],
    ["Segredo do webhook", mp.segredoWebhook ? "Configurado (MERCADOPAGO_WEBHOOK_SECRET)" : "Falta MERCADOPAGO_WEBHOOK_SECRET: todo aviso do Mercado Pago é recusado"],
    ["Formulário do cartão", env.MERCADOPAGO_PUBLIC_KEY?.trim() ? "Usa a chave pública (MERCADOPAGO_PUBLIC_KEY)" : "Falta MERCADOPAGO_PUBLIC_KEY: o cartão não é oferecido (o Pix não depende dela)"],
    ["Último aviso válido", mp.ultimoAvisoValidoEm ? quando(mp.ultimoAvisoValidoEm) : "Nenhum recebido ainda"],
    ["Assinaturas recusadas hoje", String(mp.assinaturasRecusadasHoje)],
  ];
  return (
    <section aria-label="Mercado Pago" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Mercado Pago (pagamento no site)</h2>
      <dl style={{ display: "grid", gridTemplateColumns: "minmax(160px, max-content) 1fr", gap: "6px 16px", margin: 0 }}>
        {linhas.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {chavesDesencontradas(env) && (
        <p role="alert" className={styles.alerta} style={{ margin: 0 }}>
          A chave pública e o token do Mercado Pago parecem ser de contas ou ambientes diferentes: o cartão vai recusar todos os pagamentos.
        </p>
      )}
      <div className={styles.linha} style={{ alignItems: "center" }}>
        <span style={{ fontSize: "0.875rem" }}>
          Endereço do aviso (webhook) para configurar no Mercado Pago: <code>{mp.enderecoWebhook}</code>
        </span>
        <BotaoCopiar texto={mp.enderecoWebhook} rotulo="Copiar endereço" className={styles.pequeno} />
      </div>
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>
        No painel do Mercado Pago (Suas integrações → Webhooks), use este endereço, marque só o evento &ldquo;Order (Mercado Pago)&rdquo; e copie a
        assinatura secreta para a variável MERCADOPAGO_WEBHOOK_SECRET na Vercel.
      </p>
      {naPrevia && (
        <p role="note" className={styles.alerta} style={{ margin: 0 }}>
          O aviso só chega no endereço de produção; aqui use Conferir agora (na reserva, em Financeiro → Pagamentos do site ou em Configurações →
          Pagamento no site).
        </p>
      )}
    </section>
  );
}
