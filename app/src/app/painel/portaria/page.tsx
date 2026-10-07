import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { hojeISO } from "@/lib/datas";
import { lerFiltros, manterFiltros } from "@/lib/filtros";
import { imoveisAcao, registrarAcao } from "@/portaria/acoes";
import { imoveisComPortaria, type LinhaPortaria, listarPortaria, type Passo, somaDias } from "@/portaria/portaria";

const br = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const COR: Record<Passo, string> = {
  aviso_inicial: "var(--scl-erro)",
  segundo_pedido: "var(--scl-erro)",
  pedido_final: "var(--scl-erro)",
  encaminhar: "var(--scl-erro)",
  confirmar_entrega: "var(--scl-aviso)",
  aguardar: "var(--scl-aviso)",
  entrada_passou: "var(--scl-texto-2)",
  concluido: "var(--scl-ok)",
};
const BOTAO: Partial<Record<Passo, [string, string]>> = {
  aviso_inicial: ["aviso_inicial", "Registrar aviso inicial"],
  segundo_pedido: ["segundo_pedido", "Registrar segundo pedido"],
  pedido_final: ["pedido_final", "Registrar pedido final"],
  encaminhar: ["encaminhado", "Registrar encaminhamento"],
  confirmar_entrega: ["entrega_confirmada", "Registrar entrega confirmada"],
};

function Registro({ reservaId, tipo, rotulo, hoje, voltar }: { reservaId: string; tipo: string; rotulo: string; hoje: string; voltar: string }) {
  return (
    <form action={registrarAcao} className={styles.linha} style={{ alignItems: "flex-end" }}>
      <input type="hidden" name="reservaId" value={reservaId} />
      <input type="hidden" name="voltar" value={voltar} />
      <input type="hidden" name="tipo" value={tipo} />
      <label style={{ flex: "0 1 170px" }}>
        Data
        <input type="date" name="data" defaultValue={hoje} max={hoje} required />
      </label>
      <div className={styles.acoes}>
        <button type="submit">{rotulo}</button>
      </div>
    </form>
  );
}

function Cartao({ l, hoje, voltar }: { l: LinhaPortaria; hoje: string; voltar: string }) {
  const botao = BOTAO[l.passo];
  return (
    <section className={styles.form} aria-label={`Portaria ${l.imovelCodigo} ${l.codigo}`} style={{ gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <strong>
          {l.imovelCodigo} · entrada {br(l.checkin)} · <Link href={`/painel/reservas/${l.reservaId}`}>{l.codigo}</Link> · {l.hospede || "hóspede não informado"}
        </strong>
        <span style={{ color: COR[l.passo], fontWeight: 600 }}>
          Documentos: {l.documentosRecebidos} de {l.hospedes ?? "?"}
        </span>
      </div>
      <p role="note" className={l.passo === "concluido" || l.passo === "aguardar" ? undefined : styles.alerta} style={{ margin: 0 }}>
        {l.texto}
      </p>
      <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
        Aviso inicial {br(l.avisoInicialEm)} · segundo pedido {br(l.segundoPedidoEm)} · pedido final {br(l.pedidoFinalEm)} · encaminhado {br(l.encaminhadoEm)} ·
        entrega {br(l.entregaConfirmadaEm)} · destinatário {l.destinatarioConferido ? "conferido" : "não conferido"}
      </p>
      {l.pendencia && (
        <p role="note" className={styles.alerta} style={{ margin: 0 }}>
          Pendência: {l.pendencia}
        </p>
      )}
      {botao && <Registro reservaId={l.reservaId} tipo={botao[0]} rotulo={botao[1]} hoje={hoje} voltar={voltar} />}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <form action={registrarAcao} className={styles.linha} style={{ alignItems: "flex-end", flex: "0 1 280px" }}>
          <input type="hidden" name="reservaId" value={l.reservaId} />
            <input type="hidden" name="voltar" value={voltar} />
          <input type="hidden" name="tipo" value="documentos" />
          <label>
            Hóspedes com documento
            <input type="number" name="recebidos" min={0} max={l.hospedes ?? 50} defaultValue={l.documentosRecebidos} required />
          </label>
          <div className={styles.acoes}>
            <button type="submit">Salvar</button>
          </div>
        </form>
        <form action={registrarAcao} className={styles.acoes}>
          <input type="hidden" name="reservaId" value={l.reservaId} />
            <input type="hidden" name="voltar" value={voltar} />
          <input type="hidden" name="tipo" value="destinatario" />
          <input type="hidden" name="conferido" value={l.destinatarioConferido ? "nao" : "sim"} />
          <button type="submit">{l.destinatarioConferido ? "Desmarcar destinatário" : "Destinatário conferido"}</button>
        </form>
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>Outros registros e pendência</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          {(Object.values(BOTAO) as [string, string][])
            .filter(([t]) => t !== botao?.[0])
            .map(([t, rotulo]) => (
              <Registro key={t} reservaId={l.reservaId} tipo={t} rotulo={rotulo} hoje={hoje} voltar={voltar} />
            ))}
          <form action={registrarAcao} className={styles.linha} style={{ alignItems: "flex-end" }}>
            <input type="hidden" name="reservaId" value={l.reservaId} />
            <input type="hidden" name="voltar" value={voltar} />
            <input type="hidden" name="tipo" value="pendencia" />
            <label>
              Pendência concreta (vazio = nenhuma)
              <input name="texto" maxLength={500} defaultValue={l.pendencia} placeholder="ex.: falha na entrega, dúvida de correspondência" />
            </label>
            <div className={styles.acoes}>
              <button type="submit">Salvar pendência</button>
            </div>
          </form>
        </div>
      </details>
    </section>
  );
}

export default async function Portaria({ searchParams }: PageProps<"/painel/portaria">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "reserva:editar")) redirect("/painel");
  const params = await searchParams;
  const db = getDb();
  const hoje = hojeISO();
  const [marcados, imoveis] = await Promise.all([imoveisComPortaria(db, sessao.organizacaoId), listarImoveis(db, sessao.organizacaoId)]);
  // Seleção global de imóveis (do menu): só as reservas dos imóveis escolhidos.
  const filtros = lerFiltros(params, imoveis.map((i) => ({ codigo: i.codigo, nome: i.nome })));
  const escolhidos = imoveis.filter((i) => filtros.imoveis.includes(i.codigo));
  const imovelIds = filtros.imoveis.length ? escolhidos.map((i) => i.id) : undefined;
  const lista = await listarPortaria(db, sessao.organizacaoId, { hoje, ate: somaDias(hoje, 31), imovelIds });
  const voltar = manterFiltros(params).slice(1);
  const configurar = podeFazer(sessao.papel, "configuracao:editar");
  const salvo = params.salvo === "1";
  const erro = typeof params.erro === "string" ? params.erro : undefined;

  return (
    <>
      <h1>Portaria</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Lista de controle dos documentos pedidos pela portaria: aviso inicial na reserva, segundo pedido entre 5 e 7 dias antes da entrada e pedido
        final na véspera, só se faltar. Aqui fica apenas o registro de datas e quantidades: <strong>nenhum documento, número ou foto é guardado</strong>{" "}
        no sistema. Encaminhe só ao destinatário conferido; entrega não é aprovação da portaria.
      </p>
      {salvo && (
        <p role="status" className={styles.sucesso}>
          Salvo.
        </p>
      )}
      {erro && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      {configurar && (
        <details open={marcados.length === 0}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Imóveis que exigem documentos de portaria</summary>
          <form action={imoveisAcao} className={styles.form} style={{ marginTop: 8 }}>
            <input type="hidden" name="voltar" value={voltar} />
            <div style={{ display: "flex", gap: "4px 16px", flexWrap: "wrap" }}>
              {imoveis.map((i) => (
                <label key={i.id} className={styles.check}>
                  <input type="checkbox" name="imovelId" value={i.id} defaultChecked={marcados.includes(i.id)} /> {i.codigo} · {i.nome}
                </label>
              ))}
            </div>
            <div className={styles.acoes}>
              <button type="submit">Salvar</button>
            </div>
          </form>
        </details>
      )}
      {imovelIds && (
        <p className={styles.etiqueta} style={{ alignSelf: "flex-start" }}>
          Só {escolhidos.map((i) => i.codigo).join(", ")} (seleção de imóveis do menu)
        </p>
      )}
      {marcados.length === 0 ? (
        <p role="note" className={styles.alerta}>
          Nenhum imóvel marcado como exigindo documentos de portaria{configurar ? ": marque acima." : ". Peça a um administrador para marcar."}
        </p>
      ) : lista.length === 0 ? (
        <p>Nenhuma reserva confirmada com entrada nos próximos 30 dias nos imóveis com portaria.</p>
      ) : (
        lista.map((l) => <Cartao key={l.reservaId} l={l} hoje={hoje} voltar={voltar} />)
      )}
    </>
  );
}
