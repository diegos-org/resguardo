import { redirect } from "next/navigation";
import styles from "@/components/site/site.module.css";
import { Moldura } from "@/components/site/Moldura";
import { sairHospede } from "@/hospede/acoes";
import { INSTRUCOES_HORA, type ReservaDoHospede, reservasDoHospede } from "@/hospede/portal";
import { emailDoHospede } from "@/hospede/sessao-atual";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { linkWhatsapp } from "@/site/site";

export const generateMetadata = () => metadadosDoSite("Minha reserva");

const data = (d: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${d}T00:00:00Z`));
const hora = (h: string) => h.replace(/^0?(\d+):00$/, "$1h");

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

function Reserva({ r }: { r: ReservaDoHospede }) {
  return (
    <article className={styles.cartao}>
      <div className={styles.cartaoCorpo}>
        <h2 style={{ margin: 0 }}>{r.imovel}</h2>
        <span className={styles.miudo}>
          Reserva {r.codigo}
          {r.bairro ? ` · ${r.bairro}, ${r.cidade}` : ""}
          {r.encerrada ? " · estadia encerrada" : ""}
        </span>
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", margin: "12px 0" }}>
          <dt>Entrada</dt>
          <dd style={{ margin: 0 }}>
            {data(r.checkin)}, a partir das {hora(r.entradaAPartirDe)}
          </dd>
          <dt>Saída</dt>
          <dd style={{ margin: 0 }}>
            {data(r.checkout)}, até {hora(r.saidaAte)}
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
            O endereço completo e as instruções de chegada aparecem aqui em {data(r.instrucoes.dia)}, às {hora(INSTRUCOES_HORA)}.
          </p>
        )}
        <Contato r={r} />
      </div>
    </article>
  );
}

/** Portal do hóspede (M9.1): só as reservas com o e-mail verificado, conferidas a cada acesso. */
export default async function PortalHospede() {
  const email = await emailDoHospede();
  if (!email) redirect("/hospede/entrar");
  const { db, conteudo } = await carregarSite();
  // Só reservas da empresa deste site; sem empresa definida, nenhuma.
  const lista = conteudo ? await reservasDoHospede(db, conteudo.organizacaoId, email, new Date()) : [];

  return (
    <Moldura conteudo={conteudo}>
      <section className={styles.secao}>
        <h1>Minha reserva</h1>
        <p className={styles.miudo}>Entrou como {email}.</p>
        {lista.length ? (
          <div className={styles.grade}>
            {lista.map((r) => (
              <Reserva key={r.codigo} r={r} />
            ))}
          </div>
        ) : (
          <p className={styles.aviso} role="note">
            Não encontramos uma reserva ativa com este e-mail. Se você acabou de reservar ou mudou de e-mail, fale com a gente.
          </p>
        )}
        <form action={sairHospede}>
          <button type="submit" className={styles.botao}>
            Sair
          </button>
        </form>
      </section>
    </Moldura>
  );
}
