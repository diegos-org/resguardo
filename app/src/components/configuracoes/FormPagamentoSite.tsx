"use client";

import { useActionState, useState } from "react";
import type { ConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import type { EstadoConfigPagamento } from "@/pagamentos/acoes-painel";
import styles from "../formularios.module.css";

const nota = { fontSize: "0.8125rem", color: "var(--scl-texto-2)", margin: 0 } as const;

type Props = {
  config: ConfigPagamentoSite;
  /** Categorias de despesa ativas. */
  categorias: readonly { id: string; nome: string }[];
  nomeEmpresa: string;
  /** Limites e nomes vindos do servidor (a regra mora em configuracoes/pagamento-site). */
  limiteNome: number;
  visiveis: number;
  categoriaPadrao: string;
  /** financeiro:editar; sem ela, só leitura. */
  editar: boolean;
  salvar: (a: EstadoConfigPagamento, f: FormData) => Promise<EstadoConfigPagamento>;
};

/**
 * Configurações → Pagamento no site (M8.2a): oferecer ou não o Pix no site, o nome na fatura (para o cartão; vazio = o
 * nome da empresa) e a categoria da despesa da taxa que o Mercado Pago não devolve. Vale para as tentativas novas.
 */
export function FormPagamentoSite({ config, categorias, nomeEmpresa, limiteNome, visiveis, categoriaPadrao, editar, salvar }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  const [nome, setNome] = useState(estado.valores?.nomeFatura ?? config.nomeFatura ?? "");
  const naFatura = (nome.trim() || nomeEmpresa).slice(0, visiveis);
  const erro = (k: keyof ConfigPagamentoSite) =>
    estado.erros?.[k] ? (
      <span className={styles.erro} id={`erro-${k}`}>
        {estado.erros[k]}
      </span>
    ) : null;
  const categoriaEscolhida = config.categoriaTaxaId && categorias.some((c) => c.id === config.categoriaTaxaId) ? config.categoriaTaxaId : "";
  return (
    <form key={JSON.stringify(config)} action={enviar} className={styles.form} aria-label="Pagamento no site">
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      <fieldset disabled={!editar} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <label className={styles.check}>
          <input type="checkbox" name="oferecer" defaultChecked={estado.valores ? estado.valores.oferecer === "on" : config.oferecer} /> Oferecer pagamento no site
        </label>
        <p style={nota}>
          Desligado, o site volta ao pedido pela conversa nos pedidos novos. O que já foi pago continua sendo conferido, e pode ser devolvido, normalmente.
        </p>
        <label>
          Nome na fatura (cartão)
          <input
            name="nomeFatura"
            maxLength={limiteNome}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={nomeEmpresa.slice(0, limiteNome)}
            aria-invalid={estado.erros?.nomeFatura ? true : undefined}
            aria-describedby={estado.erros?.nomeFatura ? "erro-nomeFatura" : undefined}
          />
          {erro("nomeFatura")}
        </label>
        <p style={nota}>
          Até {limiteNome} caracteres (letras, números, espaço, ponto e hífen). Vazio, vale o nome da empresa. A fatura costuma mostrar só os primeiros {visiveis}:{" "}
          <strong>{naFatura}</strong>
        </p>
        <label>
          Categoria da taxa do pagamento
          <select name="categoriaTaxaId" defaultValue={estado.valores?.categoriaTaxaId ?? categoriaEscolhida} aria-invalid={estado.erros?.categoriaTaxaId ? true : undefined}>
            <option value="">Criar &ldquo;{categoriaPadrao}&rdquo; no primeiro uso</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          {erro("categoriaTaxaId")}
        </label>
        {config.categoriaTaxaId && !categoriaEscolhida && (
          <p role="note" className={styles.alerta} style={{ margin: 0 }}>
            A categoria escolhida antes foi arquivada ou não existe mais: escolha outra (ou deixe criar no primeiro uso).
          </p>
        )}
        <p style={nota}>
          Quando um pagamento sem reserva é devolvido, a parte da taxa que o Mercado Pago não devolve vira despesa da empresa nesta categoria, só depois da
          confirmação e com o valor que ele informar.
        </p>
      </fieldset>
      {estado.ok && (
        <p role="status" className={styles.sucesso}>
          {estado.aviso ?? "Salvo."}
        </p>
      )}
      {editar ? (
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      ) : (
        <p style={nota}>Só quem edita o financeiro muda estas regras.</p>
      )}
    </form>
  );
}
