import { ambienteDeTeste } from "@/sistema/ambiente";

/**
 * Texto da faixa (M7.12). Fixo, como os outros rótulos de interface: diz em que ambiente a pessoa está, não é conteúdo do
 * site. Só afirma o que o código garante sempre que a faixa aparece — não é o deploy de produção, e o pagamento ali é
 * desligado ou só o de teste do Mercado Pago (`pagamentos/ambiente.ts`). Não diz "dados fictícios" nem "banco separado":
 * isso é a configuração das prévias (conferida em 3/10 e 14/10, registrada no guia), que o código não confere.
 */
export const TEXTO_FAIXA_PREVIA = "Prévia de teste · não é o site de verdade · nenhuma cobrança real";

/**
 * Faixa fina no topo de todas as páginas (site, páginas do hóspede, portais, painel e as telas de erro e de "não
 * encontrada"), só no ambiente de teste — as prévias da Vercel, o `vercel dev` e o computador de desenvolvimento —, pela
 * mesma regra do pagamento (`ambienteDeTeste`). No deploy de produção não aparece. Fica no layout raiz, um lugar só, lido
 * no servidor: as telas de erro (componentes de cliente) aparecem dentro dele e ficam com a faixa.
 *
 * Visual do estudo aprovado (`prototipos/acervo-visual-2026-10/site-publico`, `.preview`; DESIGN.md, "Faixa fina acima
 * quando for prévia privada"); estilo `.scl-previa` em globals.css. Nada focável: o "Pular para o conteúdo" das molduras
 * continua o primeiro elemento do Tab.
 */
export function FaixaPrevia() {
  if (!ambienteDeTeste()) return null;
  return (
    <p className="scl-previa" role="note">
      {TEXTO_FAIXA_PREVIA}
    </p>
  );
}
