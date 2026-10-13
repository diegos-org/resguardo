import { formatBRL } from "@/lib/money";
import { type ItemDoRepasse, type PrevisaoRepasse, separarAntecipado } from "@/repasses/repasses";

/** Uma parte que fica fora do repasse: positiva tira do repasse ("−"); negativa (um valor segurado que espera) soma ("+"). */
const fora = (rotulo: string, v: number): [string, string][] => (v ? [[`${v > 0 ? "−" : "+"} ${rotulo}`, formatBRL(Math.abs(v))]] : []);

/** Os números do acerto de um proprietário no mês (Financeiro → Repasses): a conta do crédito até o valor do repasse. */
export function linhasDosNumeros(p: PrevisaoRepasse, itensDoFechamento: readonly ItemDoRepasse[]): [string, string][] {
  // Os adiantamentos já estão no saldo do acerto: "a receber" os soma de volta para mostrar a conta.
  const [saldo, descontado, contestado] = p.repasse ? [p.repasse.saldo, p.repasse.descontado, p.repasse.contestado] : [p.saldo, p.aDescontar, p.contestado];
  // M8.2c: o antecipado junta noites de meses seguintes, desconto de cancelamento e estorno de parte nunca paga: um por linha.
  const a = p.repasse ? separarAntecipado(p.repasse.antecipado, itensDoFechamento, p.repasse.mes) : p.antecipadoSeparado;
  return [
    ["Crédito do proprietário até o fim do mês (antes dos descontos)", formatBRL(saldo + descontado + contestado)],
    ["− Adiantamentos descontados", formatBRL(descontado)],
    ["Contestados (não descontados)", formatBRL(contestado)],
    // M8.2e: o que fica fora pelo motivo (`foraDividido`, a mesma divisão do e-mail; no mês fechado, a daquele instante),
    // cada um com o sinal dele: a parte presa por disputa e o valor segurado que espera junto nunca viram "dinheiro ainda
    // não com a empresa".
    ...fora("Fora do fechamento (dinheiro ainda não com a empresa)", p.foraDividido.outras),
    ...fora("Fora do fechamento (reserva em conferência: disputa do pagamento)", p.foraDividido.presa),
    ...fora("Valor segurado pela disputa do pagamento, fora deste repasse (espera junto com a parte da reserva)", p.foraDividido.seguradoJunto),
    ...(a.noites ? ([["+ Noites de meses seguintes já disponíveis (adiantamento)", formatBRL(a.noites)]] as [string, string][]) : []),
    ...(a.desconto ? ([["− Desconto de reserva cancelada com devolução ao hóspede (parte já repassada)", formatBRL(-a.desconto)]] as [string, string][]) : []),
    ...(a.estorno ? ([["− Estorno de parte de reserva cancelada antes de ser repassada (anula a parte no crédito)", formatBRL(-a.estorno)]] as [string, string][]) : []),
    ...(a.disputa ? ([[`${a.disputa < 0 ? "−" : "+"} Disputa do pagamento (valor segurado ou devolvido)`, formatBRL(Math.abs(a.disputa))]] as [string, string][]) : []),
  ];
}

export function NumerosDoRepasse({ p, itensDoFechamento }: { p: PrevisaoRepasse; itensDoFechamento: ItemDoRepasse[] }) {
  const itens = linhasDosNumeros(p, itensDoFechamento);
  return (
    <dl style={{ display: "flex", gap: "8px 24px", flexWrap: "wrap", margin: 0 }}>
      {itens.map(([k, v]) => (
        <div key={k}>
          <dt style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>{k}</dt>
          <dd style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
