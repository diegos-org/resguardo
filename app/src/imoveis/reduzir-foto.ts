/**
 * Redução da foto no navegador, antes de subir (M7.3): a foto do celular (4 a 12 MB) vira uma grande (maior lado 2000
 * px) e uma pequena (800 px), em JPG. Assim cada envio fica bem abaixo do limite de tamanho do pedido na Vercel e o site
 * carrega rápido. A orientação da câmera é respeitada; o fundo de PNG transparente fica branco.
 */
import { LADO_FOTO, LADO_MINIATURA, LIMITE_FOTO, LIMITE_MINIATURA, medidasReduzidas } from "./fotos-regras";

export class ErroFoto extends Error {}

/** Tentativas, da melhor para a mais leve: [fração do lado, qualidade do JPG]. */
const TENTATIVAS: readonly (readonly [number, number])[] = [
  [1, 0.85],
  [1, 0.72],
  [0.75, 0.72],
  [0.5, 0.7],
];

async function comprimir(img: ImageBitmap, lado: number, limite: number): Promise<Blob> {
  for (const [fracao, qualidade] of TENTATIVAS) {
    const { largura, altura } = medidasReduzidas(img.width, img.height, Math.round(lado * fracao));
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ErroFoto("Este navegador não conseguiu preparar a foto: tente outro navegador.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largura, altura);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, largura, altura);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", qualidade));
    if (blob && blob.size <= limite) return blob;
  }
  throw new ErroFoto("A foto continua grande demais mesmo reduzida: tente outra.");
}

export async function reduzirFoto(arquivo: File): Promise<{ grande: Blob; pequena: Blob }> {
  let img: ImageBitmap;
  try {
    img = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    throw new ErroFoto("Não foi possível ler esta foto: use JPG ou PNG.");
  }
  try {
    return { grande: await comprimir(img, LADO_FOTO, LIMITE_FOTO), pequena: await comprimir(img, LADO_MINIATURA, LIMITE_MINIATURA) };
  } finally {
    img.close();
  }
}

/** Nome do arquivo que sobe: o original com a extensão .jpg (a foto reduzida é sempre JPG). */
export const nomeJpg = (nome: string) => `${nome.replace(/\.[a-z0-9]{1,5}$/i, "") || "foto"}.jpg`;
