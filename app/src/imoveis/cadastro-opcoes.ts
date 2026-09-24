/** Opções fixas do cadastro completo (usadas também na tela). */
export const TIPOS_CAMA = { casal: "Casal", queen: "Queen", king: "King", solteiro: "Solteiro", sofa_cama: "Sofá-cama", beliche: "Beliche", colchao: "Colchão extra" } as const;
export type TipoCama = keyof typeof TIPOS_CAMA;

export const COMODIDADES = [
  "Wi-Fi",
  "Ar-condicionado",
  "Cozinha equipada",
  "Máquina de lavar",
  "Secadora",
  "Smart TV",
  "Área de trabalho",
  "Elevador",
  "Portaria 24h",
  "Garagem",
  "Piscina",
  "Vista para o mar",
  "Varanda",
  "Berço",
  "Ferro de passar",
  "Secador de cabelo",
  "Roupa de cama e banho",
  "Cafeteira",
] as const;

