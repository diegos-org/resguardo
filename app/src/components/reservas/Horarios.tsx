import { dataBr, dataHoraNoFuso } from "@/lib/datas";
import { CANAIS_HORARIO, type HorariosReserva } from "@/reservas/horarios";
import { alterarHorarioAcao } from "@/reservas/horarios-acoes";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { CampoHora } from "@/components/CampoHora";
import styles from "@/components/formularios.module.css";

/** O carimbo guardado (ISO, em UTC) no horário de Brasília: "16/10/2026 às 22:30". O que não for data sai como está. */
const registradoEm = (iso: string | undefined) => {
  const d = new Date(iso ?? "");
  return Number.isNaN(d.getTime()) ? (iso ?? "") : dataHoraNoFuso(d);
};

export function Horarios({ id, horarios, editar, vigentes }: { id: string; horarios?: HorariosReserva; editar: boolean; vigentes: { entrada: boolean; saida: boolean } }) {
  return <section aria-label="Horários combinados" className={styles.form}>
    <h2>Horários combinados com o hóspede</h2>
    <p>Confira a conversa no Airbnb, WhatsApp, Booking.com ou inbox e registre o pedido. Depois do aceite explícito, confirme aqui com a referência da mensagem. Previsão de chegada e pedido de antecipação não são autorização.</p>
    <p>Este registro não envia mensagens nem conecta canais. Mudança nas datas ou no imóvel exige novo acordo. A agenda usa o padrão enquanto não houver acordo válido.</p>
    {(["entrada", "saida"] as const).map((tipo) => {
      const atual = horarios?.[tipo];
      const campos = <><input type="hidden" name="id" value={id} /><input type="hidden" name="tipo" value={tipo} /><input type="hidden" name="versao" value={horarios?.versao ?? 0} /></>;
      return <div key={tipo}>
        <h3>{tipo === "entrada" ? "Entrada" : "Saída"}</h3>
        {atual?.acordo ? <>
          {!vigentes[tipo] && <p role="alert">Este acordo precisa de reconfirmação: datas, imóvel ou confirmação da reserva mudaram. A agenda usa o padrão.</p>}
          <p>Acordo registrado: {atual.acordo.hora} · {atual.acordo.canal} · estadia {dataBr(atual.acordo.checkin)} a {dataBr(atual.acordo.checkout)}. Confirmação registrada em {registradoEm(atual.acordo.confirmadoEm)}.</p>
          <p>Referência do aceite: {atual.acordo.referencia}</p>
          {editar && <form action={alterarHorarioAcao}>{campos}<input type="hidden" name="acao" value="revogar" /><BotaoConfirmar pergunta="Revogar este acordo e voltar ao horário padrão na agenda?">Revogar acordo</BotaoConfirmar></form>}
        </> : <p>Sem acordo confirmado.</p>}
        {atual?.pedido && <>
          <p>Pedido pendente: {atual.pedido.hora} · {atual.pedido.canal} · {atual.pedido.referencia}. Ainda não altera o horário da agenda.</p>
          {editar && <>
            <form action={alterarHorarioAcao} className={styles.form}>{campos}<input type="hidden" name="acao" value="confirmar" />
              <label>Canal do aceite<select name="canal" defaultValue={atual.pedido.canal}>{CANAIS_HORARIO.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Referência do aceite (data/hora e identificador ou trecho mínimo da mensagem; sem telefone ou documentos)<textarea name="referencia" required maxLength={500} /></label>
              <label><input type="checkbox" name="aceite" value="sim" required /> Conferi que este horário foi explicitamente acordado com o hóspede.</label>
              <button type="submit">Registrar acordo confirmado</button>
            </form>
            <form action={alterarHorarioAcao}>{campos}<input type="hidden" name="acao" value="descartar" /><BotaoConfirmar pergunta="Descartar este pedido? O acordo já confirmado, se houver, permanece.">Descartar pedido</BotaoConfirmar></form>
          </>}
        </>}
        {editar && <form action={alterarHorarioAcao} className={styles.form}>{campos}<input type="hidden" name="acao" value="pedir" />
          <label>Horário solicitado<CampoHora name="hora" required /></label>
          <label>Canal da conversa<select name="canal">{CANAIS_HORARIO.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Referência do pedido (sem telefone ou documentos)<textarea name="referencia" required maxLength={500} /></label>
          <button type="submit">Registrar pedido pendente</button>
        </form>}
      </div>;
    })}
  </section>;
}
