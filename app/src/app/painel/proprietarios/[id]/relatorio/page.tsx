import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { CANAIS_EXTRATO } from "@/relatorios/extratos";
import { donoDoRelatorio, HISTORICO_TODO, imoveisDoProprietario } from "@/relatorios/relatorio";
import { NOMES_ORIGEM } from "@/reservas/regras";

/** Mês anterior ao de hoje (o fechamento que normalmente se envia). */
function mesAnterior(hoje: string): string {
  const [a, m] = hoje.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

/** Relatório mensal em PDF de um proprietário (M5.3). */
export default async function RelatorioDoProprietario({ params, searchParams }: PageProps<"/painel/proprietarios/[id]/relatorio">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "proprietario:ler") || !podeFazer(sessao.papel, "financeiro:ler")) redirect("/painel");
  const { id } = await params;
  const { erro } = await searchParams;
  const db = getDb();
  const dono = await donoDoRelatorio(db, sessao.organizacaoId, id);
  if (!dono) notFound();
  // Os ligados hoje e os que já foram dele (com lançamento dele no livro).
  const imoveis = await imoveisDoProprietario(db, sessao.organizacaoId, dono.id, HISTORICO_TODO);
  return (
    <>
      <p style={{ margin: 0 }}>
        <Link href={`/painel/proprietarios/${dono.id}`}>← {dono.nome}</Link>
      </p>
      <h1>Relatório em PDF</h1>
      <p style={{ margin: 0, maxWidth: 720 }}>
        O relatório no modelo oficial: capa com o resultado do mês e como ele chega ao proprietário, números e reservas do mês, conciliação e repasses — os
        mesmos números do portal. No fim entra o extrato oficial do canal, se você anexar, página por página e sem alterações. A foto e o extrato
        anexados aqui servem só para montar este PDF: não ficam guardados (os extratos do e-mail do fechamento são guardados em Financeiro → Repasses).
      </p>
      {typeof erro === "string" && (
        <p role="alert" className={styles.erro}>
          {erro}
        </p>
      )}
      {imoveis.length === 0 ? (
        <p className={styles.alerta}>Este proprietário não tem imóvel ligado nem histórico no financeiro: ligue um imóvel na ficha dele antes de gerar o relatório.</p>
      ) : (
        <form method="post" action={`/painel/proprietarios/${dono.id}/relatorio/pdf`} encType="multipart/form-data" className={styles.form}>
          <label>
            Mês
            <input type="month" name="mes" required defaultValue={mesAnterior(hojeISO())} />
          </label>
          {imoveis.length > 1 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <legend>Imóveis (nenhum marcado = todos os que eram dele no mês)</legend>
              {imoveis.map((i) => (
                <label key={i.id} className={styles.check}>
                  <input type="checkbox" name="imovel" value={i.codigo} defaultChecked />
                  {i.codigo} · {i.nome}
                </label>
              ))}
            </fieldset>
          )}
          <label>
            Foto do imóvel (opcional, JPG ou PNG até 2 MB)
            <input type="file" name="foto" accept="image/jpeg,image/png" />
          </label>
          <p className={styles.pequeno} style={{ margin: 0 }}>
            Só foto real e autorizada deste imóvel. Sem foto, a página sai sem imagem.
          </p>
          <label>
            Extrato oficial do canal (opcional, PDF até 2 MB)
            <input type="file" name="extrato" accept="application/pdf" />
          </label>
          <label>
            Canal que emitiu o extrato
            <select name="canal" defaultValue="airbnb">
              {CANAIS_EXTRATO.map((c) => (
                <option key={c} value={c}>
                  {NOMES_ORIGEM[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Páginas do extrato (opcional, ex.: 1-2, 4; vazio = todas)
            <input type="text" name="paginas" inputMode="numeric" maxLength={40} />
          </label>
          <p className={styles.pequeno} style={{ margin: 0 }}>
            Antes de enviar, confira no PDF gerado: o extrato é só deste imóvel e deste período, sem outros favorecidos. O sistema não lê o conteúdo do extrato.
          </p>
          <div className={styles.acoes}>
            <button type="submit">Gerar PDF</button>
          </div>
        </form>
      )}
    </>
  );
}
