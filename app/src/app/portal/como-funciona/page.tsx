import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/acesso/auth";
import { obterSessao } from "@/acesso/sessao-atual";
import { DocumentoComoFunciona } from "@/components/portal/DocumentoComoFunciona";
import { MolduraPortal } from "@/components/portal/MolduraPortal";
import styles from "@/components/portal/portal.module.css";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { aceitarComoFuncionaAcao } from "@/portal/acoes";
import { situacaoNoPortal } from "@/portal/aceites";
import { dadosDoProprietario } from "@/portal/dados-contrato";
import { lerRegrasRepasses } from "@/repasses/regras-config";

/** Portal → Como funciona (M5.6): o documento publicado, os dados do contrato e o aceite do proprietário. */
export default async function ComoFuncionaPortal({ searchParams }: PageProps<"/portal/como-funciona">) {
  const sessao = await obterSessao();
  if (!sessao) redirect("/entrar");
  if (sessao.papel !== "proprietario") redirect("/painel");
  const db = getDb();
  const params = await searchParams;
  const [empresa, situacao] = await Promise.all([nomeDaEmpresa(db, sessao.organizacaoId), situacaoNoPortal(db, sessao.organizacaoId, sessao.usuarioId)]);
  const hoje = hojeISO();
  const regras = situacao.atual ? await lerRegrasRepasses(db, sessao.organizacaoId) : null;
  const dados = situacao.atual && regras ? await Promise.all(situacao.donos.map(async (d) => ({ ...(await dadosDoProprietario(db, sessao.organizacaoId, d.id, hoje, regras)), nome: d.nome }))) : [];
  const mensagem =
    typeof params.erro === "string" ? { tipo: "erro" as const, texto: params.erro } : params.salvo === "aceite" ? { tipo: "ok" as const, texto: "Aceite registrado. Obrigado!" } : null;

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/entrar" });
  }

  return (
    <MolduraPortal empresa={empresa} titulo="Portal do proprietário" sair={sair}>
      <header className={styles.cabecalho}>
        <div>
          <p className={styles.olho}>
            <Link href="/portal">← Voltar ao portal</Link>
          </p>
          <h1>Como funciona</h1>
        </div>
      </header>
      {situacao.atual ? (
        <DocumentoComoFunciona
          versao={situacao.atual}
          empresa={empresa}
          dados={dados}
          donos={situacao.donos.map((d) => ({ nome: d.nome, aceite: d.aceiteAtual ? { aceitoEm: d.aceiteAtual.aceitoEm, email: d.aceiteAtual.email } : null, ultimo: d.ultimo ? { versao: d.ultimo.versao, aceitoEm: d.ultimo.aceitoEm } : null }))}
          aceitar={aceitarComoFuncionaAcao}
          mensagem={mensagem}
        />
      ) : (
        <p>A {empresa} ainda não publicou o documento &ldquo;Como funciona&rdquo;. Quando publicar, ele aparece aqui e no início do portal.</p>
      )}
    </MolduraPortal>
  );
}
