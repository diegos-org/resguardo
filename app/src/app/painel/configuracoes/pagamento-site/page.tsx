import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormPagamentoSite } from "@/components/configuracoes/FormPagamentoSite";
import styles from "@/components/formularios.module.css";
import { FormAcaoPagamento } from "@/components/pagamentos/FormAcaoPagamento";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { CARACTERES_VISIVEIS_FATURA, CATEGORIA_TAXA_PERDIDA, LIMITE_NOME_FATURA, lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { getDb } from "@/db/client";
import { listarCategorias } from "@/despesas/categorias";
import { conferirAgoraAcao, salvarConfigPagamentoSiteAcao } from "@/pagamentos/acoes-painel";
import { motivosPorImovel } from "@/pagamentos/oferta";

/** Configurações → Pagamento no site (M8.2a): regras de venda do pagamento, a lista de imóveis e o "Conferir agora". */
export default async function PagamentoNoSite() {
  const sessao = await exigirSessaoPainel();
  // Regras da empresa toda: só a equipe interna que lê o financeiro.
  if (!podeFazer(sessao.papel, "financeiro:ler") || sessao.papel === "proprietario") redirect("/painel/configuracoes");
  const db = getDb();
  const org = sessao.organizacaoId;
  const [config, categorias, imoveis, empresa] = await Promise.all([lerConfigPagamentoSite(db, org), listarCategorias(db, org), motivosPorImovel(db, org), nomeDaEmpresa(db, org)]);
  const editar = podeFazer(sessao.papel, "financeiro:editar");
  return (
    <>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
        Pagamento da reserva direta no site pelo Mercado Pago (nesta fase, só Pix e só em teste, nas prévias da Vercel: nenhuma cobrança real). As chaves e o
        ambiente ficam em <Link href="/painel/configuracoes/integracoes">Integrações</Link>; o que vale a cada Pix está aqui. Cada mudança fica no histórico e
        vale para as tentativas novas.
      </p>
      <FormPagamentoSite
        config={config}
        categorias={categorias.map((c) => ({ id: c.id, nome: c.nome }))}
        nomeEmpresa={empresa}
        limiteNome={LIMITE_NOME_FATURA}
        visiveis={CARACTERES_VISIVEIS_FATURA}
        categoriaPadrao={CATEGORIA_TAXA_PERDIDA}
        editar={editar}
        salvar={salvarConfigPagamentoSiteAcao}
      />
      <section aria-label="Imóveis do site" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: "1.0625rem", fontWeight: 500, margin: 0 }}>Imóveis do site</h2>
        <p style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)", margin: 0 }}>
          O Pix só aparece quando o cálculo do financeiro fecha sem pendência (contrato de gestão vigente, um proprietário, a empresa recebendo do site).
          Conferido aqui para uma entrada hoje; cada pedido é conferido de novo na data de entrada dele.
        </p>
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
                    <td>{i.oferece ? <span aria-label="oferece o Pix">✓</span> : <span style={{ color: "var(--scl-erro-texto)" }}>{i.texto}</span>}</td>
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
            aprovados sem taxa ou liberação, devoluções pedidas).
          </p>
          <FormAcaoPagamento acao={conferirAgoraAcao} rotulo="Conferir agora" nome="Conferir agora todos os pendentes" />
        </section>
      )}
    </>
  );
}
