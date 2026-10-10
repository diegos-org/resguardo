import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { listarAjustes } from "@/ajustes/ajustes";
import styles from "@/components/painel/painel.module.css";
import { getDb } from "@/db/client";

/** Porta de entrada do Financeiro. O dashboard com números e gráficos chega no M4.6. */
export default async function Financeiro() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "financeiro:ler")) redirect("/painel");
  const pendentes = await listarAjustes(getDb(), sessao.organizacaoId, { pendentes: true, ...(sessao.papel === "proprietario" ? { imovelIds: [...sessao.imovelIds] } : {}) });
  return (
    <>
      <h1>Financeiro</h1>
      <section className={styles.cartao}>
        <h2>Ajustes e divergências</h2>
        <p>
          {pendentes.length ? `${pendentes.length} ajuste(s) pendente(s) de esclarecimento.` : "Nenhum ajuste pendente."}{" "}
          <Link href="/painel/financeiro/ajustes">Abrir</Link>
        </p>
      </section>
      {sessao.papel !== "proprietario" && (
        <section className={styles.cartao}>
          <h2>Repasses aos proprietários</h2>
          <p>
            Fechamento do mês no dia do fechamento (padrão dia 2; Configurações → Repasses): valor a transferir, Pix para copiar e marcar pago. <Link href="/painel/financeiro/repasses">Abrir</Link>
          </p>
        </section>
      )}
      {sessao.papel !== "proprietario" && (
        <section className={styles.cartao}>
          <h2>Pagamentos do site</h2>
          <p>
            Cada Pix gerado no site (em teste), com a situação no Mercado Pago, a liberação e o que pede atenção (pagamento sem reserva a devolver,
            devolução pendente). <Link href="/painel/financeiro/pagamentos-site">Abrir</Link>
          </p>
        </section>
      )}
      <section className={styles.cartao}>
        <h2>Despesas</h2>
        <p>
          Despesas da empresa e dos proprietários. <Link href="/painel/despesas">Abrir</Link>
        </p>
      </section>
      <p className={styles.muted}>O painel com os números do mês (ocupação, receitas, comissões, alertas) chega no item M4.6.</p>
    </>
  );
}
