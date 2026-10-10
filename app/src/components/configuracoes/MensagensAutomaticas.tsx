"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import type { EstadoForm } from "@/configuracoes/acoes";
import styles from "../formularios.module.css";

/** `textoBase`: as mensagens do cancelamento (M8.2c) têm um texto-base, usado nos botões de copiar da ficha sem modelo escolhido. */
type Tipo = { id: string; nome: string; selecionado: string; textoBase?: string };
type Envio = { id: string; codigo: string; reservaId: string; tipo: string; estado: string; tentativas: number; modeloNome: string; erro: string; quando: string };

const ESTADOS: Record<string, string> = { enviado: "Enviada", falhou: "Recusada pelo provedor", incerto: "Sem confirmação — confira", enviando: "Enviando" };

/** Mensagens automáticas ao hóspede (M9.2): ligar, escolher origens e o modelo de cada mensagem. */
export function MensagensAutomaticas({
  ativo,
  ativoDesde,
  origens,
  tipos,
  modelos,
  envios,
  ultimaExecucao,
  salvar,
}: {
  ativo: boolean;
  ativoDesde: string | null;
  origens: { id: string; nome: string; marcada: boolean }[];
  tipos: Tipo[];
  modelos: { id: string; nome: string }[];
  envios: Envio[];
  ultimaExecucao: string | null;
  salvar: (a: EstadoForm, f: FormData) => Promise<EstadoForm>;
}) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  return (
    <section aria-label="Mensagens automáticas ao hóspede" style={{ display: "grid", gap: 12, maxWidth: 820 }}>
      <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Mensagens automáticas ao hóspede (e-mail)</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>
        O sistema manda, pelo e-mail do hóspede cadastrado na reserva, a mensagem de cada momento usando o modelo escolhido: confirmação (logo depois de
        confirmada), check-in (2 dias antes da entrada, 10h), check-out (1 dia antes da saída, 14h) e agradecimento (3 dias depois da saída, 10h). O sistema confere
        de hora em hora, então cada mensagem sai até cerca de 1 hora depois do momento previsto. Vale do momento em que for ligado em diante: nada previsto para antes é mandado atrasado. Se faltar um dado do modelo (nome, e-mail,
        endereço…), a mensagem não sai e o aviso aparece na página Sistema.
      </p>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>
        Cancelamento de reserva paga pelo site: pedido recebido (até 2 dias depois do pedido), decisão (até 7 dias depois do cancelamento) e devolução feita
        (até 7 dias depois dela). Enquanto o envio estiver desligado, ou sem modelo escolhido, a ficha da reserva mostra a mensagem pronta para copiar (com o
        texto-base abaixo, se não houver modelo) e o botão &ldquo;Mensagem enviada ao hóspede&rdquo;. Para mudar o texto, crie um modelo (pode começar pelo
        texto-base) e escolha-o aqui.
      </p>
      <form action={enviar} className={styles.form} aria-label="Configurar mensagens automáticas">
        <label className={styles.check}>
          <input type="checkbox" name="ativo" defaultChecked={ativo} /> Envio automático ligado
          {ativo && ativoDesde && <span style={{ color: "var(--scl-texto-2)" }}> (desde {ativoDesde})</span>}
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: "0.875rem" }}>Para reservas de (Airbnb e Booking já têm as mensagens deles):</legend>
          <div className={styles.linha}>
            {origens.map((o) => (
              <label key={o.id} className={styles.check}>
                <input type="checkbox" name="origens" value={o.id} defaultChecked={o.marcada} /> {o.nome}
              </label>
            ))}
          </div>
        </fieldset>
        {tipos.map((t) => (
          <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label>
              {t.nome}
              <select name={`modelo_${t.id}`} defaultValue={t.selecionado}>
                <option value="">— não enviar —</option>
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </label>
            {t.textoBase && (
              <span style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                Texto-base (sem modelo): &ldquo;{t.textoBase}&rdquo;
                <BotaoCopiar texto={t.textoBase} rotulo="Copiar o texto-base" className={styles.pequeno} />
              </span>
            )}
          </div>
        ))}
        {estado.mensagem && <p className={styles.alerta}>{estado.mensagem}</p>}
        {estado.ok && estado.aviso && (
          <p role="status" className={styles.sucesso}>
            {estado.aviso}
          </p>
        )}
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            Salvar
          </button>
        </div>
      </form>
      {ultimaExecucao && <p style={{ fontSize: "0.875rem", margin: 0 }}>Última execução: {ultimaExecucao}</p>}
      {envios.length > 0 && (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <caption style={{ textAlign: "left", fontWeight: 600 }}>Últimas mensagens</caption>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Reserva</th>
                <th>Mensagem</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {envios.map((e) => (
                <tr key={e.id}>
                  <td>{e.quando}</td>
                  <td>
                    <Link href={`/painel/reservas/${e.reservaId}`}>{e.codigo}</Link>
                  </td>
                  <td>{e.modeloNome}</td>
                  <td>
                    {ESTADOS[e.estado] ?? e.estado}
                    {e.estado === "falhou" && ` (${e.tentativas} de 3 tentativas)`}
                    {e.erro && <span style={{ display: "block", fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>{e.erro}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
