"use server";

import { obterSessao } from "@/acesso/sessao-atual";
import { leitorDoAmbiente } from "./http";
import { ErroBeds24 } from "./tipos";

export type ResultadoTesteBeds24 = { ok: boolean; mensagem: string };

/** Teste manual de leitura; não importa dados nem consulta hóspedes ou preços. */
export async function testarConexaoBeds24(_anterior: ResultadoTesteBeds24 | null): Promise<ResultadoTesteBeds24> {
  void _anterior; // Estado anterior vem do navegador; o resultado sempre é calculado no servidor.
  const sessao = await obterSessao();
  if (!sessao || sessao.papel !== "admin") return { ok: false, mensagem: "Somente o administrador pode testar esta conexão." };
  try {
    const leitor = leitorDoAmbiente();
    if (!leitor) return { ok: false, mensagem: "Configure BEDS24_REFRESH_TOKEN na Vercel e faça um novo deploy." };
    const r = await leitor.quartos();
    if (r.divergencias.length) return { ok: false, mensagem: "Beds24 respondeu, mas os dados de imóveis/quartos precisam de conferência. A sincronização ainda não foi validada." };
    return {
      ok: true,
      mensagem: r.itens.length
        ? `Conexão de leitura confirmada: ${r.itens.length} quarto(s) acessível(is). Este teste não importa reservas nem valida a sincronização.`
        : "Beds24 respondeu, mas nenhum quarto está acessível. Confira os imóveis e as permissões dessa credencial.",
    };
  } catch (e) {
    return { ok: false, mensagem: e instanceof ErroBeds24 ? e.message : "Não foi possível concluir o teste do Beds24. Tente novamente." };
  }
}
