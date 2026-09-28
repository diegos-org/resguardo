import { ErroBeds24 } from "./tipos";

// Lista fechada: nunca devolver mensagens, URLs, cabeçalhos ou códigos arbitrários
// do fetch. Até error.cause pode conter a credencial rejeitada pelo runtime.
const causas: Record<string, { texto: string; tipo: "rede" | "tempo" }> = {
  ENOTFOUND: { texto: "O servidor não conseguiu localizar o endereço do Beds24 (DNS).", tipo: "rede" },
  EAI_AGAIN: { texto: "Falha temporária ao localizar o endereço do Beds24 (DNS).", tipo: "rede" },
  ECONNREFUSED: { texto: "A conexão com o Beds24 foi recusada.", tipo: "rede" },
  ECONNRESET: { texto: "A conexão com o Beds24 foi interrompida.", tipo: "rede" },
  ENETUNREACH: { texto: "O servidor não encontrou uma rota de rede até o Beds24.", tipo: "rede" },
  EHOSTUNREACH: { texto: "O servidor não conseguiu alcançar o Beds24.", tipo: "rede" },
  ETIMEDOUT: { texto: "A conexão com o Beds24 excedeu o tempo-limite.", tipo: "tempo" },
  UND_ERR_CONNECT_TIMEOUT: { texto: "A conexão com o Beds24 excedeu o tempo-limite.", tipo: "tempo" },
  UND_ERR_HEADERS_TIMEOUT: { texto: "O Beds24 demorou demais para começar a responder.", tipo: "tempo" },
  UND_ERR_SOCKET: { texto: "A conexão com o Beds24 foi encerrada antes da resposta.", tipo: "rede" },
  CERT_HAS_EXPIRED: { texto: "O certificado HTTPS apresentado pelo Beds24 está vencido.", tipo: "rede" },
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: { texto: "O servidor não conseguiu validar o certificado HTTPS do Beds24.", tipo: "rede" },
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: { texto: "O servidor não conseguiu validar a cadeia do certificado HTTPS do Beds24.", tipo: "rede" },
  DEPTH_ZERO_SELF_SIGNED_CERT: { texto: "O certificado HTTPS apresentado pelo Beds24 não é confiável.", tipo: "rede" },
  SELF_SIGNED_CERT_IN_CHAIN: { texto: "A cadeia do certificado HTTPS do Beds24 não é confiável.", tipo: "rede" },
  ERR_TLS_CERT_ALTNAME_INVALID: { texto: "O certificado HTTPS não corresponde ao endereço do Beds24.", tipo: "rede" },
};

export function diagnosticarFalhaBeds24(erro: unknown, renovacao: boolean): ErroBeds24 {
  const etapa = renovacao ? "Etapa: renovação do token." : "Etapa: consulta de dados.";
  const fila: unknown[] = [erro];
  const vistos = new Set<unknown>();
  // Limite também protege contra ciclos em causas de erro e AggregateError.
  for (let i = 0; i < fila.length && i < 12; i++) {
    const e = fila[i];
    if (!e || typeof e !== "object" || vistos.has(e)) continue;
    vistos.add(e);
    const c = e as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
    if (c.name === "TimeoutError" || c.name === "AbortError") {
      return new ErroBeds24(`Beds24 não respondeu a tempo. ${etapa}`, "tempo");
    }
    if (typeof c.code === "string" && Object.hasOwn(causas, c.code)) {
      const causa = causas[c.code];
      return new ErroBeds24(`${causa.texto} Código: ${c.code}. ${etapa}`, causa.tipo);
    }
    if (c.message === "unexpected redirect") {
      return new ErroBeds24(`O Beds24 tentou redirecionar a chamada; o envio da credencial foi bloqueado. ${etapa}`, "rede");
    }
    if (c.cause) fila.push(c.cause);
    if (Array.isArray(c.errors)) fila.push(...c.errors.slice(0, 8));
  }
  return new ErroBeds24(`Falha de rede ao falar com o Beds24, sem causa técnica reconhecida. ${etapa}`, "rede");
}
