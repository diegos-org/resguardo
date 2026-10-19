import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { MercadoPagoIntegracao } from "@/components/configuracoes/MercadoPagoIntegracao";
import { TestarBeds24 } from "@/components/configuracoes/TestarBeds24";
import { dataHoraNoFuso } from "@/lib/datas";
import { situacaoDoMercadoPago } from "@/pagamentos/integracao";
import { NOME_MERCADO_PAGO, NOME_SENTRY, NOME_WHATSAPP, situacaoServicos } from "@/sistema/servicos";
import { ambienteDeTeste } from "@/sistema/ambiente";
import { WhatsappIntegracao } from "@/components/configuracoes/WhatsappIntegracao";
import { situacaoDoWhatsapp } from "@/whatsapp/integracao";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { imoveis } from "@/db/schema";
import { lerConfigBeds24, listarMapeamentosBeds24 } from "@/beds24/configuracao";
import { ultimasSincronizacoes } from "@/beds24/sincronizacao";
import { SincronizarBeds24 } from "@/components/configuracoes/SincronizarBeds24";
import { painelReservasBeds24 } from "@/beds24/reservas-site-painel";
import { ReservasSiteBeds24 } from "@/components/configuracoes/ReservasSiteBeds24";

export const maxDuration = 300;

const ONDE: Record<string, string> = {
  "Banco de dados (Neon)": "DATABASE_URL",
  "Login com Google": "AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET",
  "E-mail do sistema (Resend)": "RESEND_API_KEY, EMAIL_REMETENTE",
  Beds24:
    "BEDS24_REFRESH_TOKEN (recomendado) ou BEDS24_API_KEY (token direto, só leitura). Envio de calendário/preços só com BEDS24_ESCRITA=ligada (o refresh token precisa do escopo de inventário). Reservas do site no Beds24 só com BEDS24_ESCRITA_RESERVAS=ligada, independente da outra, e só no deploy de produção: o convite novo pede exatamente leitura e escrita em bookings, leitura em bookings-personal, bookings-financial e properties e leitura e escrita em inventory, e nada além: qualquer outro escopo (escrita ou all em bookings-personal, all, apagar ou outra área) conta como a mais. O refresh token de escrita vai só no ambiente Production da Vercel; na Preview, só a BEDS24_API_KEY de leitura.",
  [NOME_MERCADO_PAGO]:
    "MERCADOPAGO_PUBLIC_KEY, MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_AMBIENTE (teste): só no ambiente Preview da Vercel. MERCADOPAGO_WEBHOOK_SECRET: em Preview e Production (o aviso chega no endereço de produção).",
  [NOME_SENTRY]: "NEXT_PUBLIC_SENTRY_DSN, em Production e Preview (é o endereço de envio do projeto no Sentry, público).",
  [NOME_WHATSAPP]:
    "WHATSAPP_VERIFY_TOKEN (pelo menos 32 caracteres, gerado só para isso) e WHATSAPP_APP_SECRET: só no ambiente Production da Vercel. WHATSAPP_RECEBIMENTO=ligada, que só o Diego liga. Os ids da Meta (conta e número) ficam aqui, em WhatsApp, no banco do sistema.",
};

export default async function Integracoes() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const db = getDb();
  const org = sessao.organizacaoId;
  // A mesma função que Sistema lê (uma regra, um lugar).
  const mercadoPago = await situacaoDoMercadoPago(db);
  const [config, mapas, locais, execucoes, reservasNoBeds24, whatsapp] = await Promise.all([
    lerConfigBeds24(db, org), listarMapeamentosBeds24(db, org),
    db.select({ id: imoveis.id, codigo: imoveis.codigo }).from(imoveis).where(and(eq(imoveis.organizacaoId, org), eq(imoveis.ativo, true))).orderBy(asc(imoveis.codigo)),
    ultimasSincronizacoes(db, org),
    // M8.3a: só leitura do banco e do ambiente; os escopos da credencial vêm por um botão (e só no deploy de produção).
    painelReservasBeds24(db, org, process.env),
    // M10.1a: a mesma função que Sistema lê; o quadro recebe só a situação e se é prévia, nunca o ambiente.
    situacaoDoWhatsapp(db, org, process.env, new Date()),
  ]);
  const servicos = situacaoServicos(process.env, null, mercadoPago, whatsapp);
  return (
    <>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
        Chaves e senhas nunca ficam no painel nem no Git: elas vão nas variáveis de ambiente da Vercel (Projeto → Settings → Environment
        Variables). Depois de mudar uma variável, é preciso publicar de novo (Redeploy) para valer. O resto de cada integração — como
        imóveis ligados ao Beds24 — é editado nas telas do sistema.
      </p>
      <div className={styles.rolagem}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Integração</th>
              <th>Para que serve</th>
              <th>Situação</th>
              <th>Variáveis na Vercel</th>
            </tr>
          </thead>
          <tbody>
            {servicos.map((s) => (
              <tr key={s.nome}>
                <td>{s.nome}</td>
                <td>{s.paraQue}</td>
                <td>{s.detalhe}</td>
                <td style={{ fontSize: "0.8125rem" }}>{ONDE[s.nome] ?? "chega com a integração"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MercadoPagoIntegracao mp={mercadoPago} env={process.env} />
      <WhatsappIntegracao w={whatsapp} naPrevia={ambienteDeTeste(process.env)} />
      <TestarBeds24 />
      <SincronizarBeds24 config={config} mapas={mapas} imoveis={locais} execucoes={execucoes.map(e => ({ id: e.id, quando: dataHoraNoFuso(e.iniciadoEm), situacao: e.situacao, resumo: e.resumo, divergencias: e.divergencias }))} />
      <ReservasSiteBeds24 p={reservasNoBeds24} />
    </>
  );
}
