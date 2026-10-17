import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe } from "@/auditoria/auditoria";
import formStyles from "@/components/formularios.module.css";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { AvisoSemAcesso } from "@/components/mensagens/AvisosWhatsapp";
import { Conversa } from "@/components/mensagens/Conversa";
import { MarcarComoLida } from "@/components/mensagens/MarcarComoLida";
import { PainelVinculo } from "@/components/mensagens/PainelVinculo";
import styles from "@/components/mensagens/mensagens.module.css";
import { getDb } from "@/db/client";
import { uuidValido } from "@/lib/ids";
import { podeVerConversas } from "@/whatsapp/acesso";
import { obterConversa } from "@/whatsapp/conversas";
import { candidatosDaConversa } from "@/whatsapp/vinculo";

/** O resultado das ações, só pelas chaves conhecidas (outra chave na URL não aparece). */
const FEITO: Record<string, string> = { vinculada: "Conversa vinculada.", desfeito: "Vínculo desfeito." };
const ERRO: Record<string, string> = {
  codigo_invalido: "Esse código não está no formato SCL-XXXXXX ou COT-XXXXXXXX.",
  codigo_nao_encontrado: "Nenhuma reserva ou cotação com esse código.",
  alvo_nao_encontrado: "Não encontramos esse cadastro. Atualize a página.",
  ja_vinculada: "Esta conversa já está vinculada. Desfaça o vínculo antes de escolher outro.",
};
const daLista = (lista: Record<string, string>, v: string | string[] | undefined) => (typeof v === "string" && Object.hasOwn(lista, v) ? lista[v] : null);

/**
 * Uma conversa do WhatsApp (M10.1a): as 200 mensagens mais recentes, só leitura (sem caixa de resposta: responder pelo
 * celular), o vínculo confirmado ou as sugestões calculadas na hora e o histórico do vínculo. Quem não vê as conversas
 * recebe só o aviso, sem leitura; id malformado ou conversa de outra empresa → 404. O "lida" é marcado pelo navegador
 * depois de aberta (`MarcarComoLida`), nunca aqui.
 */
export default async function PaginaConversa({ params, searchParams }: PageProps<"/painel/mensagens/[id]">) {
  const sessao = await exigirSessaoPainel();
  const db = getDb();
  if (!(await podeVerConversas(db, sessao))) return <AvisoSemAcesso />;
  const { id } = await params;
  if (!uuidValido(id)) notFound();
  const conversa = await obterConversa(db, sessao, id);
  if (!conversa) notFound();
  const { feito, erro } = await searchParams;
  // Lidos só depois de a conversa existir na organização da sessão (o mesmo controle de acesso).
  const [sugestoes, historico] = await Promise.all([
    conversa.vinculo ? Promise.resolve(null) : candidatosDaConversa(db, sessao, conversa.id, new Date()),
    historicoDe(db, sessao.organizacaoId, "whatsapp_conversa", conversa.id),
  ]);
  const resultado = daLista(FEITO, feito);
  const problema = daLista(ERRO, erro);
  return (
    <>
      <Link href="/painel/mensagens" className={styles.link}>
        ← Mensagens
      </Link>
      <header className={styles.cabecalho}>
        <h1 style={{ overflowWrap: "anywhere" }}>{conversa.nome}</h1>
        <p className={styles.subtitulo}>{conversa.telefone ? `WhatsApp: ${conversa.telefone}` : "Contato com nome de usuário, sem número"}</p>
      </header>
      {/* O resultado das ações nas cores do resto do painel: sucesso em verde, erro em vermelho (formularios.module.css). */}
      {resultado && (
        <p role="status" className={formStyles.sucesso} style={{ margin: 0, maxWidth: 820 }}>
          {resultado}
        </p>
      )}
      {problema && (
        <p role="alert" className={formStyles.alerta} style={{ margin: 0, maxWidth: 820 }}>
          {problema}
        </p>
      )}
      {conversa.conflitoIdentidade && (
        <p role="alert" className={`${styles.aviso} ${styles.avisoGrave}`}>
          Este contato pode ser o mesmo de outra conversa (o WhatsApp trocou o número ou a identificação). Confira no celular antes de vincular.
        </p>
      )}
      <Conversa mensagens={conversa.mensagens} maisMensagens={conversa.maisMensagens} />
      {conversa.naoLida && conversa.ultimaRecebidaEm && <MarcarComoLida contatoId={conversa.id} ate={conversa.ultimaRecebidaEm.toISOString()} />}
      <PainelVinculo contatoId={conversa.id} vinculo={conversa.vinculo} sugestoes={sugestoes} />
      <HistoricoAlteracoes linhas={historico} />
    </>
  );
}
