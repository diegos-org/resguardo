import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { MensagensAutomaticas } from "@/components/configuracoes/MensagensAutomaticas";
import { Modelos } from "@/components/configuracoes/Modelos";
import { editarModeloAcao, novoModeloAcao, salvarMensagensAcao } from "@/configuracoes/acoes";
import { garantirModelosIniciais, listarModelos, MODELOS_INICIAIS } from "@/configuracoes/modelos";
import { getDb } from "@/db/client";
import { ORIGENS_RESERVA, TIPOS_MENSAGEM_HOSPEDE } from "@/db/schema";
import { lerConfigMensagens, NOMES_TIPO, ultimosEnvios } from "@/mensagens/hospede";
import { NOMES_ORIGEM } from "@/reservas/regras";
import { ultimasExecucoes } from "@/sistema/automacoes";

const dataHora = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

export default async function Mensagens() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const db = getDb();
  await garantirModelosIniciais(db, sessao.organizacaoId);
  const agora = new Date();
  const [lista, cfg, envios, execucoes] = await Promise.all([
    listarModelos(db, sessao.organizacaoId),
    lerConfigMensagens(db, sessao.organizacaoId),
    ultimosEnvios(db, sessao.organizacaoId, agora),
    ultimasExecucoes(db),
  ]);
  const ativos = lista.filter((m) => m.ativo);
  // Antes de salvar pela primeira vez, sugere os modelos iniciais (o envio continua desligado).
  const sugestao = (i: number) => (cfg.salva ? "" : (ativos.find((m) => m.nome === MODELOS_INICIAIS[i]?.nome)?.id ?? ""));
  const ultima = execucoes.get("mensagens-hospede");
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
          return { id: t, nome: `${NOMES_TIPO[t]}${sumiu ? " — atenção: o modelo escolhido foi arquivado ou excluído; esta mensagem não está saindo" : ""}`, selecionado: sumiu ? "" : (id ?? sugestao(i)) };
        })}
        modelos={ativos.map(({ id, nome }) => ({ id, nome }))}
        envios={envios.map((e) => ({ ...e, quando: dataHora(e.quando) }))}
        ultimaExecucao={ultima ? `${dataHora(ultima.iniciadoEm)} — ${ultima.ok === false ? "com problema: " : ""}${ultima.resumo}` : null}
        salvar={salvarMensagensAcao}
      />
      <h2 style={{ fontSize: "1.25rem", margin: "16px 0 0" }}>Modelos de mensagem</h2>
      <Modelos lista={lista.map(({ id, nome, quando, texto, ativo }) => ({ id, nome, quando, texto, ativo }))} criar={novoModeloAcao} editar={editarModeloAcao} />
    </>
  );
}
