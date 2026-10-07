"use client";

import { useActionState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import type { EstadoBloqueioPortal } from "@/portal/acoes";
import type { BloqueioDoProprietario } from "@/portal/bloqueios";
import styles from "../formularios.module.css";

type Acao = (a: EstadoBloqueioPortal, f: FormData) => Promise<EstadoBloqueioPortal>;
export type ImovelDoPortal = { id: string; codigo: string; nome: string; permissao: boolean | null };
type Props = { imoveis: ImovelDoPortal[]; bloqueios: BloqueioDoProprietario[]; empresa: string; hoje: string; bloquear: Acao; liberar: Acao };

const dataBr = (d: string) => d.split("-").reverse().join("/");

/** Bloqueio de uso próprio pelo proprietário (M5.5): lista os bloqueios dos imóveis dele e permite bloquear/liberar conforme o contrato. */
export function BloqueiosProprietario({ imoveis, bloqueios, empresa, hoje, bloquear, liberar }: Props) {
  const [estado, enviar, enviando] = useActionState(bloquear, {} as EstadoBloqueioPortal);
  const [remocao, remover] = useActionState(liberar, {} as EstadoBloqueioPortal);
  const permitidos = imoveis.filter((i) => i.permissao === true);
  const v = estado.valores ?? {};
  return (
    <section aria-label="Uso próprio" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Bloquear datas para uso próprio</h2>
      <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--scl-texto-2)" }}>
        Vai usar o apartamento? Bloqueie as datas aqui: elas saem de venda no sistema na hora e fecham nos canais (Airbnb, Booking) no próximo
        envio de calendário da {empresa}. Liberar devolve as datas à venda do mesmo jeito. Datas com reserva não podem ser bloqueadas.
      </p>
      {remocao.erro && <p role="alert" className={styles.alerta}>{remocao.erro}</p>}
      {remocao.ok && <p role="status" className={styles.sucesso}>Datas liberadas: voltam à venda no próximo envio de calendário.</p>}
      {bloqueios.length > 0 && (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <caption>Bloqueios atuais e futuros</caption>
            <thead>
              <tr>
                <th>Imóvel</th>
                <th>Primeira noite</th>
                <th>Liberado em</th>
                <th>Motivo</th>
                <th>Quem bloqueou</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bloqueios.map((b) => (
                <tr key={b.id}>
                  <td>{b.codigo}</td>
                  <td>{dataBr(b.inicio)}</td>
                  <td>{dataBr(b.fim)}</td>
                  <td>{b.motivo || "—"}</td>
                  <td>{b.quem === "proprietario" ? (b.proprio ? "Você" : "Proprietário anterior") : b.quem === "canais" ? "Canal" : empresa}</td>
                  <td>
                    {b.liberavel && (
                      <form action={remover}>
                        <input type="hidden" name="id" value={b.id} />
                        <BotaoConfirmar className={styles.pequeno} pergunta={`Liberar as datas de ${dataBr(b.inicio)} a ${dataBr(b.fim)}? Elas voltam a ficar à venda no próximo envio de calendário.`}>
                          Liberar
                        </BotaoConfirmar>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {permitidos.length === 0 ? (
        <p role="note" style={{ margin: 0, padding: "8px 12px", borderRadius: 6, background: "var(--scl-areia)", fontSize: "0.9375rem" }}>
          {imoveis.some((i) => i.permissao === false)
            ? `Seu contrato não prevê bloqueio de datas pelo portal. Para usar o apartamento, fale com a ${empresa}.`
            : `Não há contrato em vigor (nem futuro) cadastrado para os seus imóveis: fale com a ${empresa} para bloquear datas.`}
        </p>
      ) : (
        <form key={bloqueios.length} action={enviar} className={styles.form} aria-label="Bloquear datas">
          <div className={styles.linha}>
            <label>
              Imóvel
              <select name="imovelId" required defaultValue={v.imovelId ?? (permitidos.length === 1 ? permitidos[0].id : "")}>
                {permitidos.length > 1 && <option value="" disabled>Escolha</option>}
                {permitidos.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.codigo} · {i.nome}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Primeira noite
              <input type="date" name="inicio" required min={hoje} defaultValue={v.inicio} />
            </label>
            <label>
              Liberado a partir de
              <input type="date" name="fim" required min={hoje} defaultValue={v.fim} />
            </label>
            <label className={styles.largo}>
              Motivo (opcional)
              <input name="motivo" maxLength={120} placeholder="ex.: férias em família" defaultValue={v.motivo} />
            </label>
          </div>
          {estado.erro && <p role="alert" className={styles.alerta}>{estado.erro}</p>}
          {estado.ok && <p role="status" className={styles.sucesso}>Datas bloqueadas. Elas fecham nos canais no próximo envio de calendário.</p>}
          <div className={styles.acoes}>
            <button type="submit" disabled={enviando}>{enviando ? "Bloqueando…" : "Bloquear"}</button>
          </div>
        </form>
      )}
      {imoveis.some((i) => i.permissao !== true) && permitidos.length > 0 && (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
          Imóveis que não aparecem acima não têm contrato, de hoje em diante, com bloqueio pelo portal: fale com a {empresa}.
        </p>
      )}
    </section>
  );
}
