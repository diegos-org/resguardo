import Link from "next/link";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { diasDoPeriodo, type ItemCalendario, mesesVizinhos, montarCalendario } from "@/calendario/grade";
import styles from "@/components/calendario/calendario.module.css";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { hojeISO } from "@/lib/datas";
import { filtrosParaQuery, lerFiltros, nomeDoMes, periodoDosFiltros } from "@/lib/filtros";
import { conflitos, NOMES_ORIGEM } from "@/reservas/regras";
import { itensDoCalendario, listarLimpezas, sincronizarLimpezas } from "@/limpezas/limpezas";
import { itensDoCalendario as manutencoesDoCalendario } from "@/manutencao/manutencao";
import { Bloqueios } from "@/components/calendario/Bloqueios";
import { listarBloqueios, listarReservas } from "@/reservas/repositorio";

const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

export default async function Calendario({ searchParams }: PageProps<"/painel/calendario">) {
  const sessao = await exigirSessaoPainel();
  const params = await searchParams;
  const db = getDb();
  const imoveis = await listarImoveis(db, sessao.organizacaoId);
  const opcoes = imoveis.map((i) => ({ codigo: i.codigo, nome: i.nome }));
  const lidos = lerFiltros(params, opcoes);
  // O calendário é sempre mensal: "ano inteiro" mostra janeiro.
  const filtros = { ...lidos, mes: lidos.mes ?? 1 };
  const periodo = periodoDosFiltros(filtros);
  const visiveis = filtros.imoveis.length ? imoveis.filter((i) => filtros.imoveis.includes(i.codigo)) : imoveis;
  const ids = visiveis.map((i) => i.id);

  // Limpezas só para quem pode vê-las (o proprietário não vê); geradas antes, como na tela de Limpezas.
  const verLimpezas = podeFazer(sessao.papel, "limpeza:ler") && ids.length > 0;
  if (verLimpezas) await sincronizarLimpezas(db, sessao.organizacaoId, periodo, sessao.usuarioId);
  // Manutenção feita só para quem pode ver manutenção (o proprietário não vê).
  const verManutencao = podeFazer(sessao.papel, "manutencao:ler");
  const hoje = hojeISO();
  const [reservas, bloqueios, limpezas, manutencoes] = await Promise.all([
    ids.length ? listarReservas(db, sessao.organizacaoId, { ...periodo, imovelIds: ids }) : [],
    ids.length ? listarBloqueios(db, sessao.organizacaoId, { ...periodo, imovelIds: ids }) : [],
    verLimpezas ? listarLimpezas(db, sessao.organizacaoId, { ...periodo, imovelIds: ids, hoje }) : [],
    verManutencao ? manutencoesDoCalendario(db, sessao.organizacaoId, { ...periodo, imovelIds: ids }) : [],
  ]);
  const emConflito = new Set(conflitos(reservas).flat());
  const itens: ItemCalendario[] = [
    ...reservas.map((r) => ({
      id: r.id,
      imovelId: r.imovelId,
      inicio: r.checkin,
      fim: r.checkout,
      tipo: "reserva" as const,
      rotulo: `${r.hospedeNome.split(" ")[0] || r.codigo} · ${NOMES_ORIGEM[r.origem]}`,
      href: `/painel/reservas/${r.id}`,
      categoria: r.origem,
      conflito: emConflito.has(r.id),
    })),
    ...bloqueios.map((b) => ({
      id: b.id,
      imovelId: b.imovelId,
      inicio: b.inicio,
      fim: b.fim,
      tipo: "bloqueio" as const,
      rotulo: b.motivo || "Bloqueado",
      categoria: "bloqueio",
    })),
    ...itensDoCalendario(limpezas),
    ...manutencoes,
  ];

  const dias = diasDoPeriodo(periodo.inicio, periodo.fim);
  const linhas = montarCalendario(periodo, ids, itens);
  const { anterior, seguinte } = mesesVizinhos(filtros.ano, filtros.mes);
  const link = (ano: number, mes: number) => `/painel/calendario?${filtrosParaQuery({ ...filtros, ano, mes })}`;
  const colunas = `minmax(90px, max-content) repeat(${dias.length}, minmax(34px, 1fr))`;

  return (
    <>
      <h1>Calendário</h1>
      {(sessao.papel === "admin" || sessao.papel === "operacao") && <p><Link href="/painel/calendario/previa">Conferir calendário e preços com o Beds24</Link></p>}
      <FiltroGlobal filtros={filtros} opcoes={opcoes} acao="/painel/calendario" />
      <nav className={styles.navegacao} aria-label="Mês">
        <Link href={link(anterior.ano, anterior.mes)} aria-label="Mês anterior">
          ←
        </Link>
        <strong>
          {nomeDoMes(filtros.mes).replace(/^./, (l) => l.toUpperCase())} de {filtros.ano}
        </strong>
        <Link href={link(seguinte.ano, seguinte.mes)} aria-label="Próximo mês">
          →
        </Link>
      </nav>
      <div className={styles.legenda}>
        {(["airbnb", "booking", "site", "outro"] as const).map((o) => (
          <span key={o}>
            <i className={styles[o]} /> {NOMES_ORIGEM[o]}
          </span>
        ))}
        <span>
          <i className={styles.bloqueio} /> Bloqueio
        </span>
        {verLimpezas && (
          <span>
            <i className={styles.limpeza} /> Limpeza
          </span>
        )}
        {verManutencao && (
          <span>
            <i className={styles.manutencao} /> Manutenção feita
          </span>
        )}
        <span>
          <i style={{ outline: "2px solid #b3261e" }} /> Overbooking ou aviso
        </span>
      </div>
      {visiveis.length === 0 ? (
        <p>Cadastre imóveis para ver o calendário.</p>
      ) : (
        <div className={styles.rolagem}>
          <div className={styles.grade} style={{ gridTemplateColumns: colunas }} role="grid" aria-label={`Calendário de ${nomeDoMes(filtros.mes)} de ${filtros.ano}`}>
            <div className={styles.cabecalhoImovel}>Imóvel</div>
            {dias.map((d) => {
              const semana = new Date(`${d}T12:00:00Z`).getUTCDay();
              const classes = [styles.dia, semana === 0 || semana === 6 ? styles.fimDeSemana : "", d === hoje ? styles.hoje : ""].join(" ");
              return (
                <div key={d} className={classes}>
                  {SEMANA[semana]}
                  <strong>{Number(d.slice(8))}</strong>
                </div>
              );
            })}
            {linhas.map((linha) => {
              const imovel = visiveis.find((i) => i.id === linha.imovelId)!;
              return (
                <div key={linha.imovelId} style={{ display: "contents" }}>
                  <div className={styles.nomeImovel} title={imovel.nome}>
                    {imovel.codigo}
                  </div>
                  <div
                    className={styles.linha}
                    style={{ gridTemplateColumns: `repeat(${dias.length}, minmax(34px, 1fr))`, gridTemplateRows: `repeat(${linha.faixas}, auto)` }}
                  >
                    {linha.segmentos.map((s) => {
                      const classes = [
                        styles.segmento,
                        styles[s.categoria],
                        s.continuaAntes ? styles.continuaAntes : "",
                        s.continuaDepois ? styles.continuaDepois : "",
                        s.conflito ? styles.conflito : "",
                      ].join(" ");
                      const estilo = { gridColumn: `${s.coluna} / span ${s.largura}`, gridRow: s.faixa + 1 };
                      const titulo = `${s.rotulo} (${s.inicio.split("-").reverse().join("/")} → ${s.fim.split("-").reverse().join("/")})`;
                      return s.href ? (
                        <Link key={s.id} href={s.href} className={classes} style={estilo} title={titulo}>
                          {s.rotulo}
                        </Link>
                      ) : (
                        <span key={s.id} className={classes} style={estilo} title={titulo}>
                          {s.rotulo}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {podeFazer(sessao.papel, "reserva:editar") && (
        <Bloqueios imoveis={imoveis.map((i) => ({ id: i.id, codigo: i.codigo }))} bloqueios={bloqueios.filter((b) => ids.includes(b.imovelId)).map((b) => ({ id: b.id, imovelId: b.imovelId, inicio: b.inicio, fim: b.fim, motivo: b.motivo, fonte: b.fonte }))} />
      )}
    </>
  );
}
