/**
 * Para os testes do ícone da aba (M7.18): o começo de um PNG fictício — a assinatura e o bloco IHDR com a largura e a
 * altura pedidas, e zeros depois (só o cabeçalho conta para a conferência do ícone).
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
