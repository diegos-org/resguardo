import { exigir, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { listarAnuncios } from "@/anuncios/repositorio";
import { QuadroAnuncios } from "@/components/anuncios/QuadroAnuncios";
import styles from "@/components/anuncios/anuncios.module.css";
import { getDb } from "@/db/client";
import { lerImoveisSelecionados } from "@/lib/filtros";
import { organizacaoDoSite } from "@/site/site";

export default async function Anuncios({ searchParams }: PageProps<"/painel/anuncios">) {
  const s = await exigirSessaoPainel();
  exigir(s, "imovel:ler", { organizacaoId: s.organizacaoId });
  const sp = await searchParams;
  const db = getDb();
  const [todos, siteOrg] = await Promise.all([listarAnuncios(db, s.organizacaoId), organizacaoDoSite(db)]);
  const selecionados = lerImoveisSelecionados(sp, todos);
  const incluirArquivados = sp.arquivados === "sim";
  const lista = todos.filter(i => (selecionados.length ? selecionados.includes(i.codigo) : i.ativo || incluirArquivados));
  return <>
    <h1>Anúncios</h1>
    <p>Compare as informações de cada imóvel no site, Airbnb e Booking.com.</p>
    <p className={styles.miudo}>Airbnb e Booking são referências preenchidas pela equipe. A importação de reservas do Beds24 não atualiza estas fichas. O filtro de imóveis se aplica aqui; mês e ano não alteram os anúncios.</p>
    <form className={styles.filtros} method="get" aria-label="Filtrar anúncios">
      <fieldset><legend>Escolher imóveis (opcional)</legend>
        <p className={styles.miudo}>Sem seleção específica, mostramos os ativos ou todos, conforme a opção abaixo.</p>
        {todos.map(i => <label key={i.id}><input type="checkbox" name="imovel" value={i.codigo} defaultChecked={selecionados.includes(i.codigo)} />{i.codigo} · {i.nome}{!i.ativo ? " (arquivado)" : ""}</label>)}
      </fieldset>
      {(["ano", "mes"] as const).flatMap(k => [sp[k] ?? []].flat().map(v => <input key={`${k}-${v}`} type="hidden" name={k} value={v} />))}
      <label>Imóveis<select name="arquivados" defaultValue={incluirArquivados ? "sim" : "nao"}><option value="nao">Ativos (e os selecionados)</option><option value="sim">Incluir arquivados</option></select></label><button type="submit">Aplicar</button>
    </form>
    <p>{lista.length} {lista.length === 1 ? "imóvel" : "imóveis"} nesta seleção.</p>
    {!lista.length ? <p>Nenhum imóvel nesta seleção.</p> : <div className={styles.lista}>{lista.map(i => <QuadroAnuncios key={i.id} imovel={i} podeEditar={podeFazer(s.papel, "imovel:editar")} siteDaOrg={siteOrg === s.organizacaoId} />)}</div>}
  </>;
}
