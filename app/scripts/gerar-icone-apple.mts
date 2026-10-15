// Gera public/marca-180.png (M7.18): a marca do estudo (public/marca.png, 160 × 160 px) ampliada para 180 × 180 px, o
// tamanho do atalho na tela do iPhone. É a mesma imagem, sem nada desenhado por cima; o arquivo gerado fica no
// repositório, e o site e o painel o usam pelos ícones de `src/site/icone.ts`.
//
// Roda à mão, uma vez, só quando a marca do estudo mudar:  npx tsx scripts/gerar-icone-apple.mts  (dentro de app/).
// Usa a biblioteca de imagens que já vem instalada com o Next (sharp), com o filtro lanczos3 e o PNG sem metadados.
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ORIGEM = fileURLToPath(new URL("../public/marca.png", import.meta.url));
const DESTINO = fileURLToPath(new URL("../public/marca-180.png", import.meta.url));
const LADO = 180;

const info = await sharp(ORIGEM).resize(LADO, LADO, { kernel: "lanczos3", fit: "fill" }).png({ compressionLevel: 9 }).toFile(DESTINO);
console.log(`Gerado ${DESTINO}: ${info.width} × ${info.height} px, ${info.size} bytes.`);
