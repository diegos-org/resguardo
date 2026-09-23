import { notFound } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe, ocultarCampos } from "@/auditoria/auditoria";
import styles from "@/components/formularios.module.css";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { getDb } from "@/db/client";
import { obterImovel } from "@/imoveis/repositorio";
import { formatBRL } from "@/lib/money";
import { cancelar } from "@/reservas/acoes";
import { NOMES_ORIGEM, noites } from "@/reservas/regras";
import { obterReserva } from "@/reservas/repositorio";

const CAMPOS_FINANCEIROS = ["valorBruto", "taxaCanal", "valorLiquido", "moeda"];
const dataBr = (d: string) => d.split("-").reverse().join("/");
const brl = (c: number | null) => (c === null ? "não informado" : formatBRL(c));

export default async function DetalheReserva({ params, searchParams }: PageProps<"/painel/reservas/[id]">) {
  const sessao = await exigirSessaoPainel();
  const { id } = await params;
  const { salvo } = await searchParams;
  const db = getDb();
  const r = await obterReserva(db, sessao.organizacaoId, id);
  if (!r) notFound();
  const [imovel, historico] = await Promise.all([obterImovel(db, sessao.organizacaoId, r.imovelId), historicoDe(db, sessao.organizacaoId, "reserva", r.id)]);
  const verValores = podeFazer(sessao.papel, "financeiro:ler");

  const linhas: [string, string][] = [
    ["Imóvel", imovel ? `${imovel.codigo} · ${imovel.nome}` : "—"],
    ["Origem", `${NOMES_ORIGEM[r.origem]}${r.codigoCanal ? ` (${r.codigoCanal})` : ""}`],
    ["Situação", r.estado],
    ["Entrada → saída", `${dataBr(r.checkin)} → ${dataBr(r.checkout)} · ${noites(r.checkin, r.checkout)} noite(s)`],
    ["Hóspedes", r.hospedes === null ? "—" : String(r.hospedes)],
    ["Hóspede", r.hospedeNome || "—"],
    ["Contato", [r.hospedeEmail, r.hospedeTelefone].filter(Boolean).join(" · ") || "—"],
    ["Cidade/país informado", r.hospedeOrigem || "não informado"],
    ...(verValores
      ? ([
          ["Valor bruto", brl(r.valorBruto)],
          ["Taxa do canal", brl(r.taxaCanal)],
          ["Líquido recebido", brl(r.valorLiquido)],
        ] as [string, string][])
      : []),
    ["Observações", r.observacoes || "—"],
  ];

  return (
    <>
      <h1>Reserva {r.codigo}</h1>
      {salvo && (
        <p role="status" className={styles.sucesso}>
          Reserva salva.
        </p>
      )}
      <dl className={styles.form} style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "8px 16px" }}>
        {linhas.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {r.estado !== "cancelada" && podeFazer(sessao.papel, "reserva:editar") && (
        <form action={cancelar}>
          <input type="hidden" name="id" value={r.id} />
          <button type="submit" style={{ font: "inherit", padding: "8px 16px", borderRadius: 6, border: "1px solid #b3261e", color: "#b3261e", background: "#fff", cursor: "pointer" }}>
            Cancelar reserva
          </button>
        </form>
      )}
      <HistoricoAlteracoes linhas={verValores ? historico : ocultarCampos(historico, CAMPOS_FINANCEIROS)} />
    </>
  );
}
