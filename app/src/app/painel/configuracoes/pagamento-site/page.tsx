import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormPagamentoSite } from "@/components/configuracoes/FormPagamentoSite";
import styles from "@/components/formularios.module.css";
import { FormAcaoPagamento } from "@/components/pagamentos/FormAcaoPagamento";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { CARACTERES_VISIVEIS_FATURA, CATEGORIA_TAXA_PERDIDA, LIMITE_NOME_FATURA, lerConfigPagamentoSite, TEXTOS_TRES_DS } from "@/configuracoes/pagamento-site";
import { getDb } from "@/db/client";
import { listarCategorias } from "@/despesas/categorias";
import { ESPERA_TELA_MS, esperarNoMaximo } from "@/lib/prazo";
import { conferirAgoraAcao, religarCartaoAcao, salvarConfigPagamentoSiteAcao } from "@/pagamentos/acoes-painel";
import { CARTOES_POR_HORA_NA_ORGANIZACAO, MAXIMO_CARTAO_POR_COTACAO } from "@/pagamentos/andamento";
import {
  DESLIGADO_POR_MS,
  type DisjuntorAberto,
  disjuntorAberto,
  JANELA_RECUSAS_MS,
  RECUSAS_PARA_DESLIGAR,
  RECUSAS_PARA_DESLIGAR_24H,
  recusasNasUltimas24h,
  ultimosDisparos,
} from "@/pagamentos/disjuntor";
import { LIMITES_PAGAMENTO } from "@/pagamentos/limites";
import { motivosPorImovel, podeCobrar, TEXTO_SEM_COBRANCA } from "@/pagamentos/oferta";
import { MODOS_TRES_DS, PARCELAS_MAXIMAS } from "@/pagamentos/provedor";

const FUSO = "America/Sao_Paulo";
const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" });
const nota = { fontSize: "0.8125rem", color: "var(--scl-texto-2)", margin: 0 } as const;

/** O estado do cartão em palavras: ligado, desligado no painel ou desligado pelo disjuntor (até quando e por quê). */
function estadoDoCartao(ligado: boolean, d: DisjuntorAberto | null): string {
  if (d) {
    if (d.ate) return `Desligado pelo disjuntor até ${hora(d.ate)} — ${d.recusas} recusas em 30 minutos. O Pix continua.`;
    return `Desligado até alguém religar — ${d.recusas} recusas em ${d.janela === "24h" ? "24 horas" : "30 minutos, pela terceira vez no dia"}. O Pix continua.`;
  }
  return ligado ? "Ligado" : "Desligado (marque “Oferecer cartão de crédito” acima)";
}

/**
 * Configurações → Pagamento no site (M8.2a): regras de venda do pagamento, a lista de imóveis e o "Conferir agora". No
 * cartão (M8.2b), o disjuntor de recusas: situação, recusas das últimas 24 horas, os últimos disparos, os limites (fixos,
 * só para ler) e o "Religar o cartão" com confirmação, para quem edita o financeiro.
 */
export default async function PagamentoNoSite() {
  const sessao = await exigirSessaoPainel();
  // Regras da empresa toda: só a equipe interna que lê o financeiro.
  if (!podeFazer(sessao.papel, "financeiro:ler") || sessao.papel === "proprietario") redirect("/painel/configuracoes");
  const db = getDb();
  const org = sessao.organizacaoId;
  const agora = new Date();
  const [config, categorias, imoveis, empresa, disjuntor, recusas24h, disparos, gate] = await Promise.all([
    lerConfigPagamentoSite(db, org),
    listarCategorias(db, org),
    motivosPorImovel(db, org),
    nomeDaEmpresa(db, org),
    disjuntorAberto(db, org, agora),
    recusasNasUltimas24h(db, org, agora),
    ultimosDisparos(db, org, 5),
    // As travas de hoje (ambiente, chaves, a chave do painel e a conta de teste): sem elas, nenhum imóvel oferece o pagamento.
    // A conta é conferida no Mercado Pago: a tela espera no máximo alguns segundos (null = não deu para conferir agora;
    // a conferência continua no fundo e fica lembrada para a próxima vez). A chave para desligar nunca fica presa.
    esperarNoMaximo(
      podeCobrar(db, org).catch(() => ({ ok: false as const, motivo: "conta_nao_conferida" as const, texto: TEXTO_SEM_COBRANCA.conta_nao_conferida })),
      ESPERA_TELA_MS,
      null,
    ),
  ]);
  const editar = podeFazer(sessao.papel, "financeiro:editar");
  return (
    <>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
        Pagamento da reserva direta no site pelo Mercado Pago, por Pix e cartão de crédito (nesta fase, só em teste, nas prévias da Vercel: nenhuma
        cobrança real). As chaves e o ambiente ficam em <Link href="/painel/configuracoes/integracoes">Integrações</Link>; o que vale a cada pagamento está
        aqui. Cada mudança fica no histórico e vale para as tentativas novas.
      </p>
      <FormPagamentoSite
        config={config}
        categorias={categorias.map((c) => ({ id: c.id, nome: c.nome }))}
        nomeEmpresa={empresa}
        limiteNome={LIMITE_NOME_FATURA}
        visiveis={CARACTERES_VISIVEIS_FATURA}
        categoriaPadrao={CATEGORIA_TAXA_PERDIDA}
        parcelasLimite={PARCELAS_MAXIMAS}
        opcoesTresDS={MODOS_TRES_DS.map((m) => ({ valor: m, texto: TEXTOS_TRES_DS[m] }))}
        editar={editar}
        salvar={salvarConfigPagamentoSiteAcao}
      />
      <section aria-label="Cartão de crédito" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: "1.0625rem", fontWeight: 500, margin: 0 }}>Cartão de crédito</h2>
        <p role="status" style={{ margin: 0, color: disjuntor ? "var(--scl-erro-texto)" : undefined }}>
          <strong>{estadoDoCartao(config.cartao && config.oferecer, disjuntor)}</strong>
        </p>
        <p style={nota}>
          Recusas que contaram no disjuntor nas últimas 24 horas: <strong>{recusas24h}</strong>.
        </p>
        <p style={nota}>
          Freios (fixos): o cartão desliga sozinho por {DESLIGADO_POR_MS / 60_000} minutos com {RECUSAS_PARA_DESLIGAR} recusas em{" "}
          {JANELA_RECUSAS_MS / 60_000} minutos, e até alguém religar com {RECUSAS_PARA_DESLIGAR_24H} recusas em 24 horas ou no terceiro disparo do dia; até{" "}
          {MAXIMO_CARTAO_POR_COTACAO} tentativas por cotação, {CARTOES_POR_HORA_NA_ORGANIZACAO} por hora na empresa toda e {LIMITES_PAGAMENTO.cartao.origem.tentativas} por
          endereço de internet por hora. O Pix nunca é afetado. Contam as recusas do banco ou da análise de risco e as verificações do banco não concluídas;
          dados do cartão vencidos e falhas do Mercado Pago não contam.
        </p>
        {disparos.length > 0 && (
          <div className={styles.rolagem}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Desligou em</th>
                  <th>Recusas</th>
                  <th>Até</th>
                </tr>
              </thead>
              <tbody>
                {disparos.map((d) => (
                  <tr key={d.id}>
                    <td>{quando(d.abertoEm)}</td>
                    <td>
                      {d.recusas} em {d.janela === "24h" ? "24 horas" : "30 minutos"}
                    </td>
                    <td>{d.religadoEm ? `religado em ${quando(d.religadoEm)}` : d.ate ? quando(d.ate) : "até alguém religar"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editar && disjuntor && (
          <FormAcaoPagamento
            acao={religarCartaoAcao}
            rotulo="Religar o cartão"
            nome="Religar o cartão"
            pergunta="Religar o pagamento com cartão agora? Se as recusas eram alguém testando cartões roubados, elas podem voltar: o disjuntor desliga de novo com as próximas."
          />
        )}
      </section>
      <section aria-label="Imóveis do site" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: "1.0625rem", fontWeight: 500, margin: 0 }}>Imóveis do site</h2>
        <p style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)", margin: 0 }}>
          O pagamento (Pix ou cartão) só aparece quando o cálculo do financeiro fecha sem pendência (contrato de gestão vigente, um proprietário, a empresa recebendo do site).
          Conferido aqui para uma entrada hoje; cada pedido é conferido de novo na data de entrada dele.
        </p>
        {gate === null ? (
          <p role="status" style={{ fontSize: "0.8125rem", color: "var(--scl-aviso-texto)", margin: 0 }}>
            Não deu para conferir a conta do Mercado Pago agora (ele demorou a responder): a lista abaixo mostra só o cálculo do financeiro. Recarregue a
            página em instantes.
          </p>
        ) : (
          !gate.ok && (
            <p role="status" style={{ fontSize: "0.8125rem", color: "var(--scl-erro-texto)", margin: 0 }}>
              Hoje o site não oferece o pagamento em nenhum imóvel: {gate.texto}
            </p>
          )
        )}
        {imoveis.length === 0 ? (
          <p>Nenhum imóvel ativo no site público.</p>
        ) : (
          <div className={styles.rolagem}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Pagamento no site</th>
                </tr>
              </thead>
              <tbody>
                {imoveis.map((i) => (
                  <tr key={i.imovelId}>
                    <td>
                      {i.codigo} · {i.nome}
                    </td>
                    <td>
                      {!i.oferece ? (
                        <span style={{ color: "var(--scl-erro-texto)" }}>{i.texto}</span>
                      ) : gate?.ok ? (
                        <span aria-label="oferece o pagamento">✓</span>
                      ) : gate === null ? (
                        <span>cálculo sem pendência (as travas não foram conferidas agora)</span>
                      ) : (
                        <span>cálculo sem pendência (o pagamento aparece quando as travas acima liberarem)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editar && (
        <section aria-label="Conferir pagamentos" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: "1.0625rem", fontWeight: 500, margin: 0 }}>Conferir com o Mercado Pago</h2>
          <p style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)", margin: 0 }}>
            Nas prévias o aviso do Mercado Pago não chega: este botão confere agora todos os pagamentos que esperam alguma resposta (Pix aguardando,
            cartões na verificação do banco ou em análise, aprovados sem taxa ou liberação, devoluções pedidas).
          </p>
          <FormAcaoPagamento acao={conferirAgoraAcao} rotulo="Conferir agora" nome="Conferir agora todos os pendentes" />
        </section>
      )}
    </>
  );
}
