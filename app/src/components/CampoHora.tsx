import { type ChangeEventHandler, type InputHTMLAttributes, useId } from "react";
import { escreverHora, MENSAGEM_HORA, PADRAO_DO_CAMPO_HORA } from "@/lib/datas";

/** O exemplo visível ao lado do campo: o placeholder some quando há hora no campo, e o `title` não aparece no toque. */
export const DICA_DO_CAMPO_HORA = "Ex.: 15:00";

type Props = {
  name: string;
  id?: string;
  /** A hora guardada: sai como "HH:MM" (um "15h" antigo aparece "15:00"). */
  defaultValue?: string;
  /** Controlado: o valor fica como a pessoa digita (escrever "15:00" no meio de "15h30" travaria o campo). */
  value?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  required?: boolean;
  "aria-invalid"?: InputHTMLAttributes<HTMLInputElement>["aria-invalid"];
  "aria-describedby"?: string;
};

/**
 * O campo de hora do sistema (M7.22): texto no formato "15:00", em 24 horas, igual em qualquer aparelho. O campo nativo de
 * hora (`type="time"`) mostra "03:00 PM" quando o navegador ou o celular está em inglês ou no modo de 12 horas. Sem
 * `inputMode="numeric"`: o teclado numérico do celular não tem os dois-pontos. O único hook é `useId`, que também roda em
 * tela de servidor: o campo serve nas duas; o servidor lê com `lerHora` e grava "HH:MM". Fora do formato, o navegador não deixa enviar e
 * mostra o `title`, o mesmo aviso do servidor (`MENSAGEM_HORA`); embaixo do campo fica o exemplo, ligado por
 * `aria-describedby` (depois do aviso de erro de quem chama, quando há).
 */
export function CampoHora({ defaultValue, value, "aria-describedby": descrito, ...resto }: Props) {
  const dica = `${useId()}-dica`;
  const valor = value !== undefined ? { value } : defaultValue !== undefined ? { defaultValue: escreverHora(defaultValue) } : {};
  return (
    <>
      <input
        type="text"
        pattern={PADRAO_DO_CAMPO_HORA}
        maxLength={5}
        placeholder="15:00"
        autoComplete="off"
        title={MENSAGEM_HORA}
        aria-describedby={descrito ? `${descrito} ${dica}` : dica}
        {...resto}
        {...valor}
      />
      {/* Fora do nome do campo (o rótulo continua só "Hora"), lida como descrição pelo aria-describedby. */}
      <span id={dica} aria-hidden="true" style={{ fontSize: "0.75rem", color: "var(--scl-texto-2)" }}>
        {DICA_DO_CAMPO_HORA}
      </span>
    </>
  );
}
