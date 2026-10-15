"use client";

import { useActionState, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import type { EstadoForm } from "@/configuracoes/acoes";
import { type FormularioProprietario, LIMITE_TEXTO_AUTORIZACAO, limparTextoAutorizacao, MARCADOR_EMPRESA, montarAutorizacao, validarTextoAutorizacao } from "@/proprietarios/autorizacao";
import styles from "../formularios.module.css";
import { useSairSemPublicar } from "./useSairSemPublicar";

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
 * hoje. As regras do texto são as mesmas que o servidor confere de novo ao publicar (`validarTextoAutorizacao`); o campo
 * não corta o que passa do limite (o aviso diz quanto passou). Nada é guardado antes de publicar: sair da tela com o
 * texto mudado pede confirmação, como nas páginas legais.
 *
 * A base que a publicação declara é a versão de que o texto do campo partiu, e as duas só mudam juntas. Se a página
 * volta do servidor com outra versão em vigor (publicada em outra tela): sem texto mudado aqui, o campo passa a mostrar
 * a versão nova; com texto mudado, o texto fica, com um aviso, e Diego escolhe entre usar o texto da versão nova
 * (descarta o dele) ou continuar com o dele (publicar cria a versão seguinte, no lugar da nova) — até escolher, não
 * publica. Nunca há texto de uma versão com a base de outra, nem texto trocado sem aviso.
 */
export function FormAutorizacaoProprietario({ formulario, titulo, atual, valor, empresa, salvar }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  const [texto, setTexto] = useState(valor);
  // A versão em vigor que a tela recebeu por último, para notar a troca.
  const [vista, setVista] = useState({ numero: atual.numero, valor });
  // A versão de que o texto do campo partiu: a base que a publicação declara (o servidor recusa se outra estiver em vigor).
  const [base, setBase] = useState(atual.numero);
  // Resposta do servidor de antes da troca de versão: não vale mais para o que a tela mostra.
  const [estadoVencido, setEstadoVencido] = useState<EstadoForm | null>(null);
  if (atual.numero !== vista.numero || valor !== vista.valor) {
    const limpo = limparTextoAutorizacao(texto);
    // O texto do campo é o da versão nova (o que acabou de ser publicado daqui): nada se perde.
    const publicadoDaqui = limpo === valor;
    setVista({ numero: atual.numero, valor });
    if (publicadoDaqui || limpo === limparTextoAutorizacao(vista.valor)) {
      setTexto(valor);
      setBase(atual.numero);
    }
    if (!publicadoDaqui) setEstadoVencido(estado);
  }
  const alterado = limparTextoAutorizacao(texto) !== limparTextoAutorizacao(valor);
  const rearmar = useSairSemPublicar(alterado);
  // Texto igual ao da versão em vigor parte dela, qualquer que fosse a base antes.
  const baseDoTexto = alterado ? base : atual.numero;
  // Versão publicada em outra tela depois que o texto do campo começou a ser escrito.
  const publicadaNoMeio = baseDoTexto !== atual.numero ? atual.numero : null;
  const usarVersaoEmVigor = () => {
    setTexto(valor);
    setBase(atual.numero);
  };
  const v = validarTextoAutorizacao(texto);
  const tamanho = limparTextoAutorizacao(texto).length;
  const proxima = atual.numero + 1;
  const caixa = titulo.toLowerCase();
  const pergunta = `Publicar a versão ${proxima} do texto da caixa do ${caixa}? Ela vale a partir de agora: quem abrir a página vê o texto novo, e quem já estava com ela aberta precisa ler e marcar a caixa de novo. Os envios já recebidos continuam com o texto que guardam. Se nada mudou, nenhuma versão nova é criada.`;
  const resposta = estado === estadoVencido ? {} : estado;
  const erro = resposta.erros?.texto;
  const id = `autorizacao-${formulario}`;
  return (
    <form action={enviar} className={styles.form} aria-label={`Texto da caixa: ${titulo}`}>
      <input type="hidden" name="formulario" value={formulario} />
      <input type="hidden" name="versaoBase" value={baseDoTexto} />
      <p style={nota}>
        {atual.data ? `Versão ${atual.numero}, publicada em ${br(atual.data)}.` : `Versão ${atual.numero}: o texto que veio com o sistema (os envios já registrados com a versão ${atual.numero} guardam este texto). Nada foi publicado aqui ainda.`}{" "}
        Mudou o texto? Ao publicar nasce a versão {proxima}, datada de hoje.
      </p>
      {resposta.mensagem && (
        <p role="alert" className={styles.alerta}>
          {resposta.mensagem}
        </p>
      )}
      {publicadaNoMeio !== null && (
        <div role="alert" aria-label="Versão publicada enquanto você editava" className={styles.alerta}>
          <p style={{ margin: 0 }}>
            Enquanto você editava, a versão {publicadaNoMeio} foi publicada (o texto dela está acima, em &ldquo;No site agora&rdquo;). O seu texto não foi publicado e continua no
            campo. Escolha antes de publicar:
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            <BotaoConfirmar type="button" className={styles.pequeno} pergunta={`Descartar o seu texto e usar o da versão ${publicadaNoMeio}? O seu texto não foi publicado e se perde.`} onClick={usarVersaoEmVigor}>
              Usar o texto da versão {publicadaNoMeio}
            </BotaoConfirmar>
            <button type="button" className={styles.pequeno} onClick={() => setBase(atual.numero)}>
              Continuar com o meu texto (publicar cria a versão {proxima}, no lugar da {publicadaNoMeio})
            </button>
          </div>
        </div>
      )}
      <label>
        Texto da caixa
        <textarea
          name="texto"
          rows={3}
          value={texto}
          onChange={(e) => {
            rearmar();
            setTexto(e.target.value);
            // Voltou ao texto da versão em vigor: é dela que o texto parte daqui em diante.
            if (limparTextoAutorizacao(e.target.value) === limparTextoAutorizacao(valor)) setBase(atual.numero);
          }}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `erro-${id}` : undefined}
        />
        <span style={{ fontSize: "0.8125rem" }}>
          Escreva {MARCADOR_EMPRESA} onde deve aparecer o nome da empresa (hoje, &ldquo;{empresa.trim() || "empresa"}&rdquo;, de Configurações → Empresa). Texto puro, numa linha
          só, até {LIMITE_TEXTO_AUTORIZACAO} caracteres: agora são {tamanho} (espaços seguidos contam como um).
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
      {resposta.ok && (
        <p role="status" className={styles.sucesso}>
          {resposta.aviso ?? "Publicado."}
        </p>
      )}
      <div className={styles.acoes}>
        <BotaoConfirmar pergunta={pergunta} disabled={enviando || publicadaNoMeio !== null}>
          {enviando ? "Publicando…" : `Publicar a versão ${proxima}`}
        </BotaoConfirmar>
      </div>
    </form>
  );
}
