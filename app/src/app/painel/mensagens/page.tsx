import Link from "next/link";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { AvisoSemAcesso, AvisosWhatsapp } from "@/components/mensagens/AvisosWhatsapp";
import { ListaConversas } from "@/components/mensagens/ListaConversas";
import styles from "@/components/mensagens/mensagens.module.css";
import { getDb } from "@/db/client";
import { podeVerConversas } from "@/whatsapp/acesso";
import { recebimentoLigado } from "@/whatsapp/ambiente";
import { CONVERSAS_POR_PAGINA, FILTROS_CONVERSAS, type FiltroConversas, listarConversas } from "@/whatsapp/conversas";
import { contaDoWhatsapp } from "@/whatsapp/integracao";

const ROTULO_FILTRO: Record<FiltroConversas, string> = { todas: "Todas", sem_resposta: "Sem resposta", sem_vinculo: "Sem vínculo" };

const umValor = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Filtro fora da lista vale "todas". */
const lerFiltro = (v: string | string[] | undefined): FiltroConversas => {
  const f = umValor(v);
  return f && (FILTROS_CONVERSAS as readonly string[]).includes(f) ? (f as FiltroConversas) : "todas";
};
/** Página: inteiro de 1 em diante (outro valor vale 1; a consulta corta no fim). */
const lerPagina = (v: string | string[] | undefined) => {
  const p = umValor(v);
  return p && /^\d{1,6}$/.test(p) && Number(p) >= 1 ? Number(p) : 1;
};
const linkDe = (filtro: FiltroConversas, pagina = 1) => {
  const q = new URLSearchParams();
  if (filtro !== "todas") q.set("filtro", filtro);
  if (pagina > 1) q.set("pagina", String(pagina));
  const s = q.toString();
  return s ? `/painel/mensagens?${s}` : "/painel/mensagens";
};

/**
 * Caixa de entrada do WhatsApp (M10.1a, desenho na seção "Telas e acesso" de `requisitos/product/WHATSAPP.md`): só
 * leitura, sem resposta pelo painel (M10.2). Quem não vê as conversas (a configuração "Quem vê as conversas", padrão só o
 * admin, decidida em `whatsapp/acesso.ts`) recebe só o aviso, sem nenhuma leitura das conversas. Os filtros de imóvel e
 * período do painel não valem aqui (as conversas não são por imóvel).
 */
export default async function Mensagens({ searchParams }: PageProps<"/painel/mensagens">) {
  const sessao = await exigirSessaoPainel();
  const db = getDb();
  if (!(await podeVerConversas(db, sessao))) return <AvisoSemAcesso />;
  const params = await searchParams;
  const filtro = lerFiltro(params.filtro);
  const [lista, conta] = await Promise.all([listarConversas(db, sessao, { filtro, pagina: lerPagina(params.pagina) }), contaDoWhatsapp(db, sessao.organizacaoId, new Date())]);
  // O aviso da chave só para quem pode mudá-la; a operação (quando liberada) não recebe nada da configuração.
  const recebimento = podeFazer(sessao.papel, "configuracao:editar") ? recebimentoLigado(process.env) : null;
  const de = (lista.pagina - 1) * CONVERSAS_POR_PAGINA + 1;
  const ate = de + lista.itens.length - 1;
  return (
    <>
      <header className={styles.cabecalho}>
        <h1>Mensagens</h1>
        <p className={styles.subtitulo}>
          Conversas do WhatsApp da empresa. Tudo o que aparece aqui também está no celular. Para responder, use o celular: a resposta pelo painel chega numa próxima
          etapa.
        </p>
      </header>
      <AvisosWhatsapp conta={{ situacao: conta.situacao, motivo: conta.motivo, situacaoEm: conta.situacaoEm, prazo24h: conta.prazo24h, recebimentoLigado: recebimento }} />
      <nav aria-label="Filtros das conversas">
        <ul className={styles.filtros}>
          {FILTROS_CONVERSAS.map((f) => (
            <li key={f}>
              <Link href={linkDe(f)} aria-current={f === filtro ? "page" : undefined}>
                {ROTULO_FILTRO[f]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <ListaConversas itens={lista.itens} vazio={filtro === "todas" ? "Nenhuma conversa ainda." : "Nenhuma conversa neste filtro."} />
      {lista.total > 0 && (
        <p className={styles.paginacao}>
          <span>{`Mostrando ${de}–${ate} de ${lista.total}.`}</span>
          {lista.pagina > 1 && <Link href={linkDe(filtro, lista.pagina - 1)}>Anteriores</Link>}
          {lista.pagina < lista.paginas && <Link href={linkDe(filtro, lista.pagina + 1)}>Seguintes</Link>}
        </p>
      )}
    </>
  );
}
