import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { situacaoServicos } from "@/sistema/servicos";

const ONDE: Record<string, string> = {
  "Banco de dados (Neon)": "DATABASE_URL",
  "Login com Google": "AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET",
  "E-mail do sistema (Resend)": "RESEND_API_KEY, EMAIL_REMETENTE",
  Beds24: "BEDS24_API_KEY (e BEDS24_ESCRITA=ligada para enviar ao Beds24)",
};

export default async function Integracoes() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  // Aqui não testa o banco (a página Sistema testa); só mostra o que está configurado.
  const servicos = situacaoServicos(process.env, null);
  return (
    <>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
        Chaves e senhas nunca ficam no painel nem no Git: elas vão nas variáveis de ambiente da Vercel (Projeto → Settings → Environment
        Variables). Depois de mudar uma variável, é preciso publicar de novo (Redeploy) para valer. O resto de cada integração — como
        imóveis ligados ao Beds24 — é editado nas telas do sistema.
      </p>
      <div className={styles.rolagem}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Integração</th>
              <th>Para que serve</th>
              <th>Situação</th>
              <th>Variáveis na Vercel</th>
            </tr>
          </thead>
          <tbody>
            {servicos.map((s) => (
              <tr key={s.nome}>
                <td>{s.nome}</td>
                <td>{s.paraQue}</td>
                <td>{s.detalhe}</td>
                <td style={{ fontSize: "0.8125rem" }}>{ONDE[s.nome] ?? "chega com a integração"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
