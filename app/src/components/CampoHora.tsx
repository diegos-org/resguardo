import type { ChangeEventHandler, InputHTMLAttributes } from "react";
import { escreverHora, PADRAO_DO_CAMPO_HORA } from "@/lib/datas";

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
 * `inputMode="numeric"`: o teclado numérico do celular não tem os dois-pontos. Sem hooks, serve em tela de servidor e de
 * cliente; o servidor lê com `lerHora` e grava "HH:MM".
 */
export function CampoHora({ defaultValue, value, ...resto }: Props) {
  const valor = value !== undefined ? { value } : defaultValue !== undefined ? { defaultValue: escreverHora(defaultValue) } : {};
  return (
    <input
      type="text"
      pattern={PADRAO_DO_CAMPO_HORA}
      maxLength={5}
      placeholder="15:00"
      autoComplete="off"
      title="Hora no formato 15:00 (24 horas)"
      {...resto}
      {...valor}
    />
  );
}
