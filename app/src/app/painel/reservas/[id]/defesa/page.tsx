import { notFound } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { BotaoImprimir } from "@/components/reservas/BotaoImprimir";
import { DocumentoLegal } from "@/components/site/DocumentoLegal";
import { getDb } from "@/db/client";
import { documentosParaDefesa } from "@/pagamentos/contestacao-tela";

function Linhas({ linhas }: { linhas: readonly [string, string][] }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "minmax(160px, max-content) 1fr", gap: "4px 16px", margin: 0 }}>
      {linhas.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt style={{ color: "var(--scl-texto-2)" }}>{k}</dt>
          <dd style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Ficha da reserva → "Documentos para a defesa" (M8.2e; desenho "Painel"): uma página para imprimir (ou salvar em PDF pelo
 * navegador) e enviar pelo painel do Mercado Pago, montada na hora e nunca gravada — o resumo da reserva, o pagamento de
 * cada disputa (ids, data, forma, verificação do banco; o valor pago só para quem lê o financeiro), a Política de cancelamento que o hóspede aceitou (versão, horário e
 * texto), a lista da portaria (quando o imóvel exige) e o que a equipe junta por fora. Só para quem edita a reserva ou o
 * financeiro; reserva de outra empresa ou sem disputa = não encontrada.
 */
export default async function DocumentosParaDefesa({ params }: PageProps<"/painel/reservas/[id]/defesa">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "reserva:editar") && !podeFazer(sessao.papel, "financeiro:editar")) notFound();
  const { id } = await params;
  // O valor pago só para quem lê o financeiro (como a ficha): a operação abre a página para mandar os documentos, sem valores.
  const d = await documentosParaDefesa(getDb(), sessao.organizacaoId, id, { verValores: podeFazer(sessao.papel, "financeiro:ler") && sessao.papel !== "proprietario" });
  if (!d) notFound();
  return (
    <article aria-label="Documentos para a defesa" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 16 }}>
      <h1>Documentos para a defesa</h1>
      <p style={{ margin: 0, color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>
        Montada agora a partir do que o sistema tem; nada desta página é guardado. Imprima ou salve em PDF e envie pelo painel do Mercado Pago, junto com o que a
        equipe junta por fora (abaixo). Depois, marque &ldquo;Documentos enviados&rdquo; no quadro da disputa.
      </p>
      <div className={styles.acoes}>
        <BotaoImprimir />
        <a href={`/painel/reservas/${id}`}>Voltar para a reserva</a>
      </div>
      <section aria-label="A reserva">
        <h2 style={{ fontSize: "1.125rem" }}>A reserva</h2>
        <Linhas linhas={d.reserva} />
      </section>
      {d.pagamentos.map((p) => (
        <section key={p.titulo} aria-label={`Pagamento: ${p.titulo}`}>
          <h2 style={{ fontSize: "1.125rem" }}>Pagamento: {p.titulo}</h2>
          <Linhas linhas={p.linhas} />
        </section>
      ))}
      <section aria-label="Política de cancelamento aceita">
        <h2 style={{ fontSize: "1.125rem" }}>Política de cancelamento aceita</h2>
        {d.politica ? (
          <>
            <p style={{ margin: 0 }}>
              <strong>{d.politica.titulo}.</strong> {d.politica.quando}
            </p>
            {d.politica.resumo && <DocumentoLegal blocos={d.politica.resumo} />}
            <DocumentoLegal blocos={d.politica.blocos} />
          </>
        ) : (
          <p style={{ margin: 0 }}>Pagamento feito sem a política aceita no site (anterior às páginas legais): junte a conversa em que as condições foram combinadas.</p>
        )}
      </section>
      {d.portaria && (
        <section aria-label="Portaria">
          <h2 style={{ fontSize: "1.125rem" }}>Portaria</h2>
          <p style={{ margin: 0 }}>{d.portaria}</p>
        </section>
      )}
      <section aria-label="O que juntar por fora">
        <h2 style={{ fontSize: "1.125rem" }}>O que juntar por fora (o sistema não guarda)</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {d.porFora.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
