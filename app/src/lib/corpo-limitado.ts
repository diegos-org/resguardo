/**
 * Leitura do corpo de um aviso assinado (webhook), com teto de tamanho: comum ao Mercado Pago (M8.2a) e ao WhatsApp
 * (M10.1a), uma regra num lugar só. O teto vale duas vezes: pelo `Content-Length` declarado, antes de começar a ler
 * (valor que não é número é ignorado: a leitura confere), e pela leitura em partes, que para e cancela o resto ao passar
 * do limite (nada além do limite fica guardado). Devolve os bytes crus, exatamente como chegaram: quem confere uma
 * assinatura sobre o corpo precisa deles antes de qualquer decodificação.
 *
 * Nada do corpo nem dos cabeçalhos é registrado aqui.
 */

/** Resposta sem corpo e sem cache (as rotas de aviso nunca devolvem conteúdo, só a situação). */
export const respostaVazia = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store" } });

/**
 * Os bytes crus do corpo, até `limite` bytes. 413 = passou do limite (pelo `Content-Length`, sem começar a ler, ou pela
 * leitura, que para ali); 400 = a leitura lançou (conexão caiu, corpo já lido). Sem corpo = `Buffer` vazio.
 */
export async function lerCorpoLimitado(req: Request, limite: number): Promise<{ ok: true; bytes: Buffer } | { ok: false; status: 400 | 413 }> {
  const declarado = req.headers.get("content-length");
  if (declarado !== null && /^\d+$/.test(declarado.trim()) && Number(declarado) > limite) return { ok: false, status: 413 };
  try {
    if (!req.body) return { ok: true, bytes: Buffer.alloc(0) };
    const leitor = req.body.getReader();
    const partes: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > limite) {
        await leitor.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      partes.push(value);
    }
    return { ok: true, bytes: Buffer.concat(partes) };
  } catch {
    return { ok: false, status: 400 };
  }
}
