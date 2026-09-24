import type { Resultado } from "./gerar";

/** PDF para baixar, sem cache (dados financeiros de uma pessoa). */
export function respostaDoRelatorio(r: Resultado): Response {
  if (!r.ok) return new Response(r.erro, { status: r.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  return new Response(new Blob([new Uint8Array(r.pdf)], { type: "application/pdf" }), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${r.arquivo}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
