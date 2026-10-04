/** Resposta HTTP de um arquivo guardado no banco (comprovante): tipo conferido, nome seguro, sem cache compartilhado. */
import { TIPOS_COMPROVANTE } from "./repasses";

export function respostaDoArquivo(a: { nome: string; tipo: string; conteudo: Buffer } | null): Response {
  if (!a) return new Response("Não encontrado.", { status: 404 });
  const tipo = (TIPOS_COMPROVANTE as readonly string[]).includes(a.tipo) ? a.tipo : "application/octet-stream";
  const nome = a.nome.replace(/[^\w.\-]+/g, "_").slice(0, 100) || "comprovante";
  return new Response(new Uint8Array(a.conteudo), {
    headers: { "Content-Type": tipo, "Content-Disposition": `inline; filename="${nome}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
