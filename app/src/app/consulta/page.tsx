import type { Metadata } from "next";
import { FormConsulta } from "@/components/site/FormConsulta";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { hojeISO } from "@/lib/datas";
import { carregarSite } from "@/site/pagina";
import { imovelDoSite, imoveisDoSite, linkWhatsapp, montarConsulta, type PedidoConsulta } from "@/site/site";

export const metadata: Metadata = { title: "Consulta — Sua Casa Leblon" };

const CAMPOS = ["imovel", "entrada", "saida", "hospedes", "nome", "mensagem"] as const;

export default async function Consulta({ searchParams }: PageProps<"/consulta">) {
  const sp = await searchParams;
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const hoje = hojeISO("America/Sao_Paulo");
  const pedido = Object.fromEntries(CAMPOS.map((k) => [k, typeof sp[k] === "string" ? (sp[k] as string) : ""])) as PedidoConsulta;
  const enviado = !!(pedido.entrada || pedido.saida);
  const todos = await imoveisDoSite(db, conteudo.organizacaoId);
  const r = enviado ? montarConsulta(pedido, pedido.imovel ? await imovelDoSite(db, conteudo.organizacaoId, pedido.imovel) : null, hoje) : null;
  return (
    <Moldura conteudo={conteudo}>
      <h1 style={{ fontSize: "2rem", margin: "8px 0 16px" }}>Consulta</h1>
      <div className={styles.colunas}>
        <div>
          {r?.ok ? (
            <section className={styles.secao} style={{ marginTop: 0 }}>
              <h2>Sua mensagem</h2>
              <p className={styles.texto} style={{ background: "#fff", border: "1px solid #e4dccb", borderRadius: 8, padding: 16 }}>
                {r.texto}
              </p>
              {conteudo.whatsapp ? (
                <p style={{ marginTop: 16 }}>
                  <a href={linkWhatsapp(conteudo.whatsapp, r.texto)} className={styles.botao} target="_blank" rel="noopener noreferrer">
                    Enviar pelo WhatsApp
                  </a>
                </p>
              ) : conteudo.email ? (
                <p style={{ marginTop: 16 }}>
                  <a href={`mailto:${conteudo.email}?subject=${encodeURIComponent("Consulta de disponibilidade")}&body=${encodeURIComponent(r.texto)}`} className={styles.botao}>
                    Enviar por e-mail
                  </a>
                </p>
              ) : (
                <p className={styles.aviso} role="note" style={{ marginTop: 16 }}>
                  O contato ainda não foi configurado. Volte em breve.
                </p>
              )}
              <p className={styles.miudo} style={{ marginTop: 12 }}>
                A disponibilidade e o valor são confirmados na conversa. Nenhuma reserva ou pagamento é feito aqui.
              </p>
            </section>
          ) : (
            <p className={styles.texto}>{conteudo.textos.comoReservar || "Escolha o apartamento, as datas e quantas pessoas. A conversa continua pelo WhatsApp."}</p>
          )}
        </div>
        <FormConsulta imoveis={todos} valores={pedido} erros={r && !r.ok ? r.erros : {}} hoje={hoje} />
      </div>
    </Moldura>
  );
}
