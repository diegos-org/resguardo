import { getDb } from "@/db/client";
import { seguirConvite } from "@/convites/acoes";
import { lerConvite } from "@/convites/convites";
import { MolduraPortal } from "@/components/portal/MolduraPortal";
import styles from "@/components/portal/portal.module.css";
import { carregarSite } from "@/site/pagina";

const MOTIVOS: Record<string, string> = {
  invalido: "Este link de convite não é válido. Confira se copiou o endereço inteiro.",
  aceito: "Este convite já foi usado. Se foi você, é só entrar normalmente.",
  revogado: "Este convite foi cancelado. Peça um novo à Sua Casa Leblon.",
  vencido: "Este convite venceu (vale 7 dias). Peça um novo à Sua Casa Leblon.",
};

export default async function PaginaConvite({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const [r, { conteudo }] = await Promise.all([lerConvite(getDb(), token), carregarSite()]);
  const empresa = conteudo?.nomeEmpresa.trim() || "Sua Casa Leblon";
  return (
    <MolduraPortal empresa={empresa} estreito>
      <header>
        <p className={styles.olho}>Portal do proprietário</p>
        <h1>Seu convite</h1>
      </header>
      {r.ok ? (
        <>
          <p style={{ marginBottom: 16 }}>
            Olá, {r.nomeProprietario.split(" ")[0]}! Você foi convidado para acompanhar seus imóveis no portal do proprietário.
          </p>
          <p className={styles.rotulo} style={{ marginBottom: 24 }}>
            Para aceitar, entre com o e-mail <strong>{r.convite.email}</strong>. Vamos mandar um código para ele (ou use o Google, se for uma conta
            Google).
          </p>
          <form action={seguirConvite}>
            <input type="hidden" name="token" value={token} />
            <button type="submit" className={`${styles.botao} ${styles.botaoLargo}`}>
              Aceitar e entrar
            </button>
          </form>
        </>
      ) : (
        <p role="alert" className={styles.alerta}>
          {MOTIVOS[r.motivo]}
        </p>
      )}
    </MolduraPortal>
  );
}
