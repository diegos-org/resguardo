import Link from "next/link";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { AutorizacaoRegistrada } from "@/components/proprietarios/AutorizacaoRegistrada";
import { getDb } from "@/db/client";
import { arquivarPedidoAcao, marcarRespondidoAcao } from "@/proprietarios/acoes-contatos";
import { soDigitos } from "@/proprietarios/documento";
import {
  descreverAnunciaHoje,
  descreverQuartos,
  type ErroDecisao,
  listarPedidosContato,
  MAX_NOTA,
  NOVOS_POR_PAGINA,
  type PedidoContatoComAutor,
  TEXTO_ERRO_DECISAO,
} from "@/proprietarios/pedidos-contato";
import { numeroWhatsapp } from "@/site/site";

const quando = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
/** Endereço digitado pela pessoa: cada parte codificada, para "?" ou "&" no e-mail não virarem cópia ou assunto. */
const mailto = (email: string) => `mailto:${email.split("@").map(encodeURIComponent).join("@")}`;
/** WhatsApp com o 55 quando a pessoa deixou só DDD + número. */
const whatsapp = (telefone: string) => `https://wa.me/${numeroWhatsapp(telefone) ?? soDigitos(telefone)}`;

const FEITO: Record<string, string> = { respondido: "Pedido marcado como respondido.", arquivado: "Pedido arquivado. Ele continua em “Já tratados”." };
const dl = { display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "4px 16px", margin: 0 } as const;

function Contato({ p }: { p: PedidoContatoComAutor }) {
  return (
    <>
      <a href={mailto(p.email)}>{p.email}</a>
      {" · "}
      {p.telefone}{" "}
      {/* Abre fora do painel, sem passar nada da tela. */}
      <a href={whatsapp(p.telefone)} target="_blank" rel="noopener noreferrer">
        WhatsApp
      </a>
    </>
  );
}

/** Pedidos de contato para a gestão completa vindos do site (M7.7): a equipe responde e marca aqui. */
export default async function PedidosContato({ searchParams }: PageProps<"/painel/proprietarios/contatos">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "proprietario:editar")) {
    return (
      <>
        <h1>Pedidos de contato (gestão completa)</h1>
        <p>Esta área tem dados pessoais e é restrita aos administradores.</p>
      </>
    );
  }
  const params = await searchParams;
  const feito = typeof params.feito === "string" && Object.hasOwn(FEITO, params.feito) ? FEITO[params.feito] : null;
  const erro = typeof params.erro === "string" && Object.hasOwn(TEXTO_ERRO_DECISAO, params.erro) ? TEXTO_ERRO_DECISAO[params.erro as ErroDecisao] : null;
  const pagina = typeof params.pagina === "string" && /^\d{1,4}$/.test(params.pagina) && Number(params.pagina) >= 1 ? Number(params.pagina) : 1;
  const { novos, totalNovos, decididos } = await listarPedidosContato(getDb(), sessao.organizacaoId, pagina);
  const paginas = Math.max(1, Math.ceil(totalNovos / NOVOS_POR_PAGINA));
  const primeiro = (pagina - 1) * NOVOS_POR_PAGINA + 1;
  return (
    <>
      <div className={styles.topo}>
        <h1>Pedidos de contato (gestão completa)</h1>
        <Link href="/painel/proprietarios">Voltar para Proprietários</Link>
      </div>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820 }}>
        Proprietários que pediram, na página &ldquo;Anuncie seu imóvel&rdquo; do site, que a equipe fale com eles sobre a gestão completa. Responda pelo
        e-mail ou WhatsApp e depois marque como respondido. Nada aqui cria proprietário ou imóvel: se fecharem negócio, cadastre em &ldquo;Novo
        proprietário&rdquo;.
      </p>
      {feito && (
        <p role="status" className={styles.sucesso}>
          {feito}
        </p>
      )}
      {erro && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}

      <h2>Novos{totalNovos ? ` (${totalNovos})` : ""}</h2>
      {totalNovos > NOVOS_POR_PAGINA && (
        <nav aria-label="Páginas dos pedidos novos" className={styles.linha} style={{ alignItems: "center", fontSize: "0.875rem" }}>
          <span>
            {novos.length ? `Mostrando ${primeiro}–${primeiro + novos.length - 1} de ${totalNovos}, dos mais antigos para os mais novos.` : `Esta página não tem pedidos (são ${paginas}).`}
          </span>
          {pagina > 1 && <Link href={`/painel/proprietarios/contatos?pagina=${Math.min(pagina - 1, paginas)}`}>Anteriores</Link>}
          {pagina < paginas && <Link href={`/painel/proprietarios/contatos?pagina=${pagina + 1}`}>Próximos</Link>}
        </nav>
      )}
      {novos.length === 0 ? (
        <p>{totalNovos ? "Nenhum pedido nesta página." : "Nenhum pedido esperando resposta."}</p>
      ) : (
        novos.map((p) => (
          <section key={p.id} aria-label={`Pedido de ${p.nome}`} className={styles.form}>
            <h3 style={{ fontSize: "1.125rem", margin: 0 }}>
              {p.nome} · {p.bairro}, {p.cidade}
            </h3>
            <dl style={dl}>
              <dt>Contato</dt>
              <dd style={{ margin: 0 }}>
                <Contato p={p} />
              </dd>
              <dt>Quartos</dt>
              <dd style={{ margin: 0 }}>{descreverQuartos(p.quartos)}</dd>
              <dt>Já anuncia</dt>
              <dd style={{ margin: 0 }}>{descreverAnunciaHoje(p.anunciaHoje)}</dd>
              <dt>Mensagem</dt>
              <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{p.mensagem || "—"}</dd>
              <dt>Recebido em</dt>
              <dd style={{ margin: 0 }}>{quando(p.criadoEm)}</dd>
              <dt>Autorização</dt>
              <dd style={{ margin: 0 }}>
                <AutorizacaoRegistrada registro={p} />
              </dd>
            </dl>
            <form action={marcarRespondidoAcao} className={styles.linha} style={{ alignItems: "flex-end" }} aria-label={`Tratar o pedido de ${p.nome}`}>
              <input type="hidden" name="id" value={p.id} />
              <label className={styles.largo}>
                Nota interna (opcional; só a equipe vê)
                <input name="nota" maxLength={MAX_NOTA} placeholder="ex.: liguei, vai mandar fotos" />
              </label>
              <button type="submit" className={styles.botao}>
                Marcar como respondido
              </button>
              <BotaoConfirmar
                formAction={arquivarPedidoAcao}
                className={styles.pequeno}
                pergunta={`Arquivar o pedido de ${p.nome}? Ele sai dos novos e fica em “Já tratados”.`}
              >
                Arquivar
              </BotaoConfirmar>
            </form>
          </section>
        ))
      )}

      <h2>Já tratados</h2>
      {decididos.length === 0 ? (
        <p>Nenhum pedido tratado ainda.</p>
      ) : (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Contato</th>
                <th>Situação</th>
                <th>Quando</th>
                <th>Por</th>
                <th>Nota</th>
                <th>Autorização</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {decididos.map((p) => (
                <tr key={p.id} className={p.situacao === "arquivado" ? styles.inativo : undefined}>
                  <td>
                    {p.nome} · {p.bairro}, {p.cidade}
                  </td>
                  <td>
                    <Contato p={p} />
                  </td>
                  <td>
                    <span className={styles.etiqueta}>{p.situacao === "respondido" ? "Respondido" : "Arquivado"}</span>
                  </td>
                  <td>{p.decididoEm ? quando(p.decididoEm) : "—"}</td>
                  <td>{p.decididoPorNome ?? "—"}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{p.nota || "—"}</td>
                  <td>
                    <AutorizacaoRegistrada registro={p} />
                  </td>
                  <td>
                    {p.situacao === "respondido" && (
                      <form action={arquivarPedidoAcao} aria-label={`Arquivar o pedido de ${p.nome}`}>
                        <input type="hidden" name="id" value={p.id} />
                        <BotaoConfirmar className={styles.pequeno} pergunta={`Arquivar o pedido de ${p.nome}?`}>
                          Arquivar
                        </BotaoConfirmar>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
