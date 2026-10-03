import { redirect } from "next/navigation";
import { ACOES, PERMISSOES, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { Usuarios } from "@/components/configuracoes/Usuarios";
import { alterarUsuarioAcao, novoUsuarioAcao } from "@/configuracoes/acoes";
import { listarUsuarios, NOMES_PAPEL } from "@/configuracoes/usuarios";
import { getDb } from "@/db/client";

const NOME_ACAO: Record<(typeof ACOES)[number], string> = {
  "imovel:ler": "Ver imóveis",
  "imovel:editar": "Editar imóveis",
  "proprietario:ler": "Ver proprietários",
  "proprietario:editar": "Editar proprietários",
  "reserva:ler": "Ver reservas",
  "reserva:editar": "Criar e editar reservas",
  "calendario:ler": "Ver calendário",
  "bloqueio:proprio": "Bloquear datas de uso próprio no portal (conforme o contrato)",
  "financeiro:ler": "Ver financeiro",
  "financeiro:editar": "Editar financeiro e contratos",
  "despesa:editar": "Lançar despesas",
  "limpeza:ler": "Ver limpezas",
  "limpeza:editar": "Gerir limpezas",
  "limpeza:propria": "Ver as próprias limpezas e marcar como feita (pelo celular)",
  "manutencao:ler": "Ver manutenção",
  "manutencao:editar": "Gerir manutenção",
  "manutencao:aprovar": "Aprovar orçamento de manutenção e decidir quem paga",
  "rotina:ler": "Ver rotinas recorrentes",
  "rotina:editar": "Marcar rotina como feita ou pulada",
  "mensagem:ler": "Ver mensagens",
  "mensagem:enviar": "Enviar mensagens",
  "usuario:gerenciar": "Gerir usuários",
  "configuracao:editar": "Mudar configurações",
};
const PAPEIS_TABELA = ["admin", "operacao", "proprietario", "limpeza"] as const;

export default async function PaginaUsuarios() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "usuario:gerenciar")) redirect("/painel/configuracoes");
  const todos = await listarUsuarios(getDb(), sessao.organizacaoId);
  const equipe = todos.filter((u) => u.papel === "admin" || u.papel === "operacao");
  const donos = todos.filter((u) => u.papel === "proprietario");
  return (
    <>
      <section aria-label="Equipe" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Equipe</h2>
        <Usuarios
          lista={equipe.map((u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, ativo: u.ativo, eu: u.id === sessao.usuarioId }))}
          criar={novoUsuarioAcao}
          alterar={alterarUsuarioAcao}
        />
        <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>
          Proprietários entram por convite, na página de cada proprietário ({donos.length} com acesso hoje). As profissionais de limpeza
          ganham acesso em Limpezas → Profissionais.
        </p>
      </section>
      <section aria-label="Permissões" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: "1.25rem", margin: 0 }}>O que cada papel pode fazer</h2>
        <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
          Proprietário vê só os próprios imóveis. Estas permissões são a regra de segurança do sistema; para mudar alguma, peça aqui na
          conversa (fica registrado e testado).
        </p>
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Permissão</th>
                {PAPEIS_TABELA.map((p) => (
                  <th key={p}>{NOMES_PAPEL[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ACOES.map((a) => (
                <tr key={a}>
                  <td>{NOME_ACAO[a]}</td>
                  {PAPEIS_TABELA.map((p) => (
                    <td key={p}>{PERMISSOES[p].includes(a) ? "✓" : "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
