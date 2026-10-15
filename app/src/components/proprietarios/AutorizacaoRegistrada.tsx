import { lerRegistroAutorizacao, type RegistroAutorizacao, SEM_REGISTRO_AUTORIZACAO } from "@/proprietarios/autorizacao";

const quando = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

/**
 * O registro da autorização de um envio de "Anuncie seu imóvel" (M7.14), nos pedidos de contato e nos cadastros pelo
 * site: quando (horário de Brasília), a versão e o texto exato que a pessoa marcou. Envio de antes do registro: o aviso,
 * sem preencher nada.
 */
export function AutorizacaoRegistrada({ registro }: { registro: RegistroAutorizacao }) {
  const r = lerRegistroAutorizacao(registro);
  if (!r) return <span style={{ color: "var(--scl-texto-2)" }}>{SEM_REGISTRO_AUTORIZACAO}</span>;
  return (
    <span>
      Autorizado em {quando(r.em)} (texto da versão {r.versao}): &ldquo;{r.texto}&rdquo;
    </span>
  );
}
