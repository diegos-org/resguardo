/** Aritmética de centavos compartilhada pelo financeiro (M4.2) e pelos preços do marketplace (M12.1). */

/** Divide `total` centavos em partes proporcionais aos pesos, sem perder nem criar centavo. */
export function ratear(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (soma === 0) return pesos.map(() => 0);
  const exatos = pesos.map((p) => (total * p) / soma);
  const partes = exatos.map((x) => Math.trunc(x));
  let resto = total - partes.reduce((a, b) => a + b, 0);
  const ordem = exatos.map((x, i) => [Math.abs(x - Math.trunc(x)), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of ordem) {
    if (resto === 0) break;
    const passo = Math.sign(resto);
    partes[i] += passo;
    resto -= passo;
  }
  return partes;
}

/** Percentual em centavos: base × pontos-base / 10000, meio centavo para cima (em módulo). */
export function comissao(base: number, bp: number): number {
  const bruto = base * bp;
  return Math.sign(bruto) * Math.floor((Math.abs(bruto) + 5000) / 10000);
}
