import { dataHoraNoFuso } from "@/lib/datas";
import { lerRegistroAutorizacao, type RegistroAutorizacao, SEM_REGISTRO_AUTORIZACAO } from "@/proprietarios/autorizacao";

/**
 * O registro da autorização de um envio de "Anuncie seu imóvel" (M7.14), nos pedidos de contato e nos cadastros pelo
 * site: quando o envio com a caixa marcada chegou ao servidor (horário de Brasília), a versão e o texto exato da caixa.
 * Envio de antes do registro: o aviso, sem preencher nada.
 */
export function AutorizacaoRegistrada({ registro }: { registro: RegistroAutorizacao }) {
  const r = lerRegistroAutorizacao(registro);
  if (!r) return <span style={{ color: "var(--scl-texto-2)" }}>{SEM_REGISTRO_AUTORIZACAO}</span>;
  return (
    <span>
      Autorizado em {dataHoraNoFuso(r.em)} (texto da versão {r.versao}): &ldquo;{r.texto}&rdquo;
    </span>
  );
}
