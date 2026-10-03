/** Intervalo da tela de prévia (M3.7a). O plano por noite vem do motor (`motor.ts`). */
import { diasEntre } from "@/imoveis/regras-venda";
import { dataValida } from "@/reservas/regras";

/** Fim inclusivo na tela. Limite de 92 noites para manter a conferência legível. */
export function validarIntervaloPrevia(inicio: string, fim: string): string | null {
  if (!dataValida(inicio) || !dataValida(fim)) return "Informe datas válidas.";
  if (inicio < "2000-01-01" || fim > "2100-12-31") return "Use datas entre 2000 e 2100.";
  if (inicio > fim) return "A última noite precisa ser igual ou posterior à primeira.";
  if (diasEntre(inicio, fim) >= 92) return "Confira até 92 noites por vez.";
  return null;
}
