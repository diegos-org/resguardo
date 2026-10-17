/**
 * Telefones do WhatsApp (M10.1a, desenho na seção "Vínculo" de `requisitos/product/WHATSAPP.md`): puro, sem banco, sem
 * rede e sem relógio. Uma regra só para comparar o `wa_id` de uma conversa (já com DDI, só dígitos) com um telefone
 * digitado num cadastro (texto livre: reserva, pedido de contato, cadastro do site, proprietário, representante) e com
 * outro `wa_id` (o parser casa `from` com `contacts[].wa_id`, e o histórico decide a direção pelo número da empresa).
 *
 * Celular brasileiro: o mesmo número aparece com e sem o nono dígito (cadastros antigos e `wa_id` de contas antigas), por
 * isso um celular vira duas chaves, e há candidato quando as duas listas têm alguma chave em comum. Estrangeiro só casa
 * com DDI explícito ("+" ou "00"): sem ele, 11 dígitos são lidos como um número brasileiro. O nome do perfil nunca é
 * sinal (`requisitos/operations/ORIENTACOES-OPERACIONAIS.md`, "Data da mensagem, identidade e desfecho"). Nada aqui
 * registra o telefone em lugar nenhum.
 */

/** DDI explícito: 6 a 20 dígitos, sem zero na frente (nenhum código de país começa com 0). */
const INTERNACIONAL = /^[1-9]\d{5,19}$/;
/**
 * A forma do `wa_id`: só dígitos, 6 a 20. A mesma da saída do parser (`whatsapp/aviso.ts` só tira o "+" e confere com
 * esta) e do CHECK `whatsapp_contatos_wa_id_digitos` da 0073: um `wa_id` guardado sempre tem chave.
 */
export const FORMA_WA_ID = /^\d{6,20}$/;

/** Chaves de um número brasileiro sem o 55 (DDD + 8 ou 9 dígitos). [] = não dá para comparar. */
function chavesDoBrasil(nacional: string): string[] {
  if (!/^\d{10,11}$/.test(nacional)) return [];
  const ddd = Number(nacional.slice(0, 2));
  if (ddd < 11 || ddd > 99) return [];
  const numero = nacional.slice(2);
  const com9 = (oito: string) => [`55${nacional.slice(0, 2)}9${oito}`, `55${nacional.slice(0, 2)}${oito}`];
  // Celular de 9 dígitos começando com 9: as duas formas (com e sem o nono dígito).
  if (numero.length === 9) return numero.startsWith("9") ? com9(numero.slice(1)) : [];
  // 8 dígitos: celular antigo (6 a 9) ganha as duas formas; fixo (2 a 5) fica com uma.
  if (/^[6-9]/.test(numero)) return com9(numero);
  if (/^[2-5]/.test(numero)) return [`55${nacional}`];
  return [];
}

/**
 * Chaves comparáveis (só dígitos, com DDI) de um telefone digitado em cadastro (texto livre). [] = não dá para comparar.
 * - Com "+" ou "00" na frente: DDI explícito; DDI diferente de 55 vale como veio (estrangeiro).
 * - Sem eles: zeros à esquerda saem (o 0 do DDD); 10 ou 11 dígitos são Brasil, 12 ou 13 começando com 55 também;
 *   outro tamanho não compara.
 * - Brasil: DDD de 11 a 99; celular (9 dígitos começando com 9, ou o antigo de 8 começando com 6 a 9) → duas chaves;
 *   fixo (8 dígitos começando com 2 a 5) → uma.
 */
export function chavesDeTelefone(texto: string): string[] {
  if (typeof texto !== "string") return [];
  const t = texto.trim();
  const digitos = t.replace(/\D/g, "");
  if (!digitos) return [];
  const internacional = t.startsWith("+") ? digitos : digitos.startsWith("00") ? digitos.slice(2) : null;
  if (internacional !== null) {
    if (!INTERNACIONAL.test(internacional)) return [];
    return internacional.startsWith("55") ? chavesDoBrasil(internacional.slice(2)) : [internacional];
  }
  const semZeros = digitos.replace(/^0+/, "");
  if (semZeros.length === 10 || semZeros.length === 11) return chavesDoBrasil(semZeros);
  if ((semZeros.length === 12 || semZeros.length === 13) && semZeros.startsWith("55")) return chavesDoBrasil(semZeros.slice(2));
  return [];
}

/**
 * Chaves de um `wa_id` (já vem com DDI, só dígitos): brasileiro (55 + 12 ou 13 dígitos) ganha as variantes de
 * `chavesDeTelefone`; qualquer outro, ou um brasileiro que a regra não reconhece, só ele mesmo. Fora de `FORMA_WA_ID`
 * (letra, "+", tamanho): [].
 */
export function chavesDoWaId(waId: string): string[] {
  if (typeof waId !== "string" || !FORMA_WA_ID.test(waId)) return [];
  if (waId.startsWith("55") && (waId.length === 12 || waId.length === 13)) {
    const br = chavesDoBrasil(waId.slice(2));
    if (br.length) return br;
  }
  return [waId];
}

/** As duas listas têm alguma chave em comum? */
export const temChaveEmComum = (a: readonly string[], b: readonly string[]): boolean => a.some((k) => b.includes(k));

/** Os 8 últimos dígitos (iguais com e sem o nono dígito): pré-filtro em SQL antes da conferência pelas chaves. */
export const ultimos8 = (chave: string): string => chave.slice(-8);

/** Para a tela: "+55 21 99999-0000" (ou "+55 21 9999-0000", sem o nono dígito); estrangeiro: "+" e os dígitos. */
export function formatarWaId(waId: string): string {
  const d = typeof waId === "string" ? waId.replace(/\D/g, "") : "";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13) && chavesDoBrasil(d.slice(2)).length) {
    const ddd = d.slice(2, 4);
    const numero = d.slice(4);
    return `+55 ${ddd} ${numero.slice(0, -4)}-${numero.slice(-4)}`;
  }
  return `+${d}`;
}
