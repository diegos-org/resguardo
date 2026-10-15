"use client";

import { useActionState, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import type { EstadoForm } from "@/configuracoes/acoes";
import { versaoBaseDoFormulario } from "@/configuracoes/documentos-versionados";
import { type FormularioProprietario, LIMITE_TEXTO_AUTORIZACAO, MARCADOR_EMPRESA, montarAutorizacao, validarTextoAutorizacao } from "@/proprietarios/autorizacao";
import styles from "../formularios.module.css";

type Props = {
  formulario: FormularioProprietario;
  /** Nome da caixa no painel (ex.: "Pedido de contato para a gestão completa"). */
  titulo: string;
  /** Versão em vigor; `data` vazia = a versão 1, o texto que veio com o sistema (nada publicado no painel ainda). */
  atual: { numero: number; data: string };
  /** Texto da versão em vigor, com o marcador {empresa}. */
  valor: string;
  /** Nome de Configurações → Empresa de agora, para a prévia. */
  empresa: string;
  salvar: (a: EstadoForm, f: FormData) => Promise<EstadoForm>;
};

const br = (d: string) => d.split("-").reverse().join("/");
const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;

/**
 * Texto da caixa de autorização de um formulário de "Anuncie seu imóvel" (M7.15): o texto, a prévia de como fica ao lado
 * da caixa (com o nome da empresa de agora), o que impede publicar e a publicação, que cria a versão seguinte datada de
 * hoje. As regras do texto são as mesmas que o servidor confere de novo ao publicar (`validarTextoAutorizacao`).
 */
export function FormAutorizacaoProprietario({ formulario, titulo, atual, valor, empresa, salvar }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  const [texto, setTexto] = useState(valor);
  // Versão nova publicada (a página recarrega com outro texto em vigor): o campo passa a mostrá-la.
  const [base, setBase] = useState(valor);
  if (valor !== base) {
    setBase(valor);
    setTexto(valor);
  }
  const v = validarTextoAutorizacao(texto);
  const proxima = atual.numero + 1;
  const caixa = titulo.toLowerCase();
  const pergunta = `Publicar a versão ${proxima} do texto da caixa do ${caixa}? Ela vale a partir de agora: quem abrir a página vê o texto novo, e quem já estava com ela aberta precisa ler e marcar a caixa de novo. Os envios já recebidos continuam com o texto que guardam. Se nada mudou, nenhuma versão nova é criada.`;
  const erro = estado.erros?.texto;
  const id = `autorizacao-${formulario}`;
  return (
    <form action={enviar} className={styles.form} aria-label={`Texto da caixa: ${titulo}`}>
      <input type="hidden" name="formulario" value={formulario} />
      <input type="hidden" name="versaoBase" value={versaoBaseDoFormulario(estado.valores, atual)} />
      <p style={nota}>
        {atual.data ? `Versão ${atual.numero}, publicada em ${br(atual.data)}.` : `Versão ${atual.numero}: o texto que veio com o sistema (os envios já registrados com a versão ${atual.numero} guardam este texto). Nada foi publicado aqui ainda.`}{" "}
        Mudou o texto? Ao publicar nasce a versão {proxima}, datada de hoje.
      </p>
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      <label>
        Texto da caixa
        <textarea
          name="texto"
          rows={3}
          maxLength={LIMITE_TEXTO_AUTORIZACAO}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `erro-${id}` : undefined}
        />
        <span style={{ fontSize: "0.8125rem" }}>
          Escreva {MARCADOR_EMPRESA} onde deve aparecer o nome da empresa (hoje, &ldquo;{empresa.trim() || "empresa"}&rdquo;, de Configurações → Empresa). Texto puro, numa linha
          só, até {LIMITE_TEXTO_AUTORIZACAO} caracteres ({texto.length} usados).
        </span>
        {erro && (
          <span className={styles.erro} id={`erro-${id}`}>
            {erro}
          </span>
        )}
      </label>
      <div aria-label="Prévia da caixa" style={{ fontSize: "0.875rem", padding: "10px 14px", border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", background: "var(--scl-branco)" }}>
        <strong style={{ display: "block", marginBottom: 4 }}>Como aparece no site</strong>
        <span aria-hidden="true">☐ </span>
        {v.ok ? montarAutorizacao(proxima, v.texto, empresa).texto : <em style={{ color: "var(--scl-texto-2)" }}>(texto inválido: veja abaixo)</em>}
      </div>
      {!v.ok && (
        <p role="note" className={styles.alerta} aria-label="O que impede publicar" style={{ margin: 0 }}>
          <strong>Antes de publicar:</strong> {v.erro}
        </p>
      )}
      {estado.ok && (
        <p role="status" className={styles.sucesso}>
          {estado.aviso ?? "Publicado."}
        </p>
      )}
      <div className={styles.acoes}>
        <BotaoConfirmar pergunta={pergunta} disabled={enviando}>
          {enviando ? "Publicando…" : `Publicar a versão ${proxima}`}
        </BotaoConfirmar>
      </div>
    </form>
  );
}
