/**
 * Endereço da página de uma casa com os critérios da estadia (M7.9): a busca em todas as casas e a troca de casa no
 * cartão "Planeje sua estadia" levam à página da casa já com as datas e as pessoas. Usa os nomes do contrato de links já
 * divulgado (`checkin`, `checkout`, `guests`), que a página lê como os do site. Só entra o que tem o formato certo; o
 * resto (e qualquer outro parâmetro) fica de fora — a página confere tudo de novo no servidor.
 *
 * Sem dependência de servidor: é usado também no navegador (troca de casa).
 */
const CODIGO = /^[\w-]{1,40}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const PESSOAS = /^\d{1,2}$/;

export type CriteriosDaEstadia = { entrada?: string; saida?: string; hospedes?: string };

/** null quando o código não é de uma casa (ex.: "Todas as casas", valor vazio). */
export function linkDaCasa(codigo: string, c: CriteriosDaEstadia = {}): string | null {
  if (!CODIGO.test(codigo)) return null;
  const q = new URLSearchParams();
  if (c.entrada && DATA.test(c.entrada)) q.set("checkin", c.entrada);
  if (c.saida && DATA.test(c.saida)) q.set("checkout", c.saida);
  if (c.hospedes && PESSOAS.test(c.hospedes)) q.set("guests", c.hospedes);
  const base = `/imoveis/${encodeURIComponent(codigo)}`;
  return q.size ? `${base}?${q}` : base;
}
