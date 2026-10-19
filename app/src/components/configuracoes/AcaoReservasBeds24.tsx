"use client";

/**
 * Os botões da seção "Reservas do site no Beds24" em Integrações (M8.3a): pausar e retomar, ligar e desligar um imóvel
 * (D6) e conferir os escopos da credencial (só leitura no Beds24). M8.3c (desenho 8 e D7): o ensaio — "Criar o ensaio" (o
 * imóvel e as datas), "Cancelar o ensaio" e "Conferir o ensaio". Todos com `BotaoConfirmar`; quem decide é o servidor
 * (`configuracao:editar`; ligar exige um ensaio conferido com a credencial atual; o ensaio só roda no deploy de produção).
 */
import { useActionState, useRef } from "react";
import {
  cancelarEnsaioReservasBeds24Acao,
  conferirEnsaioReservasBeds24Acao,
  conferirEscoposReservasBeds24Acao,
  criarEnsaioReservasBeds24Acao,
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
import { dataBr } from "@/lib/datas";

const ACOES = {
  pausar: pausarReservasBeds24Acao,
  retomar: retomarReservasBeds24Acao,
  ligar: ligarImovelReservasBeds24Acao,
  desligar: desligarImovelReservasBeds24Acao,
  cancelar_ensaio: cancelarEnsaioReservasBeds24Acao,
  conferir_ensaio: conferirEnsaioReservasBeds24Acao,
} as const;
const inicial: EstadoReservasBeds24 = {};

/** Um botão de configuração (pausa, imóvel ou o ensaio em curso), com a pergunta de confirmação e a resposta do servidor. */
export function AcaoReservasBeds24({ acao, rotulo, pergunta, imovelId, operacaoId, desabilitado }: { acao: keyof typeof ACOES; rotulo: string; pergunta: string; imovelId?: string; operacaoId?: string; desabilitado?: boolean }) {
  const [estado, enviar, pendente] = useActionState(ACOES[acao], inicial);
  return (
    <form action={enviar} style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      {imovelId && <input type="hidden" name="imovelId" value={imovelId} />}
      {operacaoId && <input type="hidden" name="operacaoId" value={operacaoId} />}
      <BotaoConfirmar className={styles.botao} pergunta={pergunta} disabled={pendente || desabilitado}>
        {pendente ? (acao.endsWith("_ensaio") ? "Aguarde… (fala com o Beds24)" : "Salvando…") : rotulo}
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
  em_ordem: "Em ordem: tem exatamente os escopos do convite, nada a mais e nada a menos (sem apagar, sem \"all\" e sem escrever dados pessoais).",
  escopo_excessivo: "Permissões demais: nada será escrito com esta credencial. Gere um convite novo só com os escopos acima.",
  ilegivel: "Não deu para ler os escopos na resposta do Beds24: conta como fora de ordem.",
  incompleto: "Faltam escopos do convite: conta como fora de ordem. Gere um convite novo com todos os escopos acima.",
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
  const faltam = r.avaliacao.faltando.length ? ` · faltando: ${r.avaliacao.faltando.join(", ")}` : "";
  return `${SITUACAO_ESCOPOS[r.avaliacao.situacao]} Lidos: ${lista}${tortos}${demais}${faltam}.`;
}

/** Prontidão: conferir os escopos da credencial (só leitura no Beds24; a leitura fica guardada no SCL, M8.3c). */
export function ConferirEscoposBeds24() {
  const [estado, enviar, pendente] = useActionState(conferirEscoposReservasBeds24Acao, {} as EstadoEscoposReservasBeds24);
  return (
    <form action={enviar} style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <BotaoConfirmar
        className={styles.botao}
        pergunta="Conferir os escopos da credencial no Beds24? É só leitura: nada muda lá; aqui, o sistema guarda o que leu. Fora do deploy de produção, nada é lido."
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

/**
 * "Criar o ensaio" (M8.3c, D7): o imóvel (só os ativos com o vínculo único com um quarto do Beds24) e as datas, sem procura,
 * que Diego escolhe. A pergunta de confirmação é montada na hora do clique, com o imóvel e as datas do formulário.
 */
export function CriarEnsaioBeds24({ imoveis, hoje, desabilitado }: { imoveis: { id: string; codigo: string }[]; hoje: string; desabilitado?: boolean }) {
  const [estado, enviar, pendente] = useActionState(criarEnsaioReservasBeds24Acao, inicial);
  const formulario = useRef<HTMLFormElement>(null);
  const pergunta = () => {
    const f = formulario.current ? new FormData(formulario.current) : null;
    const codigo = imoveis.find((i) => i.id === f?.get("imovelId"))?.codigo ?? "escolhido";
    const chegada = String(f?.get("chegada") ?? "");
    const saida = String(f?.get("saida") ?? "");
    const datas = chegada && saida ? `, de ${dataBr(chegada)} a ${dataBr(saida)}` : "";
    return `Criar o ensaio no imóvel ${codigo}${datas}? O sistema cria no Beds24 uma reserva de teste (1 pessoa, sem hóspede nem valor), e essas datas ficam fechadas nas OTAs até você cancelar o ensaio.`;
  };
  return (
    <form ref={formulario} action={enviar} className={styles.form}>
      <label>
        Imóvel
        <select name="imovelId" required defaultValue="" disabled={desabilitado}>
          <option value="" disabled>
            Escolha o imóvel
          </option>
          {imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {i.codigo}
            </option>
          ))}
        </select>
      </label>
      <label>
        Entrada
        <input type="date" name="chegada" required min={hoje} disabled={desabilitado} />
      </label>
      <label>
        Saída
        <input type="date" name="saida" required min={hoje} disabled={desabilitado} />
      </label>
      <div className={styles.acoes}>
        <BotaoConfirmar className={styles.botao} pergunta={pergunta} disabled={pendente || desabilitado}>
          {pendente ? "Criando… aguarde" : "Criar o ensaio"}
        </BotaoConfirmar>
      </div>
      {estado.mensagem && (
        <span role="status" aria-live="polite" className={estado.ok === false ? styles.erro : undefined} style={{ fontSize: "0.875rem" }}>
          {estado.mensagem}
        </span>
      )}
    </form>
  );
}
