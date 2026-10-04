/**
 * Fonte de preços por imóvel (M3.9). Puro: sem banco, roda também no navegador.
 *
 * A escolha define a direção do fluxo de preços entre o SCL e o Beds24 e vale para o site, a
 * cotação e o marketplace. O calendário (mínimos, máximos e bloqueios) é sempre do SCL, em
 * qualquer opção; só os preços mudam de dono. O desconto do site (M12.1) é aplicado por cima
 * do valor cheio seja qual for a fonte.
 */
export const FONTES_PRECOS = ["scl", "beds24", "manual"] as const;
export type FontePrecos = (typeof FONTES_PRECOS)[number];

export const NOMES_FONTE_PRECOS: Record<FontePrecos, string> = {
  scl: "Preços automáticos do SCL",
  beds24: "Preços definidos no Beds24 (pelo proprietário ou pela ferramenta dele)",
  manual: "Preços digitados no cadastro, sem ajustes automáticos",
};

/** Em linguagem simples, para o painel e o portal. */
export const EXPLICACAO_FONTE_PRECOS: Record<FontePrecos, string> = {
  scl: "O SCL calcula a diária de cada noite (preço base, períodos, eventos, feriadões, última hora e pisos) e envia ao Beds24, que repassa ao Airbnb e ao Booking. O site vende pelo mesmo preço, com o desconto do site por cima.",
  beds24: "O preço de cada noite é o que está no Beds24, definido pelo proprietário ou pela ferramenta de precificação dele. O SCL só lê e nunca escreve preço; calendário, mínimos e bloqueios continuam vindo do SCL. Noite sem preço lido fica indisponível para venda no site, nunca com um palpite. O preço inteligente do Airbnb não entra aqui: só vale o que estiver no Beds24.",
  manual: "Vale exatamente o preço base e os períodos do cadastro, sem eventos, feriadões e última hora do SCL. O SCL envia esses preços ao Beds24. A edição pelo próprio proprietário, no portal, chega com o M12.4.",
};

export const fontePrecosValida = (v: string): v is FontePrecos => (FONTES_PRECOS as readonly string[]).includes(v);
