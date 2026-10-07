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
  manual: "Vale exatamente o preço base e os períodos do cadastro, sem eventos, feriadões e última hora do SCL e sem os limites mínimo e máximo do preço dinâmico. O SCL envia esses preços ao Beds24. A edição pelo próprio proprietário, no portal, chega com o M12.4.",
};

/**
 * As mesmas fontes como o proprietário as vê no portal (M5.9, decisão de Diego em 7/10: o Beds24 fica nos
 * bastidores — nenhum texto para proprietário ou hóspede o cita, nem os dados que vão ao navegador dele). O portal
 * recebe a fonte já convertida (`fontePrecosDoPortal`); o painel continua com os nomes acima.
 */
export type FontePrecosPortal = "scl" | "ferramenta" | "manual";
export const fontePrecosDoPortal = (f: FontePrecos): FontePrecosPortal => (f === "beds24" ? "ferramenta" : f);

export const NOMES_FONTE_PRECOS_PORTAL: Record<FontePrecosPortal, string> = {
  scl: "Preços automáticos da SCL",
  ferramenta: "Preços definidos por você ou pela sua ferramenta de preços",
  manual: "Preços digitados no cadastro, sem ajustes automáticos",
};

export const EXPLICACAO_FONTE_PRECOS_PORTAL: Record<FontePrecosPortal, string> = {
  scl: "Nosso sistema calcula a diária de cada noite (preço base, períodos, eventos, feriadões, última hora e pisos) e a envia aos canais (Airbnb e Booking). O site vende pelo mesmo preço, com o desconto do site por cima.",
  ferramenta: "O preço de cada noite é o que você ou a sua ferramenta de preços definem; nosso sistema só lê esse preço e nunca o muda. Calendário, estadias mínimas e bloqueios continuam com o nosso sistema. Noite sem preço lido fica indisponível para venda no site, nunca com um palpite. O preço inteligente do Airbnb não entra aqui.",
  manual: "Vale exatamente o preço base e os períodos do cadastro, sem eventos, feriadões e última hora e sem os limites mínimo e máximo do preço dinâmico. Nosso sistema envia esses preços aos canais (Airbnb e Booking).",
};

export const fontePrecosValida = (v: string): v is FontePrecos => (FONTES_PRECOS as readonly string[]).includes(v);
