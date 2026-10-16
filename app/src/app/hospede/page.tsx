import { redirect } from "next/navigation";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/site/site.module.css";
import { Moldura } from "@/components/site/Moldura";
import { TEXTO_VALOR_PELA_EQUIPE } from "@/configuracoes/politica-cancelamento";
import { TEXTOS_SITE_INICIAIS, type TextosSite } from "@/configuracoes/textos-site";
import { pedirCancelamentoAcao, sairHospede } from "@/hospede/acoes";
import { type CancelamentoNoPortal, cancelamentoNoPortal, ESTADIA_COMECOU, JA_CANCELADA, NAO_DA, PEDIDO_DESLIGADO, PEDIDO_OCUPADO, perguntaDoPedidoDeCancelamento, textoDaPoliticaNoPortal } from "@/hospede/cancelamento";
import { INSTRUCOES_HORA, type ReservaDoHospede, reservasDoHospede } from "@/hospede/portal";
import { emailDoHospede } from "@/hospede/sessao-atual";
import { escreverHora } from "@/lib/datas";
import { carregarSite, metadadosDeMinhaReserva } from "@/site/pagina";
import { TEXTO_PARA_CANCELAR_FALE_COM_A_EQUIPE } from "@/pagamentos/contestacao-regras";
import { linkWhatsapp } from "@/site/site";

// M7.18: o ícone da aba fica com a marca do estudo, como nos outros portais.
export const generateMetadata = () => metadadosDeMinhaReserva();

const data = (d: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${d}T00:00:00Z`));

function Contato({ r }: { r: ReservaDoHospede }) {
  const { whatsapp, email, empresa } = r.contato;
  if (!whatsapp && !email) return null;
  return (
    <p className={styles.miudo}>
      Dúvidas? Fale com {empresa || "a gente"}
      {whatsapp && (
        <>
          {" "}
          pelo <a href={linkWhatsapp(whatsapp, `Olá! Tenho uma dúvida sobre a reserva ${r.codigo}.`)}>WhatsApp</a>
        </>
      )}
      {whatsapp && email ? " ou" : ""}
      {email && (
        <>
          {" "}
          por e-mail: <a href={`mailto:${email}`}>{email}</a>
        </>
      )}
      .
    </p>
  );
}

/** O que o endereço traz depois de "Pedir o cancelamento" (M8.2c): só códigos conhecidos, cada um com o seu texto fixo. */
const ERROS_DO_PEDIDO: Record<string, string> = {
  cancelamento: NAO_DA,
  "cancelamento-desligado": PEDIDO_DESLIGADO,
  "cancelamento-estadia": ESTADIA_COMECOU,
  "cancelamento-cancelada": JA_CANCELADA,
  "cancelamento-ocupado": PEDIDO_OCUPADO,
};

const BRASILIA = "America/Sao_Paulo";
const diaHoraBrasilia = (d: Date) => {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: BRASILIA, ...o }).format(d);
  return `${f({ day: "2-digit", month: "2-digit" })} às ${f({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
};
/**
 * "Cancelar a reserva" em Minha reserva (M8.2c): só para reservas pagas pelo site deste e-mail. O hóspede só PEDE (a data
 * e a hora ficam registradas na hora); a equipe confirma por escrito e cancela no painel. Nunca valores.
 */
function CancelarReserva({
  codigo,
  c,
  textos,
  agora,
}: {
  codigo: string;
  c: CancelamentoNoPortal | null;
  textos: Pick<TextosSite, "cancelamentoMinhaReservaIntro" | "cancelamentoPedidoRecebido" | "pagamentoEmConferencia">;
  agora: Date;
}) {
  if (!c) return null;
  if (c.pedidoEm)
    return (
      <div className={styles.aviso} role="note">
        <p style={{ margin: 0 }}>
          Pedido de cancelamento recebido em {diaHoraBrasilia(c.pedidoEm)} (horário de Brasília). {c.semPolitica ? TEXTO_VALOR_PELA_EQUIPE : textos.cancelamentoPedidoRecebido}
        </p>
        <p style={{ margin: 0 }}>
          Acompanhe na página da sua reserva: <a href={c.linkCotacao}>ver a reserva no site</a>.
        </p>
      </div>
    );
  if (agora.getTime() >= c.entradaEm.getTime()) return <p className={styles.miudo}>A estadia já começou: para cancelar, fale com a equipe.</p>;
  // M8.2e: disputa do pagamento em curso ou perdida (a regra única que recusa o cancelamento pela política): o contato no
  // lugar do botão, nunca o sumiço sem explicação; a frase editável "pagamento em conferência" (pode ficar vazia) só enquanto
  // a disputa ainda não tem resultado.
  if (c.emConferencia || c.faleComAEquipe)
    return (
      <div className={styles.aviso} role="note">
        {c.emConferencia && textos.pagamentoEmConferencia && <p style={{ margin: 0 }}>{textos.pagamentoEmConferencia}</p>}
        <p style={{ margin: 0 }}>{TEXTO_PARA_CANCELAR_FALE_COM_A_EQUIPE}</p>
      </div>
    );
  if (!c.podePedir) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>Cancelar a reserva</strong>
      {textos.cancelamentoMinhaReservaIntro && <p className={styles.miudo} style={{ margin: 0 }}>{textos.cancelamentoMinhaReservaIntro}</p>}
      <p className={styles.miudo} style={{ margin: 0 }}>
        {textoDaPoliticaNoPortal(c)}
      </p>
      <form action={pedirCancelamentoAcao}>
        <input type="hidden" name="reserva" value={codigo} />
        <BotaoConfirmar
          pergunta={perguntaDoPedidoDeCancelamento(codigo, c.semPolitica)}
          className={`${styles.botao} ${styles.botaoContorno}`}
        >
          Pedir o cancelamento
        </BotaoConfirmar>
      </form>
    </div>
  );
}

/**
 * M8.2d: a linha da alteração com as novas datas seguradas — o que ela espera (o pagamento da diferença ou a confirmação),
 * até quando (horário de Brasília) e o link da página da reserva no site; passado o prazo com o pagamento da diferença
 * ainda em andamento (a carência), que ele está em andamento. Nunca valores.
 */
function LinhaDaAlteracao({ a }: { a: NonNullable<ReservaDoHospede["alteracao"]> }) {
  return (
    <p className={styles.aviso} role="note">
      {a.pagamentoEmAndamento
        ? "Há uma alteração da sua reserva com o pagamento da diferença em andamento: "
        : `Há uma alteração da sua reserva esperando ${a.espera === "pagamento" ? "o pagamento da diferença" : "a sua confirmação"} até ${diaHoraBrasilia(a.ate)} (horário de Brasília): `}
      <a href={a.link}>ver a alteração no site</a>.
    </p>
  );
}

function Reserva({
  r,
  cancelamento,
  textos,
  agora,
}: {
  r: ReservaDoHospede;
  cancelamento: CancelamentoNoPortal | null;
  textos: Pick<TextosSite, "cancelamentoMinhaReservaIntro" | "cancelamentoPedidoRecebido" | "pagamentoEmConferencia">;
  agora: Date;
}) {
  return (
    <article className={styles.cartao}>
      <div className={styles.cartaoCorpo}>
        <h2 style={{ margin: 0 }}>{r.imovel}</h2>
        <span className={styles.miudo}>
          Reserva {r.codigo}
          {r.bairro ? ` · ${r.bairro}, ${r.cidade}` : ""}
          {r.encerrada ? " · estadia encerrada" : ""}
        </span>
        <dl className={styles.detalhes}>
          <dt>Entrada</dt>
          <dd style={{ margin: 0 }}>
            {data(r.checkin)}, a partir das {escreverHora(r.entradaAPartirDe)}
          </dd>
          <dt>Saída</dt>
          <dd style={{ margin: 0 }}>
            {data(r.checkout)}, até {escreverHora(r.saidaAte)}
          </dd>
          <dt>Noites</dt>
          <dd style={{ margin: 0 }}>{r.noites}</dd>
          {r.hospedes !== null && (
            <>
              <dt>Pessoas</dt>
              <dd style={{ margin: 0 }}>{r.hospedes}</dd>
            </>
          )}
        </dl>
        {r.alteracao && !r.encerrada && <LinhaDaAlteracao a={r.alteracao} />}
        {r.encerrada ? (
          <p className={styles.miudo}>Obrigado pela estadia!</p>
        ) : r.instrucoes.liberadas ? (
          <div>
            <strong>Como chegar</strong>
            {r.instrucoes.endereco ? (
              <p style={{ margin: "4px 0" }}>
                {r.instrucoes.endereco}
                {r.instrucoes.complemento ? ` — ${r.instrucoes.complemento}` : ""}
              </p>
            ) : (
              <p className={styles.aviso} role="note">
                O endereço ainda não está no nosso cadastro. Fale com a gente pelo contato abaixo.
              </p>
            )}
          </div>
        ) : (
          <p className={styles.aviso} role="note">
            O endereço completo e as instruções de chegada aparecem aqui em {data(r.instrucoes.dia)}, às {escreverHora(INSTRUCOES_HORA)}.
          </p>
        )}
        {!r.encerrada && <CancelarReserva codigo={r.codigo} c={cancelamento} textos={textos} agora={agora} />}
        <Contato r={r} />
      </div>
    </article>
  );
}

/** Portal do hóspede (M9.1): só as reservas com o e-mail verificado, conferidas a cada acesso. */
export default async function PortalHospede({ searchParams }: PageProps<"/hospede">) {
  const email = await emailDoHospede();
  if (!email) redirect("/hospede/entrar");
  const { pedido, erro } = await searchParams;
  const { db, conteudo } = await carregarSite();
  const agora = new Date();
  // Só reservas da empresa deste site; sem empresa definida, nenhuma.
  const lista = conteudo ? await reservasDoHospede(db, conteudo.organizacaoId, email, agora) : [];
  // M8.2c: o pedido de cancelamento de cada reserva paga pelo site (o mesmo e-mail; null nas outras).
  const cancelamentos = conteudo ? await Promise.all(lista.map((r) => cancelamentoNoPortal(db, conteudo.organizacaoId, email, r.codigo, agora))) : [];
  const textos = {
    cancelamentoMinhaReservaIntro: conteudo?.textos.cancelamentoMinhaReservaIntro ?? TEXTOS_SITE_INICIAIS.cancelamentoMinhaReservaIntro,
    cancelamentoPedidoRecebido: conteudo?.textos.cancelamentoPedidoRecebido || TEXTOS_SITE_INICIAIS.cancelamentoPedidoRecebido,
    // M8.2e: "pagamento em conferência" (vazia = a frase não aparece; o "fale com a equipe" sempre aparece).
    pagamentoEmConferencia: conteudo?.textos.pagamentoEmConferencia ?? TEXTOS_SITE_INICIAIS.pagamentoEmConferencia,
  };
  const erroDoPedido = typeof erro === "string" && Object.hasOwn(ERROS_DO_PEDIDO, erro) ? ERROS_DO_PEDIDO[erro] : null;

  return (
    <Moldura conteudo={conteudo}>
      <section aria-labelledby="titulo-reserva">
        <header className={styles.cabecalhoPagina}>
          <p className={styles.olho}>Portal do hóspede</p>
          <h1 id="titulo-reserva">Minha reserva</h1>
          <p>Entrou como {email}.</p>
        </header>
        {pedido === "ok" && (
          <p className={styles.aviso} role="status">
            Pedido de cancelamento registrado. A data e a hora em que ele chegou aparecem na reserva abaixo.
          </p>
        )}
        {erroDoPedido && (
          <p className={styles.aviso} role="alert">
            {erroDoPedido}
          </p>
        )}
        {lista.length ? (
          <div className={styles.grade}>
            {lista.map((r, i) => (
              <Reserva key={r.codigo} r={r} cancelamento={cancelamentos[i] ?? null} textos={textos} agora={agora} />
            ))}
          </div>
        ) : (
          <p className={styles.aviso} role="note">
            Não encontramos uma reserva ativa com este e-mail. Se você acabou de reservar ou mudou de e-mail, fale com a gente.
          </p>
        )}
        <form action={sairHospede} style={{ marginTop: 24 }}>
          <button type="submit" className={`${styles.botao} ${styles.botaoContorno}`}>
            Sair
          </button>
        </form>
      </section>
    </Moldura>
  );
}
