/**
 * Esqueleto dos e-mails da casa (M5.7, `requisitos/product/RELATORIO-MENSAL.md` → "E-mails e WhatsApp — a mesma
 * família"): saudação pelo primeiro nome, uma frase dizendo o que é a mensagem, um destaque (o número ou a data que
 * importa), lista curta do que a pessoa precisa saber, próximo passo ou onde ver mais, assinatura curta. Sai em texto
 * (o WhatsApp usa esta versão) e em HTML simples com a mesma ordem: faixa verde-floresta com a marca, fundo papel, serifa
 * só no título, uma tabela quando há valores, botão quando há link; sem imagens. Os modelos editáveis em Configurações
 * continuam valendo: eles entram como a frase e as linhas; o que se fixa aqui é a ordem e o tom.
 */
import { TEMA } from "@/relatorios/tema";

export type EsqueletoEmail = {
  /** Nome da empresa (marca na faixa e na assinatura). */
  empresa: string;
  /** Nome de quem recebe; só o primeiro nome vai na saudação. */
  nome: string;
  /** Uma frase dizendo o que é a mensagem ("Segue o fechamento de outubro."). Pode ter mais de um parágrafo (linha em branco). */
  frase: string;
  /** O que importa: valor e data, código da reserva. */
  destaque?: { rotulo: string; valor: string; nota?: string } | null;
  /** Até cinco linhas do que a pessoa precisa saber ou fazer. */
  linhas?: readonly string[];
  /** Pares rótulo/valor (tabela simples no HTML, lista no texto). */
  valores?: readonly { rotulo: string; valor: string }[];
  /** Próximo passo ou onde ver mais ("O relatório completo está anexo."). */
  proximoPasso?: string;
  /** Botão/link quando houver (portal). */
  link?: { texto: string; url: string } | null;
  /** Assinatura curta; padrão "Equipe {empresa}". */
  assinatura?: string;
  /** Contato ao fim ("Qualquer dúvida, é só responder este e-mail."). */
  contato?: string;
};

export type EmailMontado = { texto: string; html: string };

export const primeiroNome = (n: string): string => n.trim().split(/\s+/)[0] ?? "";

/** O modelo editável já começa cumprimentando ("Olá, {nome}.")? Então a saudação automática não entra (seria dupla). */
export const comecaComSaudacao = (frase: string): boolean => /^\s*(olá|ola|oi|bom dia|boa tarde|boa noite|prezad[oa]s?|car[oa]s?)(?=[^\p{L}\p{N}]|$)/iu.test(frase);

/** Texto seguro dentro de HTML. */
export function escaparHtml(t: string): string {
  return t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const paragrafos = (t: string) => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const limite = <T>(xs: readonly T[] | undefined, n: number) => (xs ?? []).slice(0, n);

/** Monta a versão em texto e a em HTML, na mesma ordem. */
export function montarEmail(e: EsqueletoEmail): EmailMontado {
  const nome = primeiroNome(e.nome);
  const saudacao = comecaComSaudacao(e.frase) ? "" : nome ? `Olá, ${nome}.` : "Olá.";
  const linhas = limite(e.linhas, 5).filter((l) => l.trim());
  const valores = (e.valores ?? []).filter((v) => v.rotulo.trim());
  const assinatura = e.assinatura?.trim() || `Equipe ${e.empresa}`;
  const contato = e.contato?.trim() || "Qualquer dúvida, é só responder este e-mail.";

  const texto = [
    ...(saudacao ? [saudacao, ""] : []),
    ...paragrafos(e.frase).flatMap((p) => [p, ""]),
    ...(e.destaque ? [`${e.destaque.rotulo}: ${e.destaque.valor}${e.destaque.nota ? ` (${e.destaque.nota})` : ""}`, ""] : []),
    ...(valores.length ? [...valores.map((v) => `${v.rotulo}: ${v.valor}`), ""] : []),
    ...(linhas.length ? [...linhas.map((l) => `- ${l}`), ""] : []),
    ...(e.proximoPasso ? [e.proximoPasso, ""] : []),
    ...(e.link ? [`${e.link.texto}: ${e.link.url}`, ""] : []),
    contato,
    "",
    assinatura,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const h = escaparHtml;
  const C = TEMA;
  const p = (t: string, extra = "") => `<p style="margin:0 0 12px;font:15px/1.5 Helvetica,Arial,sans-serif;color:${C.tinta};${extra}">${h(t)}</p>`;
  const html = [
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${h(e.empresa)}</title></head>`,
    `<body style="margin:0;padding:0;background:${C.papel};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.papel};"><tr><td align="center" style="padding:24px 12px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.branco};border:1px solid ${C.borda};">`,
    `<tr><td style="background:${C.floresta};border-bottom:2px solid ${C.dourado};padding:16px 24px;font:italic 20px Georgia,'Times New Roman',serif;color:${C.creme};">${h(e.empresa)}</td></tr>`,
    `<tr><td style="padding:24px;">`,
    // Sem saudação automática, o primeiro parágrafo do modelo é o título (ele já cumprimenta).
    ...(saudacao ? [`<h1 style="margin:0 0 16px;font:normal 22px/1.3 Georgia,'Times New Roman',serif;color:${C.profundo};">${h(saudacao)}</h1>`, ...paragrafos(e.frase).map((t) => p(t))] : paragrafos(e.frase).map((t, i) => (i === 0 ? `<h1 style="margin:0 0 16px;font:normal 22px/1.3 Georgia,'Times New Roman',serif;color:${C.profundo};">${h(t)}</h1>` : p(t)))),
    ...(e.destaque
      ? [
          `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-left:3px solid ${C.dourado};background:${C.creme};"><tr><td style="padding:12px 16px;">`,
          `<div style="font:12px Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${C.texto2};">${h(e.destaque.rotulo)}</div>`,
          `<div style="font:26px/1.2 Georgia,'Times New Roman',serif;color:${C.profundo};">${h(e.destaque.valor)}</div>`,
          ...(e.destaque.nota ? [`<div style="font:13px Helvetica,Arial,sans-serif;color:${C.texto2};">${h(e.destaque.nota)}</div>`] : []),
          `</td></tr></table>`,
        ]
      : []),
    ...(valores.length
      ? [
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font:14px/1.5 Helvetica,Arial,sans-serif;color:${C.tinta};">`,
          ...valores.map((v) => `<tr><td style="padding:6px 0;border-bottom:1px solid ${C.areia};color:${C.texto2};">${h(v.rotulo)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid ${C.areia};white-space:nowrap;">${h(v.valor)}</td></tr>`),
          `</table>`,
        ]
      : []),
    ...(linhas.length ? [`<ul style="margin:0 0 16px;padding-left:20px;font:15px/1.5 Helvetica,Arial,sans-serif;color:${C.tinta};">`, ...linhas.map((l) => `<li style="margin:0 0 4px;">${h(l)}</li>`), `</ul>`] : []),
    ...(e.proximoPasso ? [p(e.proximoPasso)] : []),
    ...(e.link
      ? [`<p style="margin:8px 0 20px;"><a href="${h(e.link.url)}" style="display:inline-block;background:${C.musgo};color:${C.creme};text-decoration:none;font:600 14px Helvetica,Arial,sans-serif;padding:10px 18px;border-radius:4px;">${h(e.link.texto)}</a></p>`]
      : []),
    p(contato, `color:${C.texto2};font-size:14px;`),
    p(assinatura, `margin:0;color:${C.texto2};font-size:14px;`),
    `</td></tr></table></td></tr></table></body></html>`,
  ].join("\n");
  return { texto, html };
}
