import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import { getDb } from "@/db/client";
import type { EstadoLimpeza } from "@/db/schema";
import { listarImoveis } from "@/imoveis/repositorio";
import { hojeISO } from "@/lib/datas";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { descreverFiltros, lerFiltros, manterFiltros, periodoDosFiltros } from "@/lib/filtros";
import { formatBRL } from "@/lib/money";
import { avulsaAcao, cancelarAcao, confirmarAcao, custoAcao, realizarAcao, reabrirAcao } from "@/limpezas/acoes";
import { listarLimpezas, listarProfissionais, NOMES_ESTADO, sincronizarLimpezas } from "@/limpezas/limpezas";

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dia = (d: string) => `${SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.split("-").reverse().slice(0, 2).join("/")}`;
const COR: Record<EstadoLimpeza, string> = { pedida: "#8a6d1c", confirmada: "#2f5d8a", realizada: "#2e6b3f", cancelada: "#777" };

export default async function Limpezas({ searchParams }: PageProps<"/painel/limpezas">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "limpeza:ler")) redirect("/painel");
  const params = await searchParams;
  const db = getDb();
  const hoje = hojeISO();
  const imoveis = await listarImoveis(db, sessao.organizacaoId);
  const opcoes = imoveis.map((i) => ({ codigo: i.codigo, nome: i.nome }));
  const filtros = lerFiltros(params, opcoes);
  const periodo = periodoDosFiltros(filtros);
  const editar = podeFazer(sessao.papel, "limpeza:editar");
  const verCusto = podeFazer(sessao.papel, "financeiro:ler");
  // Gera/atualiza as limpezas das saídas deste período antes de mostrar (idempotente).
  await sincronizarLimpezas(db, sessao.organizacaoId, periodo, sessao.usuarioId);
  const imovelIds = filtros.imoveis.length ? imoveis.filter((i) => filtros.imoveis.includes(i.codigo)).map((i) => i.id) : undefined;
  const [lista, profissionais] = await Promise.all([listarLimpezas(db, sessao.organizacaoId, { ...periodo, imovelIds, hoje }), listarProfissionais(db, sessao.organizacaoId)]);
  const q = manterFiltros(params);
  const voltar = q.slice(1);
  const salvo = params.salvo === "1";
  const erro = typeof params.erro === "string" ? params.erro : undefined;
  // Totais só com as limpezas deste período/imóvel (a que aparece por mudança da reserva fica de fora).
  const doPeriodo = lista.filter((l) => !l.movida);
  const conta = (e: EstadoLimpeza) => doPeriodo.filter((l) => l.estado === e).length;
  // "Quem fez": as ativas e, se foi arquivada depois, a que já estava escolhida.
  const opcoesDe = (l: (typeof lista)[number]) =>
    l.profissionalId && !profissionais.some((p) => p.id === l.profissionalId) ? [...profissionais, { id: l.profissionalId, nome: `${l.profissional ?? "Profissional"} (arquivada)` }] : profissionais;
  const custoTotal = doPeriodo.filter((l) => l.estado === "realizada").reduce((t, l) => t + (l.custo ?? 0), 0);

  return (
    <>
      <div className={styles.topo}>
        <h1>Limpezas</h1>
        {editar && (
          <Link href={`/painel/limpezas/profissionais${q}`} className={styles.botao} style={{ background: "#fff", color: "var(--scl-salvia)", border: "1px solid currentColor" }}>
            Profissionais
          </Link>
        )}
      </div>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Cada reserva confirmada gera a limpeza no dia da saída. Confirme com a profissional e, depois de feita, registre como realizada: pedir não
        comprova que aconteceu.
      </p>
      <FiltroGlobal filtros={filtros} opcoes={opcoes} acao="/painel/limpezas" />
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
        {descreverFiltros(filtros, opcoes)} · {conta("pedida")} pedida(s) · {conta("confirmada")} confirmada(s) · {conta("realizada")} realizada(s)
        {verCusto ? ` · custo registrado ${formatBRL(custoTotal)}` : ""}
      </p>
      {editar && profissionais.length === 0 && (
        <p role="note" className={styles.alerta}>
          Nenhuma profissional cadastrada: cadastre em <Link href={`/painel/limpezas/profissionais${q}`}>Profissionais</Link> para confirmar e registrar limpezas.
        </p>
      )}

      {lista.length === 0 && <p>Nenhuma limpeza neste período.</p>}
      {lista.map((l) => (
        <section key={l.id} className={styles.form} aria-label={`Limpeza ${l.imovelCodigo} ${l.data}`} style={{ gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <strong>
              {dia(l.data)} · {l.imovelCodigo}
              {l.reservaCodigo ? (
                <>
                  {" "}
                  · saída da <Link href={`/painel/reservas/${l.reservaId}`}>{l.reservaCodigo}</Link>
                </>
              ) : (
                " · avulsa"
              )}
            </strong>
            <span style={{ color: COR[l.estado], fontWeight: 600 }}>
              {NOMES_ESTADO[l.estado]}
              {l.profissional ? ` · ${l.profissional}` : ""}
              {verCusto && l.estado === "realizada" && l.custo !== null ? ` · ${formatBRL(l.custo)}` : ""}
            </span>
          </div>
          {l.observacao && <p style={{ margin: 0, fontSize: "0.875rem" }}>{l.observacao}</p>}
          {l.avisos.map((a) => (
            <p key={a} role="note" className={styles.alerta} style={{ margin: 0 }}>
              {a}
            </p>
          ))}

          {editar && (l.estado === "pedida" || l.estado === "confirmada") && opcoesDe(l).length > 0 && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <form action={confirmarAcao} className={styles.linha} style={{ alignItems: "flex-end", flex: "1 1 280px" }}>
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="voltar" value={voltar} />
                <label>
                  Profissional
                  <select name="profissionalId" defaultValue={l.profissionalId ?? ""} required>
                    <option value="">Escolha…</option>
                    {profissionais.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.acoes}>
                  <button type="submit">{l.estado === "confirmada" ? "Trocar" : "Confirmar"}</button>
                </div>
              </form>
              {l.data <= hoje && (
                <form action={realizarAcao} className={styles.linha} style={{ alignItems: "flex-end", flex: "1 1 320px" }}>
                  <input type="hidden" name="id" value={l.id} />
                  <input type="hidden" name="voltar" value={voltar} />
                  <label>
                    Quem fez
                    <select name="profissionalId" defaultValue={l.profissionalId ?? ""} required>
                      <option value="">Escolha…</option>
                      {opcoesDe(l).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  {verCusto && (
                    <label style={{ flex: "0 1 140px" }}>
                      Custo (R$)
                      <input name="custo" inputMode="decimal" placeholder="em branco = depois" />
                    </label>
                  )}
                  <div className={styles.acoes}>
                    <button type="submit">Registrar como feita</button>
                  </div>
                </form>
              )}
            </div>
          )}

          {editar && l.estado === "realizada" && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              {verCusto && (
                <form action={custoAcao} className={styles.linha} style={{ alignItems: "flex-end" }}>
                  <input type="hidden" name="id" value={l.id} />
                  <input type="hidden" name="voltar" value={voltar} />
                  <label style={{ flex: "0 1 160px" }}>
                    Custo (R$)
                    <input name="custo" inputMode="decimal" defaultValue={l.custo === null ? "" : centavosParaCampo(l.custo)} placeholder="não informado" />
                  </label>
                  <div className={styles.acoes}>
                    <button type="submit">Salvar custo</button>
                  </div>
                </form>
              )}
              <form action={reabrirAcao}>
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="voltar" value={voltar} />
                <BotaoConfirmar pergunta="Desfazer o registro de limpeza feita? Ela volta a ficar confirmada." className={styles.pequeno}>
                  Desfazer &ldquo;feita&rdquo;
                </BotaoConfirmar>
              </form>
            </div>
          )}

          {editar && (l.estado === "pedida" || l.estado === "confirmada") && (
            <details>
              <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>Cancelar esta limpeza</summary>
              <form action={cancelarAcao} className={styles.linha} style={{ alignItems: "flex-end", marginTop: 8 }}>
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="voltar" value={voltar} />
                <label>
                  Motivo
                  <input name="motivo" required maxLength={200} />
                </label>
                <div className={styles.acoes}>
                  <BotaoConfirmar pergunta="Cancelar esta limpeza?" style={{ background: "#b3261e" }}>
                    Cancelar limpeza
                  </BotaoConfirmar>
                </div>
              </form>
            </details>
          )}
        </section>
      ))}

      {editar && (
        <details>
          <summary style={{ cursor: "pointer" }}>Nova limpeza avulsa (fora de saída de reserva)</summary>
          <form action={avulsaAcao} className={styles.form} style={{ marginTop: 8 }}>
            <input type="hidden" name="voltar" value={voltar} />
            <div className={styles.linha}>
              <label>
                Imóvel
                <select name="imovelId" required defaultValue="">
                  <option value="">Escolha…</option>
                  {imoveis.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.codigo} · {i.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data
                <input type="date" name="data" required defaultValue={hoje} />
              </label>
              <label className={styles.largo}>
                Observação
                <input name="observacao" maxLength={500} placeholder="ex.: antes do uso do proprietário" />
              </label>
            </div>
            <div className={styles.acoes}>
              <button type="submit">Criar limpeza</button>
            </div>
          </form>
        </details>
      )}
    </>
  );
}
