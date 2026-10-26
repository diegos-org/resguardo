/**
 * Fonte de preços por imóvel (M3.9; "só disponibilidade" no M3.11b). Puro: sem banco, roda também no navegador.
 *
 * A escolha define a direção do fluxo de preços entre o SCL e o Beds24 e vale para o site, a
 * cotação e o marketplace. Com "scl", "beds24" e "manual", o calendário (mínimos, máximos e bloqueios)
 * é sempre do SCL; só os preços mudam de dono. Com "so_disponibilidade" (requisitos/product/SO-DISPONIBILIDADE.md),
 * o SCL envia ao Beds24 só os bloqueios feitos no SCL: preço, estadia mínima e máxima ficam no Beds24 e o SCL só
 * lê. O desconto do site (M12.1) é aplicado por cima do valor cheio seja qual for a fonte.
 */
export const FONTES_PRECOS = ["scl", "beds24", "manual", "so_disponibilidade"] as const;
export type FontePrecos = (typeof FONTES_PRECOS)[number];

export const NOMES_FONTE_PRECOS: Record<FontePrecos, string> = {
  scl: "Preços automáticos do SCL",
  beds24: "Preços definidos no Beds24 (pelo proprietário ou pela ferramenta dele)",
  manual: "Preços digitados no cadastro, sem ajustes automáticos",
  so_disponibilidade: "Só disponibilidade: o SCL envia só os bloqueios; preço e regras de venda ficam no Beds24",
};

/** Em linguagem simples, para o painel e o portal. */
export const EXPLICACAO_FONTE_PRECOS: Record<FontePrecos, string> = {
  scl: "O SCL calcula a diária de cada noite (preço base, períodos, eventos, feriadões, última hora e pisos) e envia ao Beds24, que repassa ao Airbnb e ao Booking. O site vende pelo mesmo preço, com o desconto do site por cima.",
  beds24: "O preço de cada noite é o que está no Beds24, definido pelo proprietário ou pela ferramenta de precificação dele. O SCL só lê e nunca escreve preço; calendário, mínimos e bloqueios continuam vindo do SCL. Noite sem preço lido fica indisponível para venda no site, nunca com um palpite. O preço inteligente do Airbnb não entra aqui: só vale o que estiver no Beds24.",
  manual: "Vale exatamente o preço base e os períodos do cadastro, sem eventos, feriadões e última hora do SCL e sem os limites mínimo e máximo do preço dinâmico. O SCL envia esses preços ao Beds24. A edição pelo próprio proprietário, no portal, chega com o M12.4.",
  so_disponibilidade: "O SCL manda ao Beds24 só o que fechou e reabriu no SCL. Preço, estadia mínima e máxima ficam no Beds24 (pelo proprietário ou pela ferramenta dele); o SCL só lê. O site e a cotação vendem pelo preço e pelas regras lidas do Beds24; noite sem leitura recente fica indisponível para venda, nunca com um palpite.",
};

/**
 * Um só ponto decide "o preço desta fonte é o lido do Beds24" (o SCL nunca envia preço): o motor, o site e as telas
 * leem daqui. Vale para "beds24" (M3.9) e "so_disponibilidade" (M3.11b); nas outras o preço é do SCL.
 */
export const precoLidoDoBeds24 = (fonte: FontePrecos): boolean => fonte === "beds24" || fonte === "so_disponibilidade";

/**
 * As mesmas fontes como o proprietário as vê no portal (M5.9, decisão de Diego em 7/10: o Beds24 fica nos
 * bastidores — nenhum texto para proprietário ou hóspede o cita, nem os dados que vão ao navegador dele). O portal
 * recebe a fonte já convertida (`fontePrecosDoPortal`); o painel continua com os nomes acima.
 */
export type FontePrecosPortal = "scl" | "ferramenta" | "manual" | "so_disponibilidade";
export const fontePrecosDoPortal = (f: FontePrecos): FontePrecosPortal => (f === "beds24" ? "ferramenta" : f);

export const NOMES_FONTE_PRECOS_PORTAL: Record<FontePrecosPortal, string> = {
  scl: "Preços automáticos da SCL",
  ferramenta: "Preços definidos por você ou pela sua ferramenta de preços",
  manual: "Preços digitados no cadastro, sem ajustes automáticos",
  so_disponibilidade: "Só a disponibilidade pelo nosso sistema",
};

export const EXPLICACAO_FONTE_PRECOS_PORTAL: Record<FontePrecosPortal, string> = {
  scl: "Nosso sistema calcula a diária de cada noite (preço base, períodos, eventos, feriadões, última hora e pisos) e a envia aos canais (Airbnb e Booking). O site vende pelo mesmo preço, com o desconto do site por cima.",
  ferramenta: "O preço de cada noite é o que você ou a sua ferramenta de preços definem; nosso sistema só lê esse preço e nunca o muda. Calendário, estadias mínimas e bloqueios continuam com o nosso sistema. Noite sem preço lido fica indisponível para venda no site, nunca com um palpite. O preço inteligente do Airbnb não entra aqui.",
  manual: "Vale exatamente o preço base e os períodos do cadastro, sem eventos, feriadões e última hora e sem os limites mínimo e máximo do preço dinâmico. Nosso sistema envia esses preços aos canais (Airbnb e Booking).",
  so_disponibilidade: "Nosso sistema só fecha e reabre datas nos canais. Preço, estadia mínima e máxima ficam com você ou com a sua ferramenta de preços. O site vende pelo preço e pelas regras que você definiu; noite sem leitura recente fica indisponível, nunca com um palpite.",
};

/** Só disponibilidade no portal (M3.11b, desenho §6): nenhum período do proprietário — nada dele seria enviado. */
export const PERIODO_SO_DISPONIBILIDADE_PORTAL = "Com só disponibilidade, preço e estadia mínima ficam com você ou com a sua ferramenta: aqui você só fecha e reabre datas.";

export const fontePrecosValida = (v: string): v is FontePrecos => (FONTES_PRECOS as readonly string[]).includes(v);
