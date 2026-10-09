import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { listarMapeamentosBeds24 } from "@/beds24/configuracao";
import { escritaBeds24Ligada } from "@/beds24/http";
import { alternarMinimoNormalEventoAcao, novoEventoAcao, removerEventoAcao, salvarRegrasCalendarioAcao } from "@/calendario/acoes";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { EventosCalendario } from "@/components/configuracoes/EventosCalendario";
import { FormRegrasCalendario } from "@/components/configuracoes/FormRegrasCalendario";
import { getDb } from "@/db/client";
import { fontesDePrecosDosImoveis } from "@/imoveis/detalhes";
import { listarImoveis } from "@/imoveis/repositorio";

export default async function CalendarioRegras() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const db = getDb();
  const org = sessao.organizacaoId;
  const [regras, imoveis, mapas] = await Promise.all([lerRegrasCalendario(db, org), listarImoveis(db, org), listarMapeamentosBeds24(db, org)]);
  const fontes = await fontesDePrecosDosImoveis(db, org, imoveis.map((i) => i.id));
  const opcoes = imoveis.map((i) => ({ id: i.id, codigo: i.codigo, nome: i.nome, vinculado: mapas.some((m) => m.imovelId === i.id && /^\d+$/.test(m.propertyId) && /^\d+$/.test(m.roomId)), fontePrecos: fontes.get(i.id) ?? ("scl" as const) }));
  return <>
    <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
      O SCL é a fonte oficial de calendário e preços: estas regras, mais o cadastro de cada imóvel (preço base, períodos especiais, pisos), definem o que vai ao Beds24 e dele às OTAs. Salvar aqui não envia nada: o envio é conferido e disparado em <Link href="/painel/calendario/previa">Calendário → Conferir calendário e preços</Link>. Sinal de escrita na Vercel: <strong>{escritaBeds24Ligada() ? "ligado" : "desligado"}</strong>.
    </p>
    <FormRegrasCalendario regras={regras} imoveis={opcoes} salvar={salvarRegrasCalendarioAcao} />
    <EventosCalendario eventos={regras.eventos} imoveis={opcoes} criar={novoEventoAcao} remover={removerEventoAcao} alternarMinimoNormal={alternarMinimoNormalEventoAcao} />
  </>;
}
