"use client";

import { useActionState, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import type { EstadoForm } from "@/configuracoes/acoes";
import { EXEMPLO, type ErrosModelo, NOMES_TIPO, ONDE_VALE, preencherModelo, type Variavel, VARIAVEIS } from "@/configuracoes/modelos-texto";
import styles from "../formularios.module.css";

type Acao = (a: EstadoForm<ErrosModelo>, f: FormData) => Promise<EstadoForm<ErrosModelo>>;
type Modelo = { id: string; nome: string; quando: string; texto: string; ativo: boolean };

function Campos({ m, estado }: { m?: Modelo; estado: EstadoForm<ErrosModelo> }) {
  const [texto, setTexto] = useState(m?.texto ?? "");
  // Depois de um erro, o React limpa o formulário: volta com o que foi digitado.
  const v = (k: "nome" | "quando") => estado.valores?.[k] ?? m?.[k];
  const erro = (k: keyof ErrosModelo) => estado.erros?.[k] && <span className={styles.erro}>{estado.erros[k]}</span>;
  return (
    <>
      <div className={styles.linha}>
        <label>
          Nome
          <input name="nome" defaultValue={v("nome")} required maxLength={80} aria-invalid={estado.erros?.nome ? true : undefined} />
          {erro("nome")}
        </label>
        <label className={styles.largo}>
          Quando é usado
          <input name="quando" defaultValue={v("quando")} maxLength={120} placeholder="ex.: 2 dias antes da entrada, 10:00" />
          {erro("quando")}
        </label>
      </div>
      <label>
        Texto
        <textarea name="texto" rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} required aria-invalid={estado.erros?.texto ? true : undefined} />
        {erro("texto")}
      </label>
      {texto && (
        <p style={{ fontSize: "0.875rem", background: "var(--scl-creme)", padding: "8px 12px", borderRadius: 6, margin: 0, whiteSpace: "pre-wrap" }}>
          <strong>Prévia com dados de exemplo:</strong> {preencherModelo(texto, EXEMPLO)}
        </p>
      )}
    </>
  );
}

function Editar({ m, editar }: { m: Modelo; editar: Acao }) {
  const [estado, enviar, enviando] = useActionState(editar, {});
  return (
    <details style={{ background: "var(--scl-papel)", border: "1px solid var(--scl-areia)", borderRadius: 8, padding: "10px 14px", maxWidth: 820 }}>
      <summary style={{ cursor: "pointer" }}>
        <strong>{m.nome}</strong> {m.quando && <span style={{ color: "var(--scl-texto-2)" }}>· {m.quando}</span>}{" "}
        {!m.ativo && <span className={styles.etiqueta}>arquivado</span>}
      </summary>
      <form action={enviar} className={styles.form} style={{ border: 0, padding: "12px 0 0" }} aria-label={`Modelo ${m.nome}`}>
        <input type="hidden" name="id" value={m.id} />
        <Campos m={m} estado={estado} />
        {estado.mensagem && <p className={styles.alerta}>{estado.mensagem}</p>}
        {estado.ok && estado.aviso && (
          <p role="status" className={styles.sucesso}>
            {estado.aviso}
          </p>
        )}
        <div className={styles.acoes}>
          <button type="submit" name="op" value="salvar" disabled={enviando}>
            Salvar
          </button>
          <button type="submit" className={styles.pequeno} style={{ background: "var(--scl-papel)", color: "var(--scl-texto)" }} name="op" value={m.ativo ? "arquivar" : "reativar"} formNoValidate disabled={enviando}>
            {m.ativo ? "Arquivar" : "Reativar"}
          </button>
          <BotaoConfirmar
            className={styles.pequeno}
            style={{ background: "var(--scl-papel)", color: "var(--scl-erro-texto)" }}
            name="op"
            value="excluir"
            formNoValidate
            disabled={enviando}
            pergunta={`Excluir o modelo "${m.nome}"? Não dá para desfazer. Se quiser só tirar de uso, arquive.`}
          >
            Excluir
          </BotaoConfirmar>
        </div>
      </form>
    </details>
  );
}

export function Modelos({ lista, criar, editar }: { lista: Modelo[]; criar: Acao; editar: Acao }) {
  const [estado, enviar, enviando] = useActionState(criar, {});
  return (
    <>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", maxWidth: 820, margin: 0 }}>
        Variáveis disponíveis (escreva entre chaves):{" "}
        {Object.entries(VARIAVEIS).map(([v, d], i) => {
          // M8.2c: as variáveis do cancelamento só valem nas mensagens dele (ao escolher o modelo, o sistema confere).
          const onde = ONDE_VALE[v as Variavel];
          return (
            <span key={v}>
              {i > 0 && ", "}
              <code>{`{${v}}`}</code> {d.toLowerCase()}
              {onde ? ` (só em ${onde.map((t) => `“${NOMES_TIPO[t]}”`).join(", ")})` : ""}
            </span>
          );
        })}
        . As mensagens automáticas por e-mail usam estes modelos (acima); o WhatsApp chega no M10.
      </p>
      {lista.map((m) => (
        <Editar key={`${m.id}:${m.ativo}:${m.nome}:${m.texto}:${m.quando}`} m={m} editar={editar} />
      ))}
      <form key={lista.length} action={enviar} className={styles.form} aria-label="Novo modelo">
        <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Novo modelo</h2>
        <Campos estado={estado} />
        {estado.mensagem && <p className={styles.alerta}>{estado.mensagem}</p>}
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            Adicionar
          </button>
        </div>
      </form>
    </>
  );
}
