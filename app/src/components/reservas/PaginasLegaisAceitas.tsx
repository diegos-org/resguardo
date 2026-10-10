import { DOCUMENTOS_LEGAIS, PAGINAS_LEGAIS } from "@/configuracoes/paginas-legais-texto";
import type { AceiteSite } from "@/site/aceites";

const quando = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const ORIGEM = { pix: "ao gerar o Pix", cartao: "ao pagar com cartão" } as const;

/**
 * Ficha da reserva → "Páginas legais aceitas" (M7.4): cada aceite que o hóspede marcou no site, do mais novo ao mais
 * antigo, com a versão de cada documento (link para ela no site) e quando. Mostra também o aceite gravado sem um Pix
 * que deu certo (ex.: o teto de Pix ou uma falha do Mercado Pago depois de marcar a caixa).
 */
export function PaginasLegaisAceitas({ aceites }: { aceites: readonly AceiteSite[] }) {
  if (!aceites.length) return null;
  return (
    <section aria-label="Páginas legais aceitas" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Páginas legais aceitas</h2>
      <p style={{ margin: 0, color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>
        O que o hóspede marcou no site antes de pagar: que leu e aceita os Termos de uso e a Política de cancelamento e que leu a Política de privacidade, em cada versão. Cada
        tentativa de pagamento no site mostra o aceite com que foi criada; a devolução segue a Política de cancelamento dessa versão.
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.875rem", display: "flex", flexDirection: "column", gap: 4 }}>
        {aceites.map((a) => (
          <li key={a.id}>
            {DOCUMENTOS_LEGAIS.map((doc, i) => (
              <span key={doc}>
                {i > 0 && " · "}
                <a href={`${PAGINAS_LEGAIS[doc].rota}?versao=${a.versoes[doc]}`} target="_blank" rel="noopener noreferrer">
                  {PAGINAS_LEGAIS[doc].titulo} (versão {a.versoes[doc]})
                </a>
              </span>
            ))}
            {` — ${quando(a.aceitoEm)}, ${ORIGEM[a.origem]}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
