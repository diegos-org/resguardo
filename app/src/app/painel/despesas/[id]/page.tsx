import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { estornarDespesa, marcarPaga } from "@/despesas/acoes";
import { obterDespesa } from "@/despesas/despesas";
import { obterImovel } from "@/imoveis/repositorio";
import { hojeISO } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { obterProprietario } from "@/proprietarios/repositorio";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";

const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const ehLink = (s: string) => /^https:\/\//i.test(s);

export default async function DetalheDespesa({ params, searchParams }: PageProps<"/painel/despesas/[id]">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "financeiro:ler")) redirect("/painel");
  const { id } = await params;
  const { salvo, erro } = await searchParams;
  const db = getDb();
  const d = await obterDespesa(db, sessao.organizacaoId, id);
  if (!d) notFound();
  const [imovel, dono] = await Promise.all([
    d.imovelId ? obterImovel(db, sessao.organizacaoId, d.imovelId) : null,
    d.proprietarioId ? obterProprietario(db, sessao.organizacaoId, d.proprietarioId) : null,
  ]);
  const editar = podeFazer(sessao.papel, "despesa:editar") && !d.estornada;
  const situacao = d.estornada ? "Estornada" : d.estado === "previsto" ? "A pagar" : `Paga em ${dataBr(d.dataCaixa)}`;

  const linhas: [string, React.ReactNode][] = [
    ["Descrição", d.descricao],
    ["De quem", d.tipo === "despesa_empresa" ? "Da empresa" : "Do proprietário"],
    ...(d.tipo === "despesa_proprietario"
      ? ([
          ["Proprietário", dono?.nome ?? "—"],
          [
            "Acerto",
            d.pagoPor !== "empresa"
              ? "Pago pelo proprietário (só registro)"
              : d.estado === "previsto"
                ? `A empresa vai pagar: o proprietário passa a dever ${formatBRL(d.montante ?? 0)} quando for paga`
                : `Empresa pagou: proprietário deve ${formatBRL(d.montante ?? 0)}`,
          ],
        ] as [string, string][])
      : []),
    ["Categoria", d.categoria ?? "—"],
    ["Valor", formatBRL(d.montante ?? -d.valor)],
    ["Data", dataBr(d.competencia)],
    ["Imóvel", imovel ? `${imovel.codigo} · ${imovel.nome}` : "Geral da empresa"],
    ["Fornecedor / recebedor", d.fornecedor || "—"],
    [
      "Comprovante",
      d.comprovante ? (
        ehLink(d.comprovante) ? (
          <a href={d.comprovante} target="_blank" rel="noopener noreferrer">
            abrir
          </a>
        ) : (
          d.comprovante
        )
      ) : (
        "—"
      ),
    ],
    ["Situação", situacao],
  ];

  return (
    <>
      <h1>Despesa</h1>
      {salvo && (
        <p role="status" className={styles.sucesso}>
          Despesa registrada.
        </p>
      )}
      {erro && (
        <p role="alert" className={styles.alerta}>
          {erro === "estorno"
            ? "Não foi possível estornar: informe o motivo."
            : erro === "quitado"
              ? "Não dá para estornar: o adiantamento desta despesa já teve reembolso ou foi assumido pela empresa. Desfaça a quitação em Adiantamentos antes."
              : erro === "compensacao"
                ? "Não dá para estornar: o valor desta despesa já foi descontado num repasse ao proprietário. Estorne o repasse antes."
              : "Não foi possível marcar como paga: confira a data."}
        </p>
      )}
      <dl className={styles.form} style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "8px 16px" }}>
        {linhas.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {editar && d.estado === "previsto" && (
        <form action={marcarPaga} className={styles.form} aria-label="Marcar como paga">
          <input type="hidden" name="id" value={d.id} />
          <div className={styles.linha}>
            <label>
              Data do pagamento
              <input type="date" name="dataPagamento" defaultValue={hojeISO()} required />
            </label>
          </div>
          <div className={styles.acoes}>
            <button type="submit">Marcar como paga</button>
          </div>
        </form>
      )}
      {editar && (
        <form action={estornarDespesa} className={styles.form} aria-label="Estornar despesa">
          <p style={{ fontSize: "0.875rem", margin: 0 }}>
            Lançou errado? O estorno anula a despesa sem apagar o histórico. Depois, lance a correta.
          </p>
          <input type="hidden" name="id" value={d.id} />
          <div className={styles.linha}>
            <label>
              Motivo do estorno
              <input name="motivo" required maxLength={200} placeholder="ex.: valor digitado errado" />
            </label>
          </div>
          <div className={styles.acoes}>
            <BotaoConfirmar pergunta="Estornar esta despesa? Ela deixa de contar (o histórico fica guardado)." style={{ background: "#b3261e" }}>
              Estornar
            </BotaoConfirmar>
          </div>
        </form>
      )}
      <p>
        <Link href="/painel/despesas">← Voltar para despesas</Link>
      </p>
    </>
  );
}
