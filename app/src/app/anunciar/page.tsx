import Link from "next/link";
import styles from "@/components/site/site.module.css";
import { Moldura } from "@/components/site/Moldura";
import { correioDoAmbiente } from "@/email/correio";
import { entrarCadastroAcao, pedirCodigoCadastroAcao } from "@/marketplace/acoes";
import { carregarSite, metadadosDoSite } from "@/site/pagina";

export const generateMetadata = () => metadadosDoSite("Anuncie seu imóvel");

const MENSAGENS: Record<string, string> = {
  "email-vazio": "Informe seu e-mail.",
  codigo: "Código incorreto ou vencido. Confira o e-mail mais recente ou peça um novo código.",
};

/** Cadastro do proprietário marketplace (M12.3), passo 1: confirmar o e-mail com um código. */
export default async function Anunciar({ searchParams }: PageProps<"/anunciar">) {
  const { conteudo } = await carregarSite();
  const { erro, etapa, email } = await searchParams;
  const configurado = Boolean(process.env.AUTH_SECRET && correioDoAmbiente() && conteudo);
  const mensagem = typeof erro === "string" ? (MENSAGENS[erro] ?? "Não foi possível continuar. Tente novamente.") : null;
  const emailInformado = typeof email === "string" ? email.slice(0, 200) : "";
  const digitarCodigo = configurado && etapa === "codigo" && emailInformado;

  return (
    <Moldura conteudo={conteudo}>
      <section className={styles.secao} style={{ maxWidth: 560 }}>
        <h1>Anuncie seu imóvel</h1>
        <p>
          Você cuida do imóvel (limpeza, chaves, reposição) e nós cuidamos da parte online: anúncio, reservas e atendimento. Mande os dados do seu imóvel; a
          nossa equipe analisa e responde por e-mail. Nada é publicado antes dessa análise.
        </p>
        {mensagem && (
          <p role="alert" className={styles.erro}>
            {mensagem}
          </p>
        )}
        {!configurado ? (
          <p className={styles.aviso} role="note">
            O cadastro pelo site ainda não está disponível. Fale com a gente pelo contato do site.
          </p>
        ) : digitarCodigo ? (
          <form action={entrarCadastroAcao} className={styles.formulario} aria-label="Digitar código">
            <p style={{ margin: 0 }}>
              Enviamos um código de 6 dígitos para <strong>{emailInformado}</strong>. Ele vale por 10 minutos. Não chegou? Confira o spam e peça outro.
            </p>
            <input type="hidden" name="email" value={emailInformado} />
            <label>
              Código
              <input name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
            </label>
            <button type="submit" className={styles.botao}>
              Continuar
            </button>
            <Link href="/anunciar" className={styles.miudo}>
              Usar outro e-mail ou pedir novo código
            </Link>
          </form>
        ) : (
          <form action={pedirCodigoCadastroAcao} className={styles.formulario} aria-label="Confirmar e-mail">
            <p style={{ margin: 0 }}>Primeiro, confirme seu e-mail: enviamos um código para ele. É por esse e-mail que vamos responder.</p>
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
