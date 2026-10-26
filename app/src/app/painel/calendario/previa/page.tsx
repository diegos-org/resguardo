import Link from "next/link";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { listarMapeamentosBeds24 } from "@/beds24/configuracao";
import { escritaBeds24Ligada } from "@/beds24/http";
import { nomeSituacaoEnvio, noitesDoEnvio, planejarImovel, ultimosEnvios } from "@/calendario/envio";
import type { LinhaPlano } from "@/calendario/motor";
import { validarIntervaloPrevia } from "@/calendario/previa";
import { APLICACOES_ULTIMA_HORA, lerRegrasCalendario } from "@/calendario/regras-config";
import { EnvioBeds24 } from "@/components/calendario/EnvioBeds24";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { EXPLICACAO_FONTE_PRECOS, NOMES_FONTE_PRECOS } from "@/imoveis/fonte-precos";
import { somarDias } from "@/imoveis/regras-venda";
import { listarImoveis } from "@/imoveis/repositorio";
import { dataBr, dataHoraNoFuso, diaDaSemana, DIAS_NA_ORDEM, hojeISO, INTERVALO_DA_SEMANA } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { descontoBp } from "@/marketplace/precos";
import { lerPrecosMarketplace } from "@/marketplace/precos-config";

const primeiro = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
const dinheiro = (v: number | null | undefined) => v === null || v === undefined ? "não informado" : formatBRL(v);
const numero = (v: number | null | undefined) => v === null || v === undefined ? "não informado" : String(v);
const instante = (d: Date, fuso: string) => dataHoraNoFuso(d, fuso);
const ACOES: Record<LinhaPlano["acao"], string> = { enviar: "Enviar (diferente ou sem leitura)", igual: "Igual: nada a enviar", sem_dados: "Nada a enviar" };
const BLOQUEIO: Record<string, string> = { blackout: "fechado", none: "aberto", exception: "exceção", noCheckIn: "sem entrada", noCheckOut: "sem saída", noCheckInOrCheckOut: "sem entrada nem saída" };

export default async function Previa({ searchParams }: PageProps<"/painel/calendario/previa">) {
  const s = await exigirSessaoPainel();
  if (s.papel !== "admin" && s.papel !== "operacao") redirect("/painel");
  exigir(s, "calendario:ler", { organizacaoId: s.organizacaoId });
  const sp = await searchParams;
  const db = getDb();
  const org = s.organizacaoId;
  const [imoveis, regras, mapas, precosMarketplace] = await Promise.all([listarImoveis(db, org, { incluirInativos: true }), lerRegrasCalendario(db, org), listarMapeamentosBeds24(db, org), lerPrecosMarketplace(db, org)]);
  // Preço aproximado no site por noite: o desconto do site (M12.1) é calculado sobre o total da estadia, então aqui é só referência.
  const bpSite = descontoBp(precosMarketplace);
  const siteAprox = (v: number | null) => v === null ? "—" : formatBRL(Math.round((v * (10000 - bpSite)) / 10000));
  // O piloto escolhido é só a seleção inicial. Nenhuma configuração é ativada aqui.
  const inicial = imoveis.find(i => i.ativo && i.codigo === "103") ?? imoveis.find(i => i.ativo && i.codigo === "403") ?? imoveis.find(i => i.ativo) ?? imoveis[0];
  const id = primeiro(sp.imovel) ?? inicial?.id;
  const escolhido = imoveis.find(i => i.id === id);
  const hoje = hojeISO(escolhido?.fuso);
  const inicio = primeiro(sp.inicio) ?? hoje;
  const fim = primeiro(sp.fim) ?? somarDias(hoje, 29);
  const erro = validarIntervaloPrevia(inicio, fim);
  const plano = escolhido && !erro ? await planejarImovel(db, org, regras, escolhido, new Date(), { inicio, fim }, { paraOBeds24: true }) : null;
  const vinculos = escolhido ? mapas.filter(m => m.imovelId === escolhido.id) : [];
  const execucaoId = primeiro(sp.execucao);
  const [envios, noitesExecucao] = s.papel === "admin" ? await Promise.all([ultimosEnvios(db, org, 10), execucaoId && uuidValido(execucaoId) ? noitesDoEnvio(db, org, execucaoId) : Promise.resolve([])]) : [[], []];
  const permiteDia = (dias: readonly number[], d: string) => !dias.length || dias.includes(diaDaSemana(d));
  const comLeitura = plano?.linhas.filter(l => l.observacao).length ?? 0;
  const aEnviar = plano?.linhas.filter(l => l.acao === "enviar").length ?? 0;
  // Só disponibilidade (M3.11b): preço, mínimo e máximo ficam no Beds24; as colunas do SCL mostram "—" e a do Beds24, o lido.
  const soDisponibilidade = plano?.fontePrecos === "so_disponibilidade";
  const passadas = plano && inicio < plano.hoje ? `Noites antes de hoje (${dataBr(plano.hoje)}) não aparecem: o cadastro atual não reconstitui tarifas passadas.` : null;
  return <>
    <h1>Conferir calendário e preços</h1>
    <p><Link href="/painel/calendario">Voltar ao calendário</Link>{s.papel === "admin" && <> · <Link href="/painel/configuracoes/calendario">Regras de calendário e preços</Link></>}</p>
    <p>Para cada noite, o que o SCL considera oficial (preço, estadia mínima/máxima, bloqueio) ao lado da última leitura do Beds24. O envio ao Beds24 é feito só pelo administrador, por imóvel, com simulação antes.</p>
    <form method="get" className={styles.form} aria-label="Escolher imóvel e noites">
      <div className={styles.linha}>
        <label>Imóvel<select name="imovel" defaultValue={escolhido?.id ?? ""} required>
          {!escolhido && <option value="">Escolha um imóvel</option>}
          {imoveis.map(i => <option key={i.id} value={i.id}>{i.codigo} · {i.nome}{!i.ativo ? " (arquivado)" : ""}</option>)}
        </select></label>
        <label>Primeira noite<input name="inicio" type="date" min="2000-01-01" max="2100-12-31" defaultValue={inicio} required /></label>
        <label>Última noite<input name="fim" type="date" min="2000-01-01" max="2100-12-31" defaultValue={fim} required /></label>
      </div>
      <p>Até 92 noites por consulta, incluindo a primeira e a última. Troque o intervalo para conferir o restante do horizonte.</p>
      <button type="submit">Conferir</button>
    </form>
    {erro && <p role="alert" className={styles.alerta}>{erro}</p>}
    {!imoveis.length ? <p>Cadastre um imóvel para começar.</p> : !escolhido && <p role="alert">Imóvel não encontrado nesta empresa. Escolha um imóvel da lista.</p>}
    {plano && escolhido && <>
      <h2>{escolhido.codigo} · {escolhido.nome}</h2>
      {!escolhido.ativo && <p className={styles.alerta}>Imóvel arquivado. Esta consulta não o reativa.</p>}
      {passadas && <p>{passadas}</p>}
      <p>{plano.linhas.length} noites nesta consulta · {comLeitura} com leitura do Beds24 · {aEnviar} a enviar (diferentes ou sem leitura) · {plano.linhas.filter(l => l.avisos.length).length} com avisos.</p>
      <p>Datas e horários no fuso {escolhido.fuso}. Mesmo valor registrado não comprova o preço final no Airbnb ou Booking: taxas, limpeza, hóspedes extras e descontos por duração dos canais ficam fora desta comparação.</p>
      {vinculos.length !== 1 ? <p className={styles.alerta}>{vinculos.length ? "Há vários vínculos Beds24: confira o mapeamento antes de qualquer envio." : "Sem vínculo Beds24. Configure o mapeamento para importar e enviar este imóvel."}</p> :
        <p>Vínculo atual: propriedade {vinculos[0].propertyId || "não informada"} · quarto {vinculos[0].roomId || "não informado"}.</p>}
      <p>Regras em vigor: mínimo por dia da semana {DIAS_NA_ORDEM.map((n) => regras.minimoPorDia[n]).join("/")} ({INTERVALO_DA_SEMANA}) · máximo {plano.regras.estadiaMaxima ?? regras.estadiaMaxima} noites · feriados cadastrados: {regras.feriados.length} · eventos: {regras.eventos.filter(e => e.todosImoveis || e.imoveis.includes(escolhido.id)).length} neste imóvel · última hora: {APLICACOES_ULTIMA_HORA[regras.ultimaHora.aplicadoPor]} ({regras.ultimaHora.faixas.map(f => `D−${f.ateDias} a D−${f.deDias}: ${f.percentual}%`).join("; ")}) · pisos deste imóvel: {dinheiro(plano.pisos[0])} / {dinheiro(plano.pisos[1])}.</p>
      {regras.ultimaHora.aplicadoPor === "beds24" && <p>Com o Beds24 aplicando a última hora, o SCL envia a referência e eleva o valor enviado só quando o desconto nativo cairia abaixo do piso. O preço final mostrado é o esperado após a regra nativa; a releitura confirma o que o Beds24 gravou, não a cotação final nos canais.</p>}
      <p><strong>Fonte de preços deste imóvel:</strong> {NOMES_FONTE_PRECOS[plano.fontePrecos]}. {EXPLICACAO_FONTE_PRECOS[plano.fontePrecos]}{plano.fontePrecos === "beds24" ? " Nesta tela, o preço de cada noite é o da coluna Beds24; o SCL envia só mínimos, máximos e bloqueios." : ""}{soDisponibilidade ? " Nesta tela, preço, mínimo e máximo de cada noite são os da coluna Beds24; o SCL envia só os bloqueios do SCL." : ""}</p>
      <p>Coluna “Site (≈)”: preço da noite no site com o desconto do site de aproximadamente {(bpSite / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% (Configurações → Marketplace e desconto do site). É referência por noite: o desconto real é calculado sobre o total da estadia. Serve para conferir a promessa de preço abaixo das plataformas contra o que o hóspede vê no Airbnb e no Booking.</p>
      <p>Antecedência mínima: {numero(plano.regras.antecedenciaMinima)} dias · Horizonte do cadastro: {numero(plano.regras.janelaMaxima)} dias. Dias de entrada/saída restritos no cadastro não são enviados ao Beds24 nesta etapa.</p>
      {s.papel === "admin" && <p><Link href={`/painel/imoveis/${escolhido.id}`}>Editar base, períodos, pisos e regras do imóvel</Link> · <Link href="/painel/configuracoes/integracoes">Importação do Beds24</Link></p>}
      <div className={styles.rolagem}>
        <table className={styles.tabela}>
          <caption>Plano do SCL por noite e última leitura do Beds24 — esta tela não envia nada</caption>
          <thead><tr><th scope="col">Noite</th><th scope="col">Preço: referência → enviar (final esperado) / Beds24</th><th scope="col">Site (≈)</th><th scope="col">Mínimo: regra → enviar / Beds24</th><th scope="col">Máximo</th><th scope="col">Ocupação e bloqueio</th><th scope="col">Entrada / saída no cadastro</th><th scope="col">Ação</th><th scope="col">Leitura e avisos</th></tr></thead>
          <tbody>{plano.linhas.map(l => <tr key={l.data}>
            <th scope="row">{dataBr(l.data)}<br /><small>D{l.antecedencia === 0 ? "0" : `−${l.antecedencia}`}</small></th>
            <td>{soDisponibilidade ? "—" : `${dinheiro(l.precoReferencia)} → ${dinheiro(l.precoEnviar)} (${dinheiro(l.precoFinalEsperado)})`} / {dinheiro(l.observacao?.preco)}<br /><small>{l.motivoPreco}{l.percentualUltimaHora ? ` · última hora ${l.percentualUltimaHora}%${l.piso !== null ? `, piso ${formatBRL(l.piso)}` : ""}` : ""}</small></td>
            <td>{siteAprox(l.precoFinalEsperado)}</td>
            <td>{soDisponibilidade ? "—" : `${numero(l.minimoRegra)} → ${numero(l.minimoEnviar)}`} / {numero(l.observacao?.minimoNoites)}<br /><small>{l.motivoMinimo}</small></td>
            <td>{l.maximoEnviar ?? "—"} / {numero(l.observacao?.maximoNoites)}</td>
            <td>{l.reservas} reserva(s){l.bloqueioScl ? " · bloqueio do SCL" : ""}{l.livresSeguidas !== null && l.livresSeguidas > 0 ? ` · ${l.livresSeguidas} noite(s) livre(s) seguidas` : ""}<br /><small>Beds24: {numero(l.observacao?.livres)} livre(s), {l.observacao ? BLOQUEIO[l.observacao.bloqueio ?? "none"] ?? l.observacao.bloqueio : "sem leitura"}{l.bloqueioEnviar ? ` → enviar ${BLOQUEIO[l.bloqueioEnviar]}` : ""}</small></td>
            <td>{permiteDia(plano.regras.diasChegada, l.data) ? "Entrada não restringida" : "Entrada restringida"}<br />{permiteDia(plano.regras.diasSaida, l.data) ? "Saída não restringida" : "Saída restringida"}</td>
            <td>{ACOES[l.acao]}{l.enviado ? <><br /><small>Último envio: {instante(l.enviado.enviadoEm, escolhido.fuso)}{l.enviado.confirmado ? ", confirmado" : ", sem confirmação"}</small></> : null}</td>
            <td>{l.observacao ? instante(l.observacao.observadoEm, escolhido.fuso) : "Sem leitura"}{l.avisos.length > 0 && <ul>{l.avisos.map(a => <li key={a}>{a}</li>)}</ul>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {s.papel === "admin" && <>
        <EnvioBeds24 imovelId={escolhido.id} codigo={escolhido.codigo} escritaLigada={escritaBeds24Ligada()} envioLigado={regras.envio.imoveis.includes(escolhido.id)} vinculoOk={vinculos.length === 1 && /^\d+$/.test(vinculos[0].propertyId) && /^\d+$/.test(vinculos[0].roomId)} horizonteDias={regras.horizonteDias} />
        <h3>Últimos envios e simulações</h3>
        {!envios.length ? <p>Nenhum envio registrado.</p> : <ul>{envios.map(e => <li key={e.id} style={{ marginBottom: 8 }}>
          <strong>{instante(e.iniciadoEm, escolhido.fuso)} — {nomeSituacaoEnvio(e.situacao)}{e.automatica ? " (automático)" : ""}</strong>
          <p>{e.resumo || "Em andamento ou interrompido. Se continuar assim por mais de cinco minutos, confira antes de tentar de novo."}</p>
          {e.modo === "envio" && e.noites > 0 && <p><Link href={`/painel/calendario/previa?imovel=${escolhido.id}&inicio=${inicio}&fim=${fim}&execucao=${e.id}`}>Ver noites deste envio</Link></p>}
          {e.avisos.length > 0 && <details><summary>Avisos (até 100)</summary><ul>{e.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
        </li>)}</ul>}
        {noitesExecucao.length > 0 && <div className={styles.rolagem}><table className={styles.tabela}>
          <caption>Noites do envio escolhido (até 200): antes → enviado, regra e conferência</caption>
          <thead><tr><th>Imóvel</th><th>Noite</th><th>Preço antes → enviado</th><th>Mínimo antes → enviado</th><th>Máx.</th><th>Bloqueio antes → enviado</th><th>Regra</th><th>Resultado</th></tr></thead>
          <tbody>{noitesExecucao.map((n, i) => <tr key={i}><td>{n.codigo}</td><td>{dataBr(n.data)}</td><td>{dinheiro(n.precoAntes)} → {dinheiro(n.precoEnviado)}</td><td>{numero(n.minimoAntes)} → {numero(n.minimoEnviado)}</td><td>{numero(n.maximoEnviado)}</td><td>{n.bloqueioAntes ?? "—"} → {n.bloqueioEnviado ?? "—"}</td><td><small>{n.regra}</small></td><td>{n.resultado}{n.detalhe && <><br /><small>{n.detalhe}</small></>}</td></tr>)}</tbody>
        </table></div>}
      </>}
    </>}
  </>;
}
