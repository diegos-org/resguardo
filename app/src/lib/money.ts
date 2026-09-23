/** Valores monetários são sempre centavos inteiros (ROADMAP: regras técnicas). */
export type Cents = number;

export function assertCents(value: number): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Valor em centavos inválido: ${value}`);
  }
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: Cents): string {
  assertCents(cents);
  return brl.format(cents / 100).replace(/ /g, " ");
}
