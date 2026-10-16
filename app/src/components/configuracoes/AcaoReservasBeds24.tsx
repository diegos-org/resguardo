"use client";

/**
 * Os botões da seção "Reservas do site no Beds24" em Integrações (M8.3a): pausar e retomar, ligar e desligar um imóvel
 * (D6) e conferir os escopos da credencial (só leitura). Todos com `BotaoConfirmar`; quem decide é o servidor
 * (`configuracao:editar`; ligar exige um ensaio conferido com a credencial atual).
 */
import { useActionState } from "react";
import {
  conferirEscoposReservasBeds24Acao,
  desligarImovelReservasBeds24Acao,
  type EstadoEscoposReservasBeds24,
  type EstadoReservasBeds24,
  ligarImovelReservasBeds24Acao,
  pausarReservasBeds24Acao,
  retomarReservasBeds24Acao,
} from "@/beds24/acoes-reservas";
import type { EscoposDaCredencial } from "@/beds24/reservas-site-painel";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";

const ACOES = { pausar: pausarReservasBeds24Acao, retomar: retomarReservasBeds24Acao, ligar: ligarImovelReservasBeds24Acao, desligar: desligarImovelReservasBeds24Acao } as const;
const inicial: EstadoReservasBeds24 = {};

/** Um botão de configuração (pausa ou imóvel), com a pergunta de confirmação e a resposta do servidor. */
export function AcaoReservasBeds24({ acao, rotulo, pergunta, imovelId, desabilitado }: { acao: keyof typeof ACOES; rotulo: string; pergunta: string; imovelId?: string; desabilitado?: boolean }) {
  const [estado, enviar, pendente] = useActionState(ACOES[acao], inicial);
  return (
    <form action={enviar} style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      {imovelId && <input type="hidden" name="imovelId" value={imovelId} />}
      <BotaoConfirmar className={styles.botao} pergunta={pergunta} disabled={pendente || desabilitado}>
        {pendente ? "Salvando…" : rotulo}
      </BotaoConfirmar>
      {estado.mensagem && (
        <span role="status" aria-live="polite" className={estado.ok === false ? styles.erro : undefined} style={{ fontSize: "0.875rem" }}>
          {estado.mensagem}
        </span>
      )}
    </form>
  );
}

const SITUACAO_ESCOPOS: Record<Extract<EscoposDaCredencial, { lidos: true }>["avaliacao"]["situacao"], string> = {
  em_ordem: "Em ordem: escreve reservas, sem apagar, sem \"all\" e sem escrever dados pessoais.",
  escopo_excessivo: "Permissões demais: nada será escrito com esta credencial. Gere um convite novo só com os escopos acima.",
  ilegivel: "Não deu para ler os escopos na resposta do Beds24: conta como fora de ordem.",
  sem_escrita: "Falta a escrita de reservas (write:bookings).",
};
const NAO_LIDOS: Record<Exclude<EscoposDaCredencial, { lidos: true }>["motivo"], string> = {
  fora_da_producao: "Não lido: os escopos só são lidos no deploy de produção (aqui é prévia, computador ou teste).",
  chave_desligada: "Não lido: a chave BEDS24_ESCRITA_RESERVAS não está ligada.",
  sem_refresh_token: "Não lido: falta o refresh token (BEDS24_REFRESH_TOKEN).",
  falhou: "Não deu para ler no Beds24",
};

function textoDosEscopos(r: EscoposDaCredencial): string {
  if (!r.lidos) return r.motivo === "falhou" ? `${NAO_LIDOS.falhou}: ${r.erro}` : NAO_LIDOS[r.motivo];
  const lista = r.escopos.length ? r.escopos.join(", ") : "nenhum";
  const tortos = r.ilegiveis.length ? ` · fora do formato: ${r.ilegiveis.join(", ")}` : "";
  const demais = r.avaliacao.excessivos.length ? ` · a mais: ${r.avaliacao.excessivos.join(", ")}` : "";
  return `${SITUACAO_ESCOPOS[r.avaliacao.situacao]} Lidos: ${lista}${tortos}${demais}.`;
}

/** Prontidão: conferir os escopos da credencial (só leitura; nada é gravado). */
export function ConferirEscoposBeds24() {
  const [estado, enviar, pendente] = useActionState(conferirEscoposReservasBeds24Acao, {} as EstadoEscoposReservasBeds24);
  return (
    <form action={enviar} style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <BotaoConfirmar
        className={styles.botao}
        pergunta="Conferir os escopos da credencial no Beds24? É só leitura: nada é gravado lá nem aqui. Fora do deploy de produção, nada é lido."
        disabled={pendente}
      >
        {pendente ? "Conferindo…" : "Conferir os escopos"}
      </BotaoConfirmar>
      {(estado.mensagem || estado.resultado) && (
        <span role="status" aria-live="polite" style={{ fontSize: "0.875rem" }}>
          {estado.mensagem ?? textoDosEscopos(estado.resultado!)}
        </span>
      )}
    </form>
  );
}
