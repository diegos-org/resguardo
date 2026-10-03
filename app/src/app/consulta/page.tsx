import { Disponibilidade } from "@/components/site/Disponibilidade";
import { canalDeContato, FormConsulta } from "@/components/site/FormConsulta";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { hojeISO } from "@/lib/datas";
import { consultarDisponibilidade } from "@/site/disponibilidade";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { imovelDoSite, imoveisDoSite, lerPedidoConsulta, linkWhatsapp, montarConsulta } from "@/site/site";

export const generateMetadata = () => metadadosDoSite("Consulta");

export default async function Consulta({ searchParams }: PageProps<"/consulta">) {
  const sp = await searchParams;
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const pedido = lerPedidoConsulta(sp);
  const enviado = !!(pedido.entrada || pedido.saida);
  const todos = await imoveisDoSite(db, conteudo.organizacaoId);
  // Disponibilidade e valor reais (M7.2): só depois de o pedido passar na conferência básica.
  const imovel = enviado && pedido.imovel ? await imovelDoSite(db, conteudo.organizacaoId, pedido.imovel) : null;
  // "Hoje" no fuso do imóvel escolhido, o mesmo que a disponibilidade usa; sem imóvel, São Paulo.
  const hoje = hojeISO(imovel?.fuso ?? "America/Sao_Paulo");
  // O mínimo do formulário vale para qualquer imóvel da lista: o "hoje" mais cedo entre os fusos deles.
  // A conferência por imóvel (acima) continua sendo a que decide.
  const hojeMinimo = [hoje, ...todos.map((i) => hojeISO(i.fuso))].reduce((a, b) => (a < b ? a : b));
  const previa = enviado ? montarConsulta(pedido, imovel, hoje) : null;
  const disponibilidade = previa?.ok ? await consultarDisponibilidade(db, conteudo.organizacaoId, pedido) : null;
  const r = enviado ? montarConsulta(pedido, imovel, hoje, disponibilidade && { situacao: disponibilidade.situacao, noites: disponibilidade.noites, total: disponibilidade.cotacao?.total ?? null }) : null;
  // Se a disponibilidade recusar o pedido, a mensagem não é oferecida: vale a conferência mais estrita.
  const prontoParaEnviar = r?.ok === true && disponibilidade?.situacao !== "invalida";
  return (
    <Moldura conteudo={conteudo}>
      <h1 style={{ fontSize: "2rem", margin: "8px 0 16px" }}>Consulta</h1>
      <div className={styles.colunas}>
        <div>
          {disponibilidade && <Disponibilidade resultado={disponibilidade} entrada={pedido.entrada} saida={pedido.saida} />}
          {prontoParaEnviar && r?.ok ? (
            <>
              <section className={styles.secao}>
                <h2>Sua mensagem</h2>
                <p className={styles.texto} style={{ background: "#fff", border: "1px solid #e4dccb", borderRadius: 8, padding: 16, whiteSpace: "pre-line" }}>
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
                  A reserva é confirmada na conversa. Nenhuma reserva ou pagamento é feito aqui.
                </p>
              </section>
            </>
          ) : !disponibilidade && (
            <p className={styles.texto}>{conteudo.textos.comoReservar || "Escolha o apartamento, as datas e quantas pessoas."}</p>
          )}
        </div>
        <FormConsulta imoveis={todos} valores={pedido} erros={r && !r.ok ? r.erros : {}} hoje={hojeMinimo} canal={canalDeContato(conteudo)} />
      </div>
    </Moldura>
  );
}
