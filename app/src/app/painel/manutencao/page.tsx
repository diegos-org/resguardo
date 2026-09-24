import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import type { EstadoManutencao } from "@/db/schema";
import { listarCategorias } from "@/despesas/categorias";
import { listarImoveis } from "@/imoveis/repositorio";
import { hojeISO } from "@/lib/datas";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
import { aprovarAcao, cancelarAcao, criarAcao, custoAcao, orcamentoAcao, realizarAcao, recusarAcao } from "@/manutencao/acoes";
import { listarManutencoes, NOMES_ESTADO } from "@/manutencao/manutencao";

const COR: Record<EstadoManutencao, string> = { pedida: "#8a6d1c", orcada: "#b3261e", aprovada: "#2f5d8a", realizada: "#2e6b3f", recusada: "#777", cancelada: "#777" };
const dataBr = (d: string) => d.split("-").reverse().join("/");
const QUEM: Record<string, string> = { empresa: "empresa paga", proprietario: "proprietário paga" };

export default async function Manutencao({ searchParams }: PageProps<"/painel/manutencao">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "manutencao:ler")) redirect("/painel");
  const params = await searchParams;
  const db = getDb();
  const hoje = hojeISO();
  const imoveis = await listarImoveis(db, sessao.organizacaoId);
  const todas = params.estado === "todas";
  const codigo = typeof params.imovel === "string" ? params.imovel : "";
  const imovel = imoveis.find((i) => i.codigo === codigo);
  const editar = podeFazer(sessao.papel, "manutencao:editar");
  const aprovar = podeFazer(sessao.papel, "manutencao:aprovar");
  const lancar = editar && podeFazer(sessao.papel, "despesa:editar");
  const verCusto = podeFazer(sessao.papel, "financeiro:ler");
  const [lista, categorias] = await Promise.all([
    listarManutencoes(db, sessao.organizacaoId, { emAberto: !todas, imovelIds: imovel ? [imovel.id] : undefined }),
    lancar ? listarCategorias(db, sessao.organizacaoId) : [],
  ]);
  const voltar = new URLSearchParams({ ...(todas ? { estado: "todas" } : {}), ...(imovel ? { imovel: imovel.codigo } : {}) }).toString();
  const salvo = params.salvo === "1";
  const erro = typeof params.erro === "string" ? params.erro : undefined;
  const aguardando = lista.filter((m) => m.estado === "orcada").length;

  return (
    <>
      <h1>Manutenção</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Registre o pedido, o orçamento e aguarde a aprovação do Diego, que decide quem paga (empresa ou proprietário). Orçamento recebido não autoriza
        executar. Depois do serviço, registre a data e lance o custo: ele vira uma despesa, com o imóvel e quem paga já preenchidos.
      </p>
      <form method="get" className={styles.form} aria-label="Filtro">
        <div className={styles.linha} style={{ alignItems: "flex-end" }}>
        <label style={{ flex: "0 1 200px" }}>
          Mostrar
          <select name="estado" defaultValue={todas ? "todas" : ""}>
            <option value="">Pedindo ação</option>
            <option value="todas">Todas</option>
          </select>
        </label>
        <label style={{ flex: "0 1 240px" }}>
          Imóvel
          <select name="imovel" defaultValue={imovel?.codigo ?? ""}>
            <option value="">Todos</option>
            {imoveis.map((i) => (
              <option key={i.id} value={i.codigo}>
                {i.codigo} · {i.nome}
              </option>
            ))}
          </select>
        </label>
          <div className={styles.acoes}>
            <button type="submit">Filtrar</button>
          </div>
        </div>
      </form>
      {salvo && (
        <p role="status" className={styles.sucesso}>
          Salvo.
        </p>
      )}
      {erro && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      <p className={styles.etiqueta} style={{ alignSelf: "flex-start" }}>
        {lista.length} manutenç{lista.length === 1 ? "ão" : "ões"}
        {aguardando ? ` · ${aguardando} aguardando aprovação` : ""}
      </p>

      {editar && (
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Novo pedido de manutenção</summary>
          <form action={criarAcao} className={styles.form} style={{ marginTop: 8 }}>
            <input type="hidden" name="voltar" value={voltar} />
            <label>
              Imóvel
              <select name="imovelId" required defaultValue={imovel?.id ?? ""}>
                <option value="">Escolha…</option>
                {imoveis.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.codigo} · {i.nome}
                  </option>
                ))}
              </select>
            </label>
            <label>
              O que precisa ser feito
              <input name="titulo" required maxLength={200} placeholder="ex.: trocar o chuveiro do banheiro social" />
            </label>
            <label>
              Detalhes (opcional)
              <textarea name="descricao" maxLength={1000} rows={3} />
            </label>
            <div className={styles.acoes}>
              <button type="submit">Registrar pedido</button>
            </div>
          </form>
        </details>
      )}

      {lista.length === 0 && <p>Nenhuma manutenção {todas ? "registrada" : "pedindo ação"}.</p>}
      {lista.map((m) => (
        <section key={m.id} className={styles.form} aria-label={`Manutenção ${m.imovelCodigo}: ${m.titulo}`} style={{ gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong>
              {m.imovelCodigo} · {m.titulo}
            </strong>
            <span style={{ color: COR[m.estado], fontWeight: 600 }}>{NOMES_ESTADO[m.estado]}</span>
          </div>
          {m.descricao && <p style={{ margin: 0, fontSize: "0.875rem" }}>{m.descricao}</p>}
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
            {m.orcamento !== null ? `Orçamento: ${formatBRL(m.orcamento)} · ${m.fornecedor}` : "Sem orçamento"}
            {m.responsavel ? ` · ${QUEM[m.responsavel]}` : ""}
            {m.dataRealizada ? ` · feita em ${dataBr(m.dataRealizada)}` : ""}
            {verCusto && m.custo !== null && m.despesaId && (
              <>
                {" · custo "}
                <Link href={`/painel/despesas/${m.despesaId}`}>{formatBRL(m.custo)}</Link>
              </>
            )}
          </p>
          {m.observacao && <p style={{ margin: 0, fontSize: "0.875rem" }}>{m.observacao}</p>}
          {m.avisos.map((a) => (
            <p key={a} role="note" className={styles.alerta} style={{ margin: 0 }}>
              {a}
            </p>
          ))}

          {aprovar && m.estado === "orcada" && (
            <form action={aprovarAcao} className={styles.linha} style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="voltar" value={voltar} />
              <label style={{ flex: "0 1 240px" }}>
                Quem paga
                <select name="responsavel" required defaultValue="">
                  <option value="">Escolha…</option>
                  <option value="empresa">Empresa</option>
                  <option value="proprietario">Proprietário</option>
                </select>
              </label>
              <div className={styles.acoes}>
                <BotaoConfirmar pergunta={`Aprovar ${m.titulo} (${m.imovelCodigo}) por ${formatBRL(m.orcamento ?? 0)} com ${m.fornecedor}?`}>Aprovar orçamento</BotaoConfirmar>
              </div>
            </form>
          )}

          {editar && m.estado === "aprovada" && (
            <form action={realizarAcao} className={styles.linha} style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="voltar" value={voltar} />
              <label style={{ flex: "0 1 200px" }}>
                Data do serviço
                <input type="date" name="data" defaultValue={hoje} min={m.aprovadaEm ? hojeISO(undefined, m.aprovadaEm) : undefined} max={hoje} required />
              </label>
              <div className={styles.acoes}>
                <button type="submit">Registrar como feita</button>
              </div>
            </form>
          )}

          {lancar && m.estado === "realizada" && m.custo === null && (
            <form action={custoAcao} className={styles.linha} style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="voltar" value={voltar} />
              <label style={{ flex: "0 1 200px" }}>
                Categoria
                <select name="categoriaId" required defaultValue={categorias.find((c) => /manuten/i.test(c.nome))?.id ?? ""}>
                  <option value="">Escolha…</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ flex: "0 1 140px" }}>
                Custo final (R$)
                <input name="valor" inputMode="decimal" required defaultValue={centavosParaCampo(m.orcamento)} />
              </label>
              {m.responsavel === "proprietario" && (
                <label style={{ flex: "0 1 200px" }}>
                  Quem pagou
                  <select name="pagoPor" defaultValue="empresa">
                    <option value="empresa">Empresa (vira adiantamento)</option>
                    <option value="proprietario">O próprio proprietário</option>
                  </select>
                </label>
              )}
              <label className={styles.check} style={{ flex: "0 1 auto" }}>
                <input type="checkbox" name="paga" /> Já paga
              </label>
              <label style={{ flex: "0 1 180px" }}>
                Data do pagamento
                <input type="date" name="dataPagamento" max={hoje} />
              </label>
              <div className={styles.acoes}>
                <button type="submit">Lançar custo</button>
              </div>
            </form>
          )}

          {editar && ["pedida", "orcada", "aprovada"].includes(m.estado) && (
            <details>
              <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>{m.orcamento === null ? "Registrar orçamento" : "Trocar orçamento"}</summary>
              <form action={orcamentoAcao} className={styles.linha} style={{ alignItems: "flex-end", marginTop: 8 }}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="voltar" value={voltar} />
                <label>
                  Quem vai fazer
                  <input name="fornecedor" required maxLength={200} defaultValue={m.fornecedor} />
                </label>
                <label style={{ flex: "0 1 160px" }}>
                  Valor (R$)
                  <input name="valor" inputMode="decimal" required placeholder="ex.: 450,00" />
                </label>
                <div className={styles.acoes}>
                  {m.estado === "aprovada" ? (
                    <BotaoConfirmar pergunta="Trocar o orçamento de uma manutenção aprovada? Ela volta a aguardar a aprovação do Diego.">Salvar orçamento</BotaoConfirmar>
                  ) : (
                    <button type="submit">Salvar orçamento</button>
                  )}
                </div>
              </form>
            </details>
          )}

          {(aprovar || editar) && ["pedida", "orcada", "aprovada"].includes(m.estado) && (
            <details>
              <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>{aprovar && m.estado !== "aprovada" ? "Recusar ou cancelar" : "Cancelar"}</summary>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
                {aprovar && m.estado !== "aprovada" && (
                  <form action={recusarAcao} className={styles.linha} style={{ alignItems: "flex-end", flex: "1 1 280px" }}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="voltar" value={voltar} />
                    <label>
                      Motivo da recusa
                      <input name="motivo" required maxLength={300} />
                    </label>
                    <div className={styles.acoes}>
                      <BotaoConfirmar pergunta={`Recusar ${m.titulo} (${m.imovelCodigo})?`} style={{ background: "#b3261e" }}>
                        Recusar
                      </BotaoConfirmar>
                    </div>
                  </form>
                )}
                {editar && (
                  <form action={cancelarAcao} className={styles.linha} style={{ alignItems: "flex-end", flex: "1 1 280px" }}>
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="voltar" value={voltar} />
                    <label>
                      Motivo do cancelamento
                      <input name="motivo" required maxLength={300} />
                    </label>
                    <div className={styles.acoes}>
                      <BotaoConfirmar pergunta={`Cancelar ${m.titulo} (${m.imovelCodigo})?`} style={{ background: "#b3261e" }}>
                        Cancelar
                      </BotaoConfirmar>
                    </div>
                  </form>
                )}
              </div>
            </details>
          )}
        </section>
      ))}
    </>
  );
}
