import { lerComoFunciona, secoesParaMostrar, versaoAtual } from "@/configuracoes/como-funciona";
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

const dataBr = (d: string) => d.split("-").reverse().join("/");

export default async function PaginaConvite({ params, searchParams }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const { erro } = await searchParams;
  const db = getDb();
  const [r, { conteudo }] = await Promise.all([lerConvite(db, token), carregarSite()]);
  const empresa = conteudo?.nomeEmpresa.trim() || "Sua Casa Leblon";
  // M5.6: com o "Como funciona" publicado, o convite só segue com o aceite marcado (gravado no login, com o convite).
  const documento = r.ok ? versaoAtual(await lerComoFunciona(db, r.convite.organizacaoId)) : null;
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
          {erro === "aceite" && (
            <p role="alert" className={styles.alerta} style={{ marginBottom: 16 }}>
              Para aceitar o convite, leia o &ldquo;Como funciona&rdquo; abaixo e marque que aceita.
            </p>
          )}
          <form action={seguirConvite} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <input type="hidden" name="token" value={token} />
            {documento && (
              <>
                <details className={styles.caixa}>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                    Como funciona — versão {documento.numero}, de {dataBr(documento.data)}
                  </summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
                    {secoesParaMostrar(documento, empresa).map((s) => (
                      <section key={s.chave} aria-label={s.titulo}>
                        <h2 style={{ fontSize: "1.0625rem", margin: "0 0 6px" }}>{s.titulo}</h2>
                        {s.paragrafos.map((p, i) => (
                          <p key={i} style={{ margin: "0 0 6px" }}>
                            {p}
                          </p>
                        ))}
                      </section>
                    ))}
                    <p className={styles.miudo}>Os dados do seu contrato (tipo, comissão e periodicidade dos repasses) aparecem no portal, junto deste texto.</p>
                  </div>
                </details>
                <input type="hidden" name="versao" value={documento.numero} />
                <label className={styles.opcao}>
                  <input type="checkbox" name="aceite" required /> Li o documento &ldquo;Como funciona&rdquo; (versão {documento.numero}) e aceito as condições descritas.
                </label>
              </>
            )}
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
