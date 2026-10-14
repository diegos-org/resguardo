/**
 * Páginas pessoais e de uso interno fora dos buscadores (M7.10), num lugar só: o `next.config.ts` lê esta lista e manda
 * o cabeçalho `X-Robots-Tag` em toda resposta desses endereços — páginas, PDFs, os redirecionamentos de quem ainda não
 * entrou e as páginas de erro. Cabeçalho, e não robots.txt: o buscador precisa abrir o endereço para ler que não pode
 * listá-lo (um "Disallow" esconderia o aviso e o endereço ainda poderia aparecer, sem conteúdo, pelos links de fora).
 *
 * Não decide nada sobre as páginas públicas (início, casas, consulta, página para proprietários, páginas legais, fotos
 * do site): se o site aparece no Google é decisão de Diego, que entra com o mapa do site. Sem imports: o
 * `next.config.ts` lê este arquivo direto, sem passar pelo "@/".
 */

/** O mesmo pedido do protótipo aprovado (`prototipos/scl-publico/src/server.mjs`): não listar nem seguir os links. */
export const NAO_LISTAR = { key: "X-Robots-Tag", value: "noindex, nofollow" };

/**
 * Um endereço fora dos buscadores, no formato do `next.config.ts`: só o caminho, ou o caminho com uma condição na
 * consulta do endereço (`has`), quando a mesma página é pública sem ela e pessoal com ela.
 */
export type EnderecoForaDosBuscadores = string | { source: string; has: { type: "query"; key: string }[] };

/**
 * Endereços fora dos buscadores, no formato do `next.config.ts`. `:path*` casa o próprio endereço e tudo abaixo dele
 * (`/painel`, `/painel/` e `/painel/reservas/...`), sem pegar vizinhos (`/painelx`).
 */
export const PAGINAS_FORA_DOS_BUSCADORES: readonly EnderecoForaDosBuscadores[] = [
  // Painel interno da equipe.
  "/painel/:path*",
  // Tela da equipe de limpeza.
  "/equipe/:path*",
  // Portal do proprietário, com o relatório e o comprovante do repasse em PDF.
  "/portal/:path*",
  // Entrada da equipe e dos proprietários.
  "/entrar/:path*",
  // Link pessoal do convite do proprietário.
  "/convite/:path*",
  // Minha reserva e a entrada do hóspede.
  "/hospede/:path*",
  // Cotação de cada hóspede, onde ele paga.
  "/reservar/:path*",
  // Etapas do cadastro do proprietário no marketplace (a página /anunciar continua pública).
  "/anunciar/dados/:path*",
  "/anunciar/enviado/:path*",
  // A etapa do código do mesmo cadastro (`/anunciar?etapa=codigo&email=...`): mostra o e-mail da pessoa, que vai também
  // no endereço. Só com o e-mail na consulta; a /anunciar sem ele continua pública.
  { source: "/anunciar", has: [{ type: "query", key: "email" }] },
  // Endereços do sistema: login, rotinas, aviso do Mercado Pago, saúde e dados do calendário do site.
  "/api/:path*",
];

/** Uma regra de cabeçalho do `next.config.ts`. */
export type RegraForaDosBuscadores = { source: string; has?: { type: "query"; key: string }[]; headers: { key: string; value: string }[] };

/** As regras de cabeçalho do `next.config.ts` para os endereços acima. */
export function regrasForaDosBuscadores(): RegraForaDosBuscadores[] {
  return PAGINAS_FORA_DOS_BUSCADORES.map((e) =>
    typeof e === "string" ? { source: e, headers: [{ ...NAO_LISTAR }] } : { source: e.source, has: e.has.map((h) => ({ ...h })), headers: [{ ...NAO_LISTAR }] },
  );
}
