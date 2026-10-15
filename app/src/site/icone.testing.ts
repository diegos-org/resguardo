/**
 * Para os testes do ícone da aba (M7.18): o começo de um PNG fictício — a assinatura e o bloco IHDR com a largura e a
 * altura pedidas, e zeros depois (só o cabeçalho conta para as medidas).
 */
export function cabecalhoPng(largura: number, altura: number, tamanho = 33): Uint8Array {
  const b = new Uint8Array(tamanho);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  v.setUint32(16, largura);
  v.setUint32(20, altura);
  return b;
}

/** Tipos de cor do PNG (byte 25, no IHDR): 0 cinza, 2 cores, 3 paleta, 4 cinza com transparência, 6 cores com transparência. */
export type TipoDeCor = 0 | 2 | 3 | 4 | 6;

/**
 * Um PNG fictício com a estrutura de blocos que a conferência do ícone lê: a assinatura, o IHDR (medidas e tipo de cor),
 * os blocos pedidos antes da imagem (`antes`: nome e tamanho dos dados, zerados), o IDAT e o IEND. Os códigos de
 * conferência dos blocos ficam zerados: só a estrutura conta.
 */
export function pngFicticio(largura: number, altura: number, { tipoDeCor = 2, antes = [] }: { tipoDeCor?: TipoDeCor; antes?: { nome: string; tamanho: number }[] } = {}): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, largura);
  new DataView(ihdr.buffer).setUint32(4, altura);
  ihdr.set([8, tipoDeCor, 0, 0, 0], 8);
  const blocos = [{ nome: "IHDR", dados: ihdr }, ...antes.map((a) => ({ nome: a.nome, dados: new Uint8Array(a.tamanho) })), { nome: "IDAT", dados: new Uint8Array(10) }, { nome: "IEND", dados: new Uint8Array() }];
  const b = new Uint8Array(8 + blocos.reduce((t, x) => t + 12 + x.dados.length, 0));
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const v = new DataView(b.buffer);
  let i = 8;
  for (const { nome, dados } of blocos) {
    v.setUint32(i, dados.length);
    b.set([...nome].map((c) => c.charCodeAt(0)), i + 4);
    b.set(dados, i + 8);
    i += 12 + dados.length;
  }
  return b;
}
