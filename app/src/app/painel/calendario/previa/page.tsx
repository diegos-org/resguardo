import Link from "next/link";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { carregarPrevia } from "@/calendario/previa-repositorio";
import { validarIntervaloPrevia, type Comparacao } from "@/calendario/previa";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { somarDias } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";
import { formatBRL } from "@/lib/money";

const primeiro = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;
const dinheiro = (v: number | null) => v === null ? "Não informado" : formatBRL(v);
const numero = (v: number | null) => v === null ? "Não informado" : String(v);
const comparacoes: Record<Comparacao, string> = { igual: "Mesmo valor registrado", diferente: "Diferença para conferir", sem_dados: "Comparação incompleta" };
const instante = (d: Date, fuso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, dateStyle: "short", timeStyle: "short" }).format(d);

export default async function Previa({ searchParams }: PageProps<"/painel/calendario/previa">) {
  const s = await exigirSessaoPainel();
  if (s.papel !== "admin" && s.papel !== "operacao") redirect("/painel");
  exigir(s, "calendario:ler", { organizacaoId: s.organizacaoId });
  const sp = await searchParams;
  const db = getDb();
  const imoveis = await listarImoveis(db, s.organizacaoId, { incluirInativos: true });
  // O piloto escolhido é só a seleção inicial. Nenhuma configuração é ativada aqui.
  const inicial = imoveis.find(i => i.ativo && i.codigo === "103") ?? imoveis.find(i => i.ativo && i.codigo === "403") ?? imoveis.find(i => i.ativo) ?? imoveis[0];
  const id = primeiro(sp.imovel) ?? inicial?.id;
  const escolhido = imoveis.find(i => i.id === id);
  const hoje = hojeISO(escolhido?.fuso);
  const inicio = primeiro(sp.inicio) ?? hoje;
  const fim = primeiro(sp.fim) ?? somarDias(hoje, 29);
  const erro = validarIntervaloPrevia(inicio, fim);
  const previa = escolhido && !erro ? await carregarPrevia(db, s.organizacaoId, escolhido.id, inicio, fim) : null;
  const comLeitura = previa?.linhas.filter(l => l.observacao).length ?? 0;
  const comDiferenca = previa?.linhas.filter(l => l.comparacaoPreco === "diferente" || l.comparacaoMinimo === "diferente").length ?? 0;
  return <>
    <h1>Conferir calendário e preços</h1>
    <p><Link href="/painel/calendario">Voltar ao calendário</Link></p>
    <p>Compare o cadastro atual do SCL com a última leitura importada do Beds24, noite por noite. Esta prévia não envia alterações nem confirma disponibilidade para venda.</p>
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
    {previa && <>
      <h2>{previa.imovel.codigo} · {previa.imovel.nome}</h2>
      {!previa.imovel.ativo && <p className={styles.alerta}>Imóvel arquivado. Esta consulta não o reativa.</p>}
      <p>{previa.linhas.length} noites nesta consulta · {comLeitura} com leitura do Beds24 · {comDiferenca} com diferença de preço ou mínimo.</p>
      <p>Datas e horários no fuso {previa.imovel.fuso}. As leituras podem ser de momentos diferentes; veja o horário de cada noite. Mesmo valor registrado não comprova o preço atual no canal.</p>
      {previa.vinculos.length !== 1 ? <p className={styles.alerta}>{previa.vinculos.length ? "Há vários vínculos Beds24: confira o mapeamento antes de qualquer envio." : "Sem vínculo Beds24. Configure o mapeamento para importar este imóvel."}</p> :
        <p>Vínculo atual: propriedade {previa.vinculos[0].propertyId || "não informada"} · quarto {previa.vinculos[0].roomId || "não informado"}. O vínculo atual não comprova a origem de uma leitura anterior à sua alteração.</p>}
      <aside className={styles.alerta} aria-label="Limites desta prévia">
        <strong>Envio ao Beds24 ainda não implementado</strong>
        <p>Os preços do SCL usam a base e os períodos cadastrados. Não calculam automaticamente feriados, multiplicadores, última hora ou ajuste de mínimos nas sobras entre reservas. O Beds24 pode aplicar descontos e regras adicionais; eles não são reproduzidos nesta comparação.</p>
        <p>Preço registrado no calendário não é cotação final no Airbnb ou Booking. Taxas, limpeza, hóspedes extras e descontos por duração precisam ser conferidos separadamente. Não copie estes valores para os canais sem essa conferência.</p>
      </aside>
      <p>Máximo de noites no cadastro: {numero(previa.regras.estadiaMaxima)} · Antecedência mínima: {numero(previa.regras.antecedenciaMinima)} dias · Horizonte: {numero(previa.regras.janelaMaxima)} dias.</p>
      {previa.regras.precoDinamico && <p>Limites do preço base: {dinheiro(previa.regras.precoMinimo)} a {dinheiro(previa.regras.precoMaximo)}. O preço explícito de um período é preservado.</p>}
      {s.papel === "admin" && <p><Link href={`/painel/imoveis/${previa.imovel.id}`}>Editar base, períodos e regras do imóvel</Link> · <Link href="/painel/configuracoes/integracoes">Consultar importação do Beds24</Link></p>}
      <div className={styles.rolagem}>
        <table className={styles.tabela}>
          <caption>Cadastro SCL e observações importadas — nenhum valor foi enviado</caption>
          <thead><tr><th scope="col">Noite</th><th scope="col">Preço SCL / Beds24</th><th scope="col">Mínimo SCL / Beds24</th><th scope="col">Ocupação registrada</th><th scope="col">Entrada / saída no cadastro</th><th scope="col">Leitura e avisos</th></tr></thead>
          <tbody>{previa.linhas.map(l => <tr key={l.data}>
            <th scope="row">{l.data.split("-").reverse().join("/")}</th>
            <td>{dinheiro(l.preco.valor)} / {dinheiro(l.observacao?.preco ?? null)}<br /><small>{l.preco.fonte === "periodo" ? `Período: ${l.preco.periodo}` : l.preco.fonte === "base" ? "Preço base" : "Sem preço SCL"}{l.preco.ajustado ? " (limitado ao piso/teto)" : ""}</small><br /><small>{comparacoes[l.comparacaoPreco]}</small></td>
            <td>{numero(l.minimo)} / {numero(l.observacao?.minimoNoites ?? null)}<br /><small>Mínimo do SCL na entrada</small><br /><small>{comparacoes[l.comparacaoMinimo]}</small></td>
            <td>{l.reservas} reserva(s) · {l.bloqueios} bloqueio(s)<br /><small>Unidades livres informadas pelo Beds24: {numero(l.observacao?.livres ?? null)}</small><br /><small>Ausência de reserva local não significa data livre.</small></td>
            <td>{l.entradaPeloCadastro ? "Entrada não restringida" : "Entrada restringida"}<br />{l.saidaPeloCadastro ? "Saída não restringida" : "Saída restringida"}<br /><small>Somente regras locais de dia e antecedência; não considera ocupação, duração nem confirmação manual de hoje.</small></td>
            <td>{l.observacao ? instante(l.observacao.observadoEm, previa.imovel.fuso) : "Sem leitura"}{l.avisos.length > 0 && <ul>{l.avisos.map(a => <li key={a}>{a}</li>)}</ul>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </>;
}
