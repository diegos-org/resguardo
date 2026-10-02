"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { ConfigBeds24 } from "@/beds24/configuracao";
import { conferirQuartosBeds24, configurarSyncBeds24, importarBeds24Agora, vincularQuartoBeds24, type EstadoSyncBeds24 } from "@/beds24/sync-acoes";
import type { QuartoBeds24 } from "@/beds24/tipos";
import styles from "../formularios.module.css";

type Imovel = { id: string; codigo: string };
type Mapa = { id: string; imovelId: string; codigo: string; ativo: boolean; propertyId: string; roomId: string };
type Execucao = { id: string; quando: string; situacao: string; resumo: string; divergencias: string[] };
const inicial: EstadoSyncBeds24 = {};
const SITUACOES: Record<string, string> = { ok: "Concluída", parcial: "Concluída com avisos", erro: "Falhou", ocupada: "Outra execução em andamento", executando: "Em andamento", desligada: "Automática desligada" };

function Resultado({ estado }: { estado: EstadoSyncBeds24 }) {
  return <>
    <p role="status" aria-live="polite" className={estado.ok === false ? styles.erro : undefined}>{estado.mensagem}</p>
    {!!estado.divergencias?.length && <details open><summary>Avisos para conferir (até 100)</summary><ul>{estado.divergencias.map((d, i) => <li key={i}>{d}</li>)}</ul></details>}
  </>;
}

function Vinculo({ quarto, imoveis, mapa }: { quarto: QuartoBeds24; imoveis: Imovel[]; mapa?: Mapa }) {
  const [estado, enviar, pendente] = useActionState(vincularQuartoBeds24, inicial);
  return <li style={{ marginBottom: 16 }}>
    <p><strong>{quarto.nome || "Quarto sem nome"}</strong> — imóvel Beds24 {quarto.propertyId}, quarto {quarto.roomId}; moeda {quarto.moeda || "não informada"}.</p>
    {mapa ? <p>Vinculado a <Link href={`/painel/imoveis/${mapa.imovelId}`}>{mapa.codigo}</Link>{!mapa.ativo && " (arquivado; não será importado)"}.</p> :
      <form action={enviar} className={styles.form}>
        <input type="hidden" name="propertyId" value={quarto.propertyId} />
        <input type="hidden" name="roomId" value={quarto.roomId} />
        <label>Imóvel correspondente no SCL
          <select name="imovelId" required defaultValue=""><option value="" disabled>Escolha o imóvel</option>{imoveis.map(i => <option key={i.id} value={i.id}>{i.codigo}</option>)}</select>
        </label>
        <div className={styles.acoes}><button type="submit" disabled={pendente || !imoveis.length}>{pendente ? "Salvando…" : "Vincular quarto"}</button></div>
        <Resultado estado={estado} />
      </form>}
  </li>;
}

export function SincronizarBeds24({ config, mapas, imoveis, execucoes }: { config: ConfigBeds24; mapas: Mapa[]; imoveis: Imovel[]; execucoes: Execucao[] }) {
  const [busca, buscar, buscando] = useActionState(conferirQuartosBeds24, inicial);
  const [salvo, salvar, salvando] = useActionState(configurarSyncBeds24, inicial);
  const [importacao, importar, importando] = useActionState(importarBeds24Agora, inicial);
  const disponiveis = imoveis.filter(i => !mapas.some(m => m.imovelId === i.id));
  return <section aria-label="Importação do Beds24" style={{ display: "grid", gap: 16, maxWidth: 900 }}>
    <h2>Trazer reservas do Beds24 para o SCL</h2>
    <p>O mapeamento Airbnb → Beds24 não substitui os vínculos abaixo. Confira qual quarto corresponde a cada imóvel do SCL antes da primeira importação. Esta integração lê o Beds24; não envia mudanças para lá.</p>
    <h3>1. Conferir os vínculos</h3>
    {mapas.length > 0 ? <div className={styles.rolagem}><table className={styles.tabela}>
      <caption>Vínculos atuais — para corrigir ou remover, abra o imóvel e use “Canais e IDs externos”.</caption>
      <thead><tr><th>Imóvel SCL</th><th>Imóvel Beds24</th><th>Quarto Beds24</th><th>Situação</th></tr></thead>
      <tbody>{mapas.map(m => <tr key={m.id}><td><Link href={`/painel/imoveis/${m.imovelId}`}>{m.codigo}</Link></td><td>{m.propertyId}</td><td>{m.roomId || "Falta informar"}</td><td>{m.ativo ? "Ativo" : "Arquivado"}</td></tr>)}</tbody>
    </table></div> : <p>Nenhum vínculo Beds24 cadastrado.</p>}
    <form action={buscar}><button type="submit" className={styles.botao} disabled={buscando}>{buscando ? "Buscando…" : "Buscar quartos para vincular"}</button><Resultado estado={busca} /></form>
    {!!busca.quartos?.length && <ul style={{ paddingLeft: 24 }}>{busca.quartos.map(q => <Vinculo key={`${q.propertyId}/${q.roomId}`} quarto={q} imoveis={disponiveis} mapa={mapas.find(m => m.propertyId === q.propertyId && m.roomId === q.roomId)} />)}</ul>}
    <h3>2. Escolher o período e salvar</h3>
    <form action={salvar} className={styles.form}>
      <label>Trazer reservas com saída a partir de<input type="date" name="desde" required defaultValue={config.desde} /></label>
      <p>Reservas e bloqueios já importados continuam sendo conferidos mesmo quando suas datas mudam para antes desse período.</p>
      <label>Dias de calendário para consultar<input type="number" name="diasCalendario" min={1} max={365} required defaultValue={config.diasCalendario} /></label>
      <label className={styles.check}><input type="checkbox" name="automatica" defaultChecked={config.automatica} />Importar automaticamente uma vez por dia</label>
      <p>Deixe desligado no primeiro teste. Quando ligado, o agendamento roda diariamente entre 6h15 e 7h15, horário de Brasília. A atualização diária não serve como garantia de disponibilidade em tempo real para vendas.</p>
      <div className={styles.acoes}><button type="submit" disabled={salvando || importando}>{salvando ? "Salvando…" : "Salvar configuração"}</button></div>
      <Resultado estado={salvo} />
    </form>
    <h3>3. Importar e conferir</h3>
    <p>A importação cria ou atualiza reservas, bloqueios e observações de preço e estadia mínima. Reservas de planilha com o mesmo canal e código são reaproveitadas. Lançamentos realizados ou conciliados ficam protegidos; diferenças aparecem para conferência.</p>
    <form action={importar} className={styles.form}>
      <label className={styles.check}><input type="checkbox" name="confirmo" required />Conferi os vínculos e quero importar para o SCL usando a configuração salva.</label>
      <div className={styles.acoes}><button type="submit" disabled={importando || salvando || !mapas.some(m => m.ativo)}>{importando ? "Importando… aguarde" : "Importar agora"}</button></div>
      <Resultado estado={importacao} />
    </form>
    <p>Depois, confira <Link href="/painel/reservas">Reservas</Link> e <Link href="/painel/calendario">Calendário</Link>. Os preços lidos são observações do Beds24; ainda não são cotações para venda no site.</p>
    <h3>Últimas importações</h3>
    {!execucoes.length ? <p>Nenhuma importação registrada.</p> : <ul>{execucoes.map(e => <li key={e.id} style={{ marginBottom: 12 }}>
      <strong>{e.quando} — {SITUACOES[e.situacao] ?? e.situacao}</strong>
      <p><Link href={`/painel/reservas?escopo=historico&ordem=origem&execucao=${e.id}`}>Ver registros desta importação</Link></p>
      <p>{e.resumo || "Aguarde a conclusão e atualize a página. Se permanecer em andamento por mais de cinco minutos, confira antes de tentar novamente."}</p>
      {!!e.divergencias.length && <details><summary>Avisos (até 100)</summary><ul>{e.divergencias.map((d, i) => <li key={i}>{d}</li>)}</ul></details>}
    </li>)}</ul>}
  </section>;
}
