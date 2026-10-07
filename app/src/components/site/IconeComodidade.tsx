/**
 * Ícones das comodidades do cadastro (M7.6), em traço fino como no estudo visual. Comodidade sem ícone (texto livre)
 * aparece só como texto, nunca com um ícone genérico.
 */
const TRACOS: Record<string, string> = {
  "Wi-Fi": "M2 8.5a15 15 0 0 1 20 0 M5 12a10 10 0 0 1 14 0 M8.5 15.5a5 5 0 0 1 7 0 M12 19h.01",
  "Ar-condicionado": "M4 8h16v7H4z M7 11h10 M7 18v3 M12 18v3 M17 18v3",
  "Cozinha equipada": "M5 3v7q0 3 3 3v8 M8 3v7 M11 3v7q0 3-3 3 M19 3v18 M19 3q-5 7 0 10",
  "Máquina de lavar": "M4 3h16v18H4z M4 7h16 M7 5h.01 M10 5h.01 M16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  Secadora: "M4 3h16v18H4z M4 7h16 M7 5h.01 M16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M10.5 12.5q1.5 1.5 0 3 M13.5 12.5q1.5 1.5 0 3",
  "Smart TV": "M3 5h18v13H3z M8 22h8 M12 18v4",
  "Área de trabalho": "M5 5h14v9H5z M2 18h20 M9 18v-4 M15 18v-4",
  Elevador: "M4 2h16v20H4z M8 10l4-4 4 4 M8 14l4 4 4-4",
  "Portaria 24h": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18 M12 7v5l3 2",
  Garagem: "M3 11l2-5h14l2 5v6H3z M7 17v3 M17 17v3 M7 13h.01 M17 13h.01",
  Piscina: "M2 19q2.5-2 5 0t5 0 5 0 5 0 M8 15V5a2 2 0 0 1 4 0 M16 15V5a2 2 0 0 0-4 0 M8 8h8 M8 11.5h8",
  "Vista para o mar": "M2 18q2.5-2 5 0t5 0 5 0 5 0 M7 13a5 5 0 0 1 10 0 M12 3v2 M4.5 6.5l1.4 1.4 M19.5 6.5l-1.4 1.4",
  Varanda: "M3 21h18 M3 13h18 M5 13v8 M9 13v8 M15 13v8 M19 13v8 M7 13V4h10v9",
  Berço: "M4 5v15 M20 5v15 M4 9h16 M4 17h16 M8 9v8 M12 9v8 M16 9v8",
  "Ferro de passar": "M3 18h16a2 2 0 0 0 2-2v-5h-9a9 9 0 0 0-9 7z M10 11V7h8",
  "Secador de cabelo": "M13 9a5 5 0 1 1-10 0 5 5 0 0 1 10 0 M13 7h8v4h-8 M6 14l-1 7h3l1.5-6.5",
  "Roupa de cama e banho": "M5 4h14v16H5z M5 9h14 M9 14h6",
  Cafeteira: "M5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z M17 11h1.5a2 2 0 0 1 0 4H17 M8 3.5v2 M11 3.5v2 M14 3.5v2",
};

/** Ordem dos ícones no cartão da casa: o que mais pesa na escolha primeiro. */
const PRIORIDADE = ["Ar-condicionado", "Cozinha equipada", "Wi-Fi", "Máquina de lavar", "Vista para o mar", "Varanda", "Smart TV", "Área de trabalho", "Piscina", "Garagem", "Elevador", "Portaria 24h"];

export const temIcone = (comodidade: string) => comodidade in TRACOS;

/** Até `n` comodidades com ícone, na ordem de prioridade (as outras ficam para a página do imóvel). */
export function comodidadesDoCartao(comodidades: readonly string[], n = 4): string[] {
  const com = comodidades.filter(temIcone);
  return [...com].sort((a, b) => (PRIORIDADE.indexOf(a) + 1 || 99) - (PRIORIDADE.indexOf(b) + 1 || 99)).slice(0, n);
}

export function IconeComodidade({ nome, className }: { nome: string; className?: string }) {
  const d = TRACOS[nome];
  if (!d) return null;
  return (
    <svg className={className} role="img" aria-label={nome} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <title>{nome}</title>
      <path d={d} />
    </svg>
  );
}
