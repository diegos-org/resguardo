import type { NextRequest } from "next/server";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { relatorioDoPainel } from "@/relatorios/gerar";
import { LIMITE_EXTRATO, LIMITE_FOTO } from "@/relatorios/pdf";
import { respostaDoRelatorio } from "@/relatorios/resposta";

async function bytes(v: FormDataEntryValue | null, limite: number): Promise<Uint8Array | null | "grande"> {
  if (!v || typeof v === "string" || v.size === 0) return null;
  if (v.size > limite) return "grande";
  return new Uint8Array(await v.arrayBuffer());
}

/** Gera o PDF do painel (M5.3). Erro de preenchimento volta para a tela com a mensagem. */
export async function POST(req: NextRequest, ctx: RouteContext<"/painel/proprietarios/[id]/relatorio/pdf">) {
  const { id } = await ctx.params;
  const voltar = (erro: string) => Response.redirect(new URL(`/painel/proprietarios/${encodeURIComponent(id)}/relatorio?erro=${encodeURIComponent(erro)}`, req.nextUrl.origin), 303);
  // Só formulário do próprio sistema.
  const origem = req.headers.get("origin");
  if (origem && origem !== req.nextUrl.origin) return new Response("Origem não permitida.", { status: 403 });
  const sessao = await obterSessao();
  if (!sessao) return new Response("Acesso negado.", { status: 403 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return voltar("Não foi possível ler o envio: os arquivos podem ser grandes demais (até 2 MB cada).");
  }
  const foto = await bytes(form.get("foto"), LIMITE_FOTO);
  const extrato = await bytes(form.get("extrato"), LIMITE_EXTRATO);
  if (foto === "grande") return voltar("A foto passa de 2 MB: use uma versão menor.");
  if (extrato === "grande") return voltar("O extrato passa de 2 MB: exporte só o período do mês.");
  const paginas = form.get("paginas");
  const r = await relatorioDoPainel(getDb(), sessao, id, {
    mes: String(form.get("mes") ?? ""),
    imoveis: form.getAll("imovel").filter((v): v is string => typeof v === "string"),
    anexos: { foto, extrato: extrato ? { bytes: extrato, paginas: typeof paginas === "string" ? paginas : "" } : null },
  });
  if (!r.ok && r.status === 400) return voltar(r.erro);
  return respostaDoRelatorio(r);
}
