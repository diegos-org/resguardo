import Link from "next/link";
import styles from "@/components/site/site.module.css";
import { Moldura } from "@/components/site/Moldura";
import { correioDoAmbiente } from "@/email/correio";
import { entrarHospede, pedirCodigoHospedeAcao } from "@/hospede/acoes";
import { carregarSite, metadadosDeMinhaReserva } from "@/site/pagina";

// M7.18: o ícone da aba fica com a marca do estudo, como nos outros portais.
export const generateMetadata = () => metadadosDeMinhaReserva();

const MENSAGENS: Record<string, string> = {
  "email-vazio": "Informe seu e-mail.",
  codigo: "Código incorreto ou vencido. Confira o e-mail mais recente ou peça um novo código.",
};

/** Entrada do portal do hóspede (M9.1): código de 6 dígitos no e-mail que está na reserva. */
export default async function EntrarHospede({ searchParams }: PageProps<"/hospede/entrar">) {
  const { conteudo } = await carregarSite();
  const { erro, etapa, email } = await searchParams;
  const configurado = Boolean(process.env.AUTH_SECRET && correioDoAmbiente());
  const mensagem = typeof erro === "string" ? (MENSAGENS[erro] ?? "Não foi possível entrar. Tente novamente.") : null;
  const emailInformado = typeof email === "string" ? email.slice(0, 200) : "";
  const digitarCodigo = configurado && etapa === "codigo" && emailInformado;

  return (
    <Moldura conteudo={conteudo}>
      <section className={styles.estreito}>
        <header className={styles.cabecalhoPagina}>
          <p className={styles.olho}>Portal do hóspede</p>
          <h1>Minha reserva</h1>
        </header>
        {mensagem && (
          <p role="alert" className={styles.erro}>
            {mensagem}
          </p>
        )}
        {!configurado ? (
          <p className={styles.aviso} role="note">
            O acesso à reserva ainda não está disponível. Fale com a gente pelo contato do site.
          </p>
        ) : digitarCodigo ? (
          <form action={entrarHospede} className={styles.formulario} aria-label="Digitar código">
            <p style={{ margin: 0 }}>
              Se houver uma reserva com <strong>{emailInformado}</strong>, enviamos um código de 6 dígitos para esse e-mail. Ele vale por 10
              minutos. Não chegou? Confira o spam e peça outro.
            </p>
            <input type="hidden" name="email" value={emailInformado} />
            <label>
              Código
              <input name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
            </label>
            <button type="submit" className={styles.botao}>
              Ver minha reserva
            </button>
            <Link href="/hospede/entrar" className={styles.miudo}>
              Usar outro e-mail ou pedir novo código
            </Link>
          </form>
        ) : (
          <form action={pedirCodigoHospedeAcao} className={styles.formulario} aria-label="Receber código por e-mail">
            <p style={{ margin: 0 }}>Use o e-mail que está na sua reserva. Enviamos um código para você entrar — sem senha.</p>
            <label>
              Seu e-mail
              <input type="email" name="email" autoComplete="email" required defaultValue={emailInformado} />
            </label>
            <button type="submit" className={styles.botao}>
              Receber código por e-mail
            </button>
          </form>
        )}
      </section>
    </Moldura>
  );
}
