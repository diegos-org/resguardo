import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { MensagensAutomaticas } from "@/components/configuracoes/MensagensAutomaticas";
import { Modelos } from "@/components/configuracoes/Modelos";
import { editarModeloAcao, novoModeloAcao, salvarMensagensAcao } from "@/configuracoes/acoes";
import { ehMensagemDeAlteracao, ehMensagemDeCancelamento, garantirModelosIniciais, listarModelos, MODELOS_INICIAIS, TEXTOS_BASE_ALTERACAO, TEXTOS_BASE_CANCELAMENTO } from "@/configuracoes/modelos";
import { getDb } from "@/db/client";
import { ORIGENS_RESERVA, TIPOS_MENSAGEM_HOSPEDE } from "@/db/schema";
import { dataHoraNoFuso } from "@/lib/datas";
import { lerConfigMensagens, NOMES_TIPO, ultimaExecucaoDaOrganizacao, ultimosEnvios } from "@/mensagens/hospede";
import { NOMES_ORIGEM } from "@/reservas/regras";

const dataHora = (d: Date) => dataHoraNoFuso(d);

export default async function Mensagens() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const db = getDb();
  await garantirModelosIniciais(db, sessao.organizacaoId);
  const agora = new Date();
  const [lista, cfg, envios, ultima] = await Promise.all([
    listarModelos(db, sessao.organizacaoId),
    lerConfigMensagens(db, sessao.organizacaoId),
    ultimosEnvios(db, sessao.organizacaoId, agora),
    ultimaExecucaoDaOrganizacao(db, sessao.organizacaoId),
  ]);
  const ativos = lista.filter((m) => m.ativo);
  // Antes de salvar pela primeira vez, sugere os modelos iniciais (o envio continua desligado).
  const sugestao = (i: number) => (cfg.salva ? "" : (ativos.find((m) => m.nome === MODELOS_INICIAIS[i]?.nome)?.id ?? ""));
  return (
    <>
      <MensagensAutomaticas
        ativo={cfg.ativo}
        ativoDesde={cfg.ativoDesde ? dataHora(new Date(cfg.ativoDesde)) : null}
        origens={ORIGENS_RESERVA.map((o) => ({ id: o, nome: NOMES_ORIGEM[o], marcada: cfg.origens.includes(o) }))}
        tipos={TIPOS_MENSAGEM_HOSPEDE.map((t, i) => {
          const id = cfg.modelos[t];
          // Modelo escolhido que foi arquivado ou excluído: avisa (a mensagem não está saindo).
          const sumiu = id && !ativos.some((m) => m.id === id);
          return {
            id: t,
            nome: `${NOMES_TIPO[t]}${sumiu ? " — atenção: o modelo escolhido foi arquivado ou excluído; esta mensagem não está saindo" : ""}`,
            selecionado: sumiu ? "" : (id ?? sugestao(i)),
            // M8.2c e M8.2d: o texto-base das mensagens do cancelamento e da alteração (o que a ficha copia sem modelo escolhido).
            ...(ehMensagemDeCancelamento(t) ? { textoBase: TEXTOS_BASE_CANCELAMENTO[t] } : ehMensagemDeAlteracao(t) ? { textoBase: TEXTOS_BASE_ALTERACAO[t] } : {}),
          };
        })}
        modelos={ativos.map(({ id, nome }) => ({ id, nome }))}
        envios={envios.map((e) => ({ ...e, quando: dataHora(e.quando) }))}
        ultimaExecucao={ultima ? `${dataHora(ultima.quando)} — ${ultima.ok ? "" : "com problema: "}${ultima.resumo}` : null}
        salvar={salvarMensagensAcao}
      />
      <h2 style={{ fontSize: "1.25rem", margin: "16px 0 0" }}>Modelos de mensagem</h2>
      <Modelos lista={lista.map(({ id, nome, quando, texto, ativo }) => ({ id, nome, quando, texto, ativo }))} criar={novoModeloAcao} editar={editarModeloAcao} />
    </>
  );
}
